import { DurableObject } from 'cloudflare:workers'
import { wakeMacDaemon } from '../lib/mac-wake.ts'
import {
	type CallRecord,
	type CallStatusEvent,
	DIAL_TIMEOUT_SECS,
	type NotifyChannel,
	type PhoneConfig,
	TERMINAL_CALL_STATUSES,
	appendTranscript,
	buildDialParams,
	buildLiveSession,
	buildNotifyPayload,
	logCallEvent,
	readPhoneConfig,
	sanitizeDigits,
	streamTwiml,
	summarizeCall,
	twilioDial,
	twilioHangup,
	twilioUpdateTwiml,
	unansweredOutcome,
} from '../lib/phone-call.ts'
import { HoldDetector, ulawFrameRms } from '../lib/phone-hold.ts'
import { enqueueTask } from '../lib/task-store.ts'

const OPENAI_LIVE_URL = 'https://api.openai.com/v1/live/sessions'
const REPLAY_FRAMES = 400 // 8 s of 20 ms frames replayed to GPT-Live when it (re)connects
const MAX_LIVE_RECONNECTS = 5
const END_CALL_GRACE_MS = 2500 // let the goodbye finish playing before hanging up
const HOLD_ENTER_DELAY_MS = 1500
const PERSIST_DEBOUNCE_MS = 2000
const STREAM_RESTART_MS = 20_000 // how long a DTMF-triggered stream reconnect may take
const WS_OPEN = 1

interface StartBody {
	call_id: string
	to: string
	goal: string
	context?: string
	notify?: { channel: NotifyChannel; chat_id: string }
	max_minutes?: number
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One instance per outbound call (idFromName(call_id)). Owns the Twilio media
 * WebSocket (hibernatable, inbound) and the GPT-Live WebSocket (outbound), and
 * the live/hold state machine:
 *
 *   connecting ──start──► live ◄──────────────┐
 *                          │ wait_on_hold      │ speech burst + silence
 *                          ▼                   │ (HoldDetector)
 *                         hold ────────────────┘
 *
 * In `live`, μ-law frames are forwarded both ways untouched. In `hold` GPT-Live
 * is closed (no billing) and the last seconds of audio are kept so the model
 * hears the greeting when a person picks up.
 */
export class PhoneCallDO extends DurableObject<Env> {
	private record: CallRecord | null = null
	private config: PhoneConfig | null = null
	private live: WebSocket | null = null
	private liveReady = false
	private liveConnecting = false
	private liveReconnects = 0
	private liveSecondsBase = 0
	private liveSessionSeconds = 0
	private liveStartedAt = 0
	private foldedSeconds = new Map<WebSocket, number>()
	private replay: string[] = []
	private hold = new HoldDetector()
	private persistTimer: ReturnType<typeof setTimeout> | null = null
	private finalizing = false
	private streamRestartUntil = 0

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		try {
			switch (url.pathname) {
				case '/start':
					return await this.handleStart((await request.json()) as StartBody)
				case '/stream':
					return await this.handleStream(request, url)
				case '/event':
					return await this.handleEvent((await request.json()) as CallStatusEvent)
				case '/status': {
					const record = await this.load()
					if (!record) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
					return Response.json({ ok: true, call: summarizeCall(record) })
				}
				case '/hangup': {
					const record = await this.load()
					if (!record) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
					await this.finalize('cancelled')
					return Response.json({ ok: true, call: summarizeCall(record) })
				}
				default:
					return new Response('Not found', { status: 404 })
			}
		} catch (e) {
			return Response.json({ ok: false, error: err(e) }, { status: 500 })
		}
	}

	// -- lifecycle -----------------------------------------------------------

	private async handleStart(body: StartBody): Promise<Response> {
		if (await this.load()) {
			return Response.json({ ok: false, error: 'already_started' }, { status: 409 })
		}
		const cfg = await readPhoneConfig(this.env)
		if (!cfg.ok) {
			return Response.json(
				{ ok: false, error: 'phone_not_configured', missing: cfg.missing },
				{ status: 400 },
			)
		}
		this.config = cfg.config
		const now = Date.now()
		const maxSeconds = Math.round((body.max_minutes ?? 90) * 60)
		const record: CallRecord = {
			id: body.call_id,
			to: body.to,
			from: cfg.config.fromNumber,
			goal: body.goal,
			context: body.context ?? null,
			status: 'dialing',
			phase: 'connecting',
			outcome: null,
			summary: null,
			error: null,
			transcript: [],
			events: [],
			call_sid: null,
			hangup_cause: null,
			created_at: now,
			answered_at: null,
			ended_at: null,
			deadline_at: now + maxSeconds * 1000,
			notify: body.notify ?? null,
			live_seconds: 0,
			hold_count: 0,
		}
		const streamToken = crypto.randomUUID().replace(/-/g, '')
		await this.ctx.storage.put('stream_token', streamToken)
		await this.save(record)
		try {
			const { call_sid } = await twilioDial(
				cfg.config,
				buildDialParams({
					config: cfg.config,
					callId: record.id,
					to: record.to,
					streamToken,
					maxSeconds,
				}),
			)
			record.call_sid = call_sid
			logCallEvent(record, 'dialed')
		} catch (e) {
			record.error = err(e)
			await this.finalize('dial_failed')
			return Response.json(
				{ ok: false, error: record.error, call: summarizeCall(record) },
				{ status: 502 },
			)
		}
		// Backstop for a call that never connects (no stream, no webhook); the
		// alarm re-arms itself to the hard deadline once the call is up.
		await this.ctx.storage.setAlarm(
			Math.min(now + (DIAL_TIMEOUT_SECS + 60) * 1000, record.deadline_at),
		)
		await this.save(record)
		return Response.json({ ok: true, call: summarizeCall(record) })
	}

	private async handleStream(request: Request, url: URL): Promise<Response> {
		const record = await this.load()
		if (!record) return new Response('Not found', { status: 404 })
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected websocket', { status: 426 })
		}
		const token = await this.ctx.storage.get<string>('stream_token')
		if (!token || url.searchParams.get('token') !== token) {
			return new Response('Unauthorized', { status: 401 })
		}
		if (record.status === 'ended') return new Response('Call ended', { status: 410 })
		const pair = new WebSocketPair()
		const [client, server] = Object.values(pair)
		this.ctx.acceptWebSocket(server, ['line'])
		logCallEvent(record, 'stream_connected')
		return new Response(null, { status: 101, webSocket: client })
	}

	private async handleEvent(event: CallStatusEvent): Promise<Response> {
		const record = await this.load()
		if (!record) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
		logCallEvent(record, `call.${event.status}`)
		if (event.status === 'in-progress' && record.status === 'dialing') {
			record.status = 'active'
			record.answered_at ??= Date.now()
		}
		if (TERMINAL_CALL_STATUSES.has(event.status)) {
			record.hangup_cause = event.status
			if (!record.answered_at) record.outcome ??= unansweredOutcome(event.status)
			await this.finalize('remote_hangup', { skipHangupCommand: true })
		}
		await this.save(record)
		return Response.json({ ok: true })
	}

	async alarm(): Promise<void> {
		const record = await this.load()
		if (!record || record.status === 'ended') return
		if (record.status === 'dialing') {
			await this.finalize('no_answer')
			return
		}
		if (Date.now() >= record.deadline_at) {
			await this.finalize('timeout')
			return
		}
		await this.ctx.storage.setAlarm(record.deadline_at)
	}

	// -- Twilio media stream (hibernatable WebSocket handlers) ---------------

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== 'string') return
		let evt: {
			event?: string
			streamSid?: string
			start?: { streamSid?: string }
			media?: { payload?: string }
			dtmf?: { digit?: string }
		}
		try {
			evt = JSON.parse(message)
		} catch {
			return
		}
		const record = await this.load()
		if (!record || record.status === 'ended') return
		switch (evt.event) {
			case 'start':
				// Outbound frames must carry this stream's id; kept on the socket so it
				// survives hibernation and a second stream after a DTMF restart.
				ws.serializeAttachment({ streamSid: evt.start?.streamSid ?? evt.streamSid })
				this.streamRestartUntil = 0
				if (record.phase !== 'connecting') {
					logCallEvent(record, 'stream_restart')
					break
				}
				record.status = 'active'
				record.answered_at ??= Date.now()
				record.phase = 'live'
				logCallEvent(record, 'stream_start')
				await this.save(record)
				this.ensureLive(record)
				break
			case 'media':
				this.onMedia(record, evt.media?.payload)
				break
			case 'dtmf':
				logCallEvent(record, 'dtmf_received', evt.dtmf?.digit)
				break
			case 'stop':
				await this.onStreamGone(ws, 'remote_hangup')
				break
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		await this.onStreamGone(ws, 'remote_hangup')
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.onStreamGone(ws, 'stream_error')
	}

	/**
	 * A stream ending normally means the other party hung up — except while a
	 * send_dtmf restart is in flight, or when a newer stream already took over.
	 */
	private async onStreamGone(ws: WebSocket, reason: string): Promise<void> {
		const record = await this.load()
		if (!record || record.status === 'ended') return
		if (Date.now() < this.streamRestartUntil) return
		const replaced = this.ctx
			.getWebSockets('line')
			.some((s) => s !== ws && s.readyState === WS_OPEN)
		if (!replaced) await this.finalize(reason)
	}

	private onMedia(record: CallRecord, payload: string | undefined): void {
		if (!payload) return
		if (record.phase === 'live') {
			if (this.live && this.liveReady) {
				this.live.send(JSON.stringify({ type: 'session.input_audio.append', audio: payload }))
			} else {
				this.pushReplay(payload)
				this.ensureLive(record)
			}
			return
		}
		if (record.phase === 'hold') {
			this.pushReplay(payload)
			if (this.hold.feed(ulawFrameRms(fromBase64(payload)), Date.now())) {
				this.engageFromHold(record)
			}
		}
	}

	private pushReplay(payload: string): void {
		this.replay.push(payload)
		if (this.replay.length > REPLAY_FRAMES) this.replay.shift()
	}

	private sendAudioToLine(payload: unknown): void {
		for (const ws of this.ctx.getWebSockets('line')) {
			const streamSid = (ws.deserializeAttachment() as { streamSid?: string } | null)?.streamSid
			if (!streamSid) continue
			try {
				ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }))
			} catch {}
		}
	}

	// -- GPT-Live ------------------------------------------------------------

	private ensureLive(record: CallRecord): void {
		if (this.live || this.liveConnecting || record.status === 'ended') return
		this.liveConnecting = true
		this.openLive(record)
			.catch(async (e) => {
				logCallEvent(record, 'live_error', err(e))
				this.liveReconnects++
				if (this.liveReconnects > MAX_LIVE_RECONNECTS) await this.finalize('live_unavailable')
			})
			.finally(() => {
				this.liveConnecting = false
			})
	}

	private async openLive(record: CallRecord): Promise<void> {
		const config = await this.getConfig()
		if (record.phase !== 'live' || record.status !== 'active') return
		const res = await fetch(OPENAI_LIVE_URL, {
			headers: {
				Upgrade: 'websocket',
				Authorization: `Bearer ${config.openaiApiKey}`,
			},
		})
		const ws = res.webSocket
		if (!ws) throw new Error(`gpt-live upgrade failed: ${res.status}`)
		ws.accept()
		if (record.phase !== 'live' || record.status !== 'active') {
			// Phase changed while the upgrade was in flight (hold/hangup): drop it unused.
			ws.close(1000, 'stale')
			return
		}
		this.live = ws
		this.liveReady = false
		this.liveSessionSeconds = 0
		ws.addEventListener('message', (e) => {
			this.onLiveMessage(ws, String(e.data)).catch((error) => {
				logCallEvent(record, 'live_handler_error', err(error))
			})
		})
		ws.addEventListener('close', () => this.onLiveClosed(ws))
		ws.addEventListener('error', () => this.onLiveClosed(ws))
		ws.send(JSON.stringify({ type: 'session.start', session: buildLiveSession(record, config) }))
		logCallEvent(record, record.hold_count > 0 ? 'live_reconnect' : 'live_open')
		this.persistSoon()
	}

	private sendToLive(message: unknown): void {
		if (!this.live) return
		try {
			this.live.send(JSON.stringify(message))
		} catch {}
	}

	private async onLiveMessage(ws: WebSocket, raw: string): Promise<void> {
		let evt: Record<string, unknown>
		try {
			evt = JSON.parse(raw)
		} catch {
			return
		}
		const record = await this.load()
		if (!record) return
		const now = Date.now()
		switch (evt.type) {
			case 'session.started':
				if (this.live !== ws) break
				this.liveReady = true
				this.liveStartedAt = now
				this.liveReconnects = 0
				logCallEvent(record, 'live_ready')
				for (const frame of this.replay) {
					ws.send(JSON.stringify({ type: 'session.input_audio.append', audio: frame }))
				}
				this.replay = []
				break
			case 'session.output_audio.delta':
				if (this.live === ws && record.phase === 'live') {
					this.sendAudioToLine(evt.delta)
				}
				break
			case 'session.input_transcript.delta':
				appendTranscript(record.transcript, 'caller', String(evt.delta ?? ''), now)
				this.persistSoon()
				break
			case 'session.output_transcript.delta':
				appendTranscript(record.transcript, 'agent', String(evt.delta ?? ''), now)
				this.persistSoon()
				break
			case 'session.delegation.created':
				logCallEvent(
					record,
					'delegation',
					(evt.delegation as { target?: string } | undefined)?.target,
				)
				break
			case 'response.event':
				await this.onDelegationEvent(record, evt)
				break
			case 'session.usage.updated': {
				const usage = evt.usage as { seconds?: number } | undefined
				this.liveSessionSeconds = usage?.seconds ?? this.liveSessionSeconds
				record.live_seconds = this.liveSecondsBase + this.liveSessionSeconds
				break
			}
			case 'session.closed': {
				const usage = evt.usage as { seconds?: number } | undefined
				const wasCurrent = this.live === ws
				if (wasCurrent) this.detachLive(ws)
				// Replace the folded estimate for this session with its final usage.
				const folded = this.foldedSeconds.get(ws) ?? 0
				this.foldedSeconds.delete(ws)
				this.liveSecondsBase += (usage?.seconds ?? folded) - folded
				record.live_seconds = this.liveSecondsBase + this.liveSessionSeconds
				logCallEvent(record, 'live_closed', typeof evt.reason === 'string' ? evt.reason : undefined)
				this.persistSoon()
				try {
					ws.close(1000, 'session closed')
				} catch {}
				if (wasCurrent) {
					if (
						record.phase === 'live' &&
						record.status === 'active' &&
						evt.reason !== 'close_requested'
					) {
						this.liveReconnects++
						if (this.liveReconnects > MAX_LIVE_RECONNECTS) await this.finalize('live_unavailable')
						else this.ensureLive(record)
					}
				}
				break
			}
			case 'error': {
				const detail = (evt.error as { message?: string } | undefined)?.message ?? raw.slice(0, 200)
				logCallEvent(record, 'live_error', detail)
				this.persistSoon()
				if (this.live === ws && !this.liveReady) {
					// session.start was rejected (bad model/config): nobody would ever speak.
					record.error = detail
					await this.finalize('live_error')
				}
				break
			}
		}
	}

	private onLiveClosed(ws: WebSocket): void {
		if (this.live !== ws) return
		this.detachLive(ws)
		const record = this.record
		if (!record || record.status !== 'active' || record.phase !== 'live' || this.finalizing) return
		logCallEvent(record, 'live_dropped')
		this.liveReconnects++
		if (this.liveReconnects > MAX_LIVE_RECONNECTS) {
			this.finalize('live_unavailable').catch(() => {})
		} else {
			this.ensureLive(record)
		}
	}

	/** Stop treating `ws` as the current session; its seconds so far are folded into the total. */
	private detachLive(ws: WebSocket): void {
		// session.usage.updated arrives about once a minute, so a short session may
		// report nothing: fall back to wall-clock time since session.started.
		const elapsed = this.liveStartedAt ? (Date.now() - this.liveStartedAt) / 1000 : 0
		const seconds = Math.max(this.liveSessionSeconds, elapsed)
		this.foldedSeconds.set(ws, seconds)
		this.liveSecondsBase += seconds
		this.liveSessionSeconds = 0
		this.liveStartedAt = 0
		if (this.record) this.record.live_seconds = this.liveSecondsBase
		this.live = null
		this.liveReady = false
	}

	/** Graceful close: ask for session.closed (final usage), then drop the transport. */
	private closeLive(reason: string): void {
		const ws = this.live
		if (!ws) return
		this.detachLive(ws)
		try {
			ws.send(JSON.stringify({ type: 'session.close' }))
		} catch {}
		setTimeout(() => {
			try {
				ws.close(1000, reason)
			} catch {}
		}, 5000)
	}

	private async onDelegationEvent(
		record: CallRecord,
		envelope: Record<string, unknown>,
	): Promise<void> {
		const inner = envelope.event as
			| {
					type?: string
					text?: string
					item?: { type?: string; call_id?: string; name?: string; arguments?: string }
			  }
			| undefined
		if (!inner) return
		if (inner.type === 'response.output_text.done') {
			// What the backend said instead of (or after) calling a tool.
			logCallEvent(record, 'backend_text', String(inner.text ?? '').slice(0, 200))
			return
		}
		if (inner.type === 'response.output_item.done' && inner.item?.type === 'function_call') {
			const { call_id, name, arguments: rawArgs } = inner.item
			let args: Record<string, unknown> = {}
			try {
				args = JSON.parse(rawArgs || '{}')
			} catch {}
			const output = await this.runTool(record, name ?? '', args)
			this.sendToLive({
				type: 'response.item.create',
				item: { type: 'function_call_output', call_id, output: JSON.stringify(output) },
			})
			// wait_on_hold and end_call close the session; continuing the backend
			// response would only inject a confirmation for the model to say aloud.
			if (name === 'send_dtmf') this.sendToLive({ type: 'response.create' })
			return
		}
		if (inner.type === 'response.failed' || inner.type === 'error') {
			logCallEvent(record, 'delegation_error', JSON.stringify(inner).slice(0, 200))
		}
	}

	private async runTool(
		record: CallRecord,
		name: string,
		args: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		switch (name) {
			case 'send_dtmf': {
				const digits = sanitizeDigits(String(args.digits ?? ''))
				const token = await this.ctx.storage.get<string>('stream_token')
				if (!digits || !record.call_sid || !token) return { ok: false, error: 'invalid_digits' }
				try {
					const config = await this.getConfig()
					// Twilio presses keys by replacing the call's TwiML: it plays the digits,
					// then reconnects the media stream on a new WebSocket (a 1-2 s audio gap).
					this.expectStreamRestart()
					await twilioUpdateTwiml(
						config,
						record.call_sid,
						streamTwiml(config, record.id, token, digits),
					)
					logCallEvent(record, 'dtmf_sent', digits)
					return { ok: true, digits }
				} catch (e) {
					this.streamRestartUntil = 0
					logCallEvent(record, 'dtmf_error', err(e))
					return { ok: false, error: err(e) }
				}
			}
			case 'wait_on_hold': {
				logCallEvent(record, 'hold_requested', String(args.reason ?? ''))
				setTimeout(() => this.enterHold(record), HOLD_ENTER_DELAY_MS)
				return {
					ok: true,
					status: 'holding',
					note: 'Voice session pauses until a person picks up.',
				}
			}
			case 'end_call': {
				record.outcome = typeof args.outcome === 'string' ? args.outcome : 'ended'
				record.summary = typeof args.summary === 'string' ? args.summary : null
				logCallEvent(record, 'end_requested', record.outcome)
				this.persistSoon()
				setTimeout(() => {
					this.finalize('completed').catch(() => {})
				}, END_CALL_GRACE_MS)
				return { ok: true, status: 'ending' }
			}
			default:
				return { ok: false, error: `unknown_tool:${name}` }
		}
	}

	/** Tolerate the stream dropping for a moment; end the call if it never comes back. */
	private expectStreamRestart(): void {
		const until = Date.now() + STREAM_RESTART_MS
		this.streamRestartUntil = until
		setTimeout(() => {
			if (this.streamRestartUntil !== until) return // a new stream already started
			this.streamRestartUntil = 0
			const up = this.ctx.getWebSockets('line').some((s) => s.readyState === WS_OPEN)
			if (!up) this.finalize('stream_lost').catch(() => {})
		}, STREAM_RESTART_MS)
	}

	// -- hold state machine --------------------------------------------------

	private enterHold(record: CallRecord): void {
		if (record.status !== 'active' || record.phase !== 'live') return
		record.phase = 'hold'
		record.hold_count++
		this.hold.reset()
		this.replay = []
		this.closeLive('hold')
		logCallEvent(record, 'hold_start')
		this.persistSoon()
	}

	private engageFromHold(record: CallRecord): void {
		if (record.status !== 'active' || record.phase !== 'hold') return
		record.phase = 'live'
		logCallEvent(record, 'hold_end')
		this.persistSoon()
		this.ensureLive(record)
	}

	// -- teardown ------------------------------------------------------------

	private async finalize(
		reason: string,
		opts: { skipHangupCommand?: boolean } = {},
	): Promise<void> {
		const record = await this.load()
		if (!record || record.status === 'ended' || this.finalizing) return
		this.finalizing = true
		record.status = 'ended'
		record.phase = 'ended'
		record.ended_at = Date.now()
		record.outcome ??= reason
		logCallEvent(record, 'ended', reason)
		this.replay = []
		this.closeLive('call ended')
		for (const ws of this.ctx.getWebSockets('line')) {
			try {
				ws.close(1000, 'call ended')
			} catch {}
		}
		if (record.call_sid && !opts.skipHangupCommand) {
			try {
				await twilioHangup(await this.getConfig(), record.call_sid)
			} catch (e) {
				logCallEvent(record, 'hangup_error', err(e))
			}
		}
		await this.ctx.storage.deleteAlarm()
		await this.save(record)
		if (record.notify) {
			try {
				await enqueueTask(this.env.FERMI_DB, {
					channel: record.notify.channel,
					sender: `phone:${record.id}`,
					chatId: record.notify.chat_id,
					payload: buildNotifyPayload(record),
				})
				await wakeMacDaemon(this.env)
			} catch (e) {
				logCallEvent(record, 'notify_error', err(e))
				await this.save(record)
			}
		}
	}

	// -- storage -------------------------------------------------------------

	private async load(): Promise<CallRecord | null> {
		if (!this.record) this.record = (await this.ctx.storage.get<CallRecord>('record')) ?? null
		return this.record
	}

	private async save(record: CallRecord): Promise<void> {
		this.record = record
		if (this.persistTimer) {
			clearTimeout(this.persistTimer)
			this.persistTimer = null
		}
		await this.ctx.storage.put('record', record)
	}

	private persistSoon(): void {
		if (this.persistTimer) return
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null
			if (this.record) this.ctx.storage.put('record', this.record).catch(() => {})
		}, PERSIST_DEBOUNCE_MS)
	}

	private async getConfig(): Promise<PhoneConfig> {
		if (this.config) return this.config
		const cfg = await readPhoneConfig(this.env)
		if (!cfg.ok) throw new Error(`phone_not_configured: ${cfg.missing.join(', ')}`)
		this.config = cfg.config
		return cfg.config
	}
}

function fromBase64(value: string): Uint8Array {
	const bin = atob(value)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes
}
