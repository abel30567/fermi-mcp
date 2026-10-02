import { timingSafeEqual } from './crypto.ts'
import { getSecret } from './secrets-store.ts'

// Outbound phone calls: Twilio Programmable Voice (dial + bidirectional μ-law
// media stream) bridged to OpenAI GPT-Live. Everything in this module is pure or
// plain fetch so it can be unit-tested; the per-call state machine lives in
// src/do/phone-call.ts.

export const PHONE_REQUIRED_CONFIG = [
	'TWILIO_ACCOUNT_SID',
	'TWILIO_AUTH_TOKEN', // also the key Twilio signs /phone/webhook requests with
	'TWILIO_FROM_NUMBER', // E.164 caller id: a Twilio number or a verified caller ID
	'OPENAI_API_KEY',
	'FERMI_PUBLIC_URL', // https origin of this worker; Twilio must reach it
] as const

const PHONE_DEFAULTS = {
	TWILIO_API_BASE: 'https://api.twilio.com', // override only for scripts/phone-sim.mjs
	OPENAI_LIVE_MODEL: 'gpt-live-1',
	OPENAI_LIVE_BACKEND_MODEL: 'gpt-6-luna',
	OPENAI_LIVE_VOICE: 'marin',
} as const

export interface PhoneConfig {
	twilioAccountSid: string
	twilioAuthToken: string
	twilioApiBase: string
	fromNumber: string
	openaiApiKey: string
	publicUrl: string
	liveModel: string
	backendModel: string
	voice: string
}

/** Fermi secrets store (app scope) first, then a Worker var/secret of the same name. */
export async function readPhoneValue(name: string, env: Env): Promise<string | undefined> {
	const stored = await getSecret(name, 'app', '', env).catch(() => null)
	if (stored?.value) return stored.value
	const fromEnv = (env as unknown as Record<string, unknown>)[name]
	return typeof fromEnv === 'string' && fromEnv ? fromEnv : undefined
}

export async function readPhoneConfig(
	env: Env,
): Promise<{ ok: true; config: PhoneConfig } | { ok: false; missing: string[] }> {
	const values: Record<string, string | undefined> = {}
	for (const name of [...PHONE_REQUIRED_CONFIG, ...Object.keys(PHONE_DEFAULTS)]) {
		values[name] = await readPhoneValue(name, env)
	}
	const missing = PHONE_REQUIRED_CONFIG.filter((name) => !values[name])
	if (missing.length > 0) return { ok: false, missing }
	return {
		ok: true,
		config: {
			twilioAccountSid: values.TWILIO_ACCOUNT_SID as string,
			twilioAuthToken: values.TWILIO_AUTH_TOKEN as string,
			twilioApiBase: (values.TWILIO_API_BASE ?? PHONE_DEFAULTS.TWILIO_API_BASE).replace(/\/+$/, ''),
			fromNumber: values.TWILIO_FROM_NUMBER as string,
			openaiApiKey: values.OPENAI_API_KEY as string,
			publicUrl: (values.FERMI_PUBLIC_URL as string).replace(/\/+$/, ''),
			liveModel: values.OPENAI_LIVE_MODEL ?? PHONE_DEFAULTS.OPENAI_LIVE_MODEL,
			backendModel: values.OPENAI_LIVE_BACKEND_MODEL ?? PHONE_DEFAULTS.OPENAI_LIVE_BACKEND_MODEL,
			voice: values.OPENAI_LIVE_VOICE ?? PHONE_DEFAULTS.OPENAI_LIVE_VOICE,
		},
	}
}

// ---------------------------------------------------------------------------
// Call record (persisted in the Durable Object)

export type CallPhase = 'connecting' | 'live' | 'hold' | 'ended'
export type NotifyChannel = 'tg' | 'wa' | 'dc' | 'sl'

export interface TranscriptLine {
	at: number
	until: number
	role: 'caller' | 'agent'
	text: string
}

export interface CallEvent {
	at: number
	type: string
	detail?: string
}

export interface CallRecord {
	id: string
	to: string
	from: string
	goal: string
	context: string | null
	status: 'dialing' | 'active' | 'ended'
	phase: CallPhase
	outcome: string | null
	summary: string | null
	error: string | null
	transcript: TranscriptLine[]
	events: CallEvent[]
	call_sid: string | null
	hangup_cause: string | null
	created_at: number
	answered_at: number | null
	ended_at: number | null
	deadline_at: number
	notify: { channel: NotifyChannel; chat_id: string } | null
	live_seconds: number
	hold_count: number
}

const MAX_TRANSCRIPT_LINES = 2000
const MAX_EVENTS = 500

/** GPT-Live emits timed fragments; merge same-speaker fragments that arrive close together. */
export function appendTranscript(
	lines: TranscriptLine[],
	role: TranscriptLine['role'],
	delta: string,
	at: number,
	mergeWindowMs = 4000,
): void {
	if (!delta) return
	const last = lines[lines.length - 1]
	if (last && last.role === role && at - last.until <= mergeWindowMs) {
		last.text += delta
		last.until = at
		return
	}
	lines.push({ at, until: at, role, text: delta })
	if (lines.length > MAX_TRANSCRIPT_LINES) lines.splice(0, lines.length - MAX_TRANSCRIPT_LINES)
}

export function logCallEvent(record: CallRecord, type: string, detail?: string): void {
	record.events.push(detail ? { at: Date.now(), type, detail } : { at: Date.now(), type })
	if (record.events.length > MAX_EVENTS) record.events.splice(0, record.events.length - MAX_EVENTS)
}

export function formatTranscript(record: CallRecord, maxLines = Number.POSITIVE_INFINITY): string {
	const start = record.answered_at ?? record.created_at
	const lines = record.transcript.slice(-maxLines)
	return lines
		.map((l) => `+${Math.max(0, Math.round((l.at - start) / 1000))}s ${l.role}: ${l.text.trim()}`)
		.join('\n')
}

/** Task payload enqueued for the requesting channel when a call ends. */
export function buildNotifyPayload(record: CallRecord): string {
	const durationSec = Math.round(((record.ended_at ?? Date.now()) - record.created_at) / 1000)
	return [
		`[Phone call ${record.id} to ${record.to} ended — outcome: ${record.outcome ?? 'unknown'}]`,
		`Goal: ${record.goal}`,
		`Summary: ${record.summary ?? '(none)'}`,
		record.error ? `Error: ${record.error}` : null,
		`Duration: ${durationSec}s total, ${Math.round(record.live_seconds)}s with the voice model, ${record.hold_count} hold period(s)`,
		'Transcript (last 40 lines):',
		formatTranscript(record, 40) || '(no transcript)',
		'',
		`Report this result to the user in this chat. Use phone_call_status with call_id ${record.id} for the full transcript and event log.`,
	]
		.filter((line) => line !== null)
		.join('\n')
}

// ---------------------------------------------------------------------------
// Twilio Programmable Voice

export const DIAL_TIMEOUT_SECS = 60

/** What Twilio's <Play digits> accepts: 0-9, *, #, w (0.5 s pause), W (1 s pause). */
export function sanitizeDigits(digits: string): string {
	return digits.replace(/[^0-9*#wW]/g, '')
}

/**
 * TwiML that connects the call's audio to this worker as a bidirectional media
 * stream. Twilio does not allow a query string on a stream URL, so the per-call
 * token travels in the path. With `digits`, Twilio first plays those DTMF tones
 * into the call — the only supported way to press keys on a streamed call.
 */
export function streamTwiml(
	config: PhoneConfig,
	callId: string,
	streamToken: string,
	digits = '',
): string {
	const wsOrigin = config.publicUrl.replace(/^http/, 'ws')
	const play = digits ? `<Play digits="${sanitizeDigits(digits)}"/>` : ''
	return `<?xml version="1.0" encoding="UTF-8"?><Response>${play}<Connect><Stream url="${wsOrigin}/phone/stream/${callId}/${streamToken}"/></Connect></Response>`
}

export function buildDialParams(input: {
	config: PhoneConfig
	callId: string
	to: string
	streamToken: string
	maxSeconds: number
}): URLSearchParams {
	const params = new URLSearchParams({
		To: input.to,
		From: input.config.fromNumber,
		Twiml: streamTwiml(input.config, input.callId, input.streamToken),
		StatusCallback: `${input.config.publicUrl}/phone/webhook?call=${input.callId}`,
		StatusCallbackMethod: 'POST',
		Timeout: String(DIAL_TIMEOUT_SECS),
		TimeLimit: String(Math.min(Math.max(Math.round(input.maxSeconds), 30), 14_400)),
	})
	for (const event of ['initiated', 'ringing', 'answered', 'completed']) {
		params.append('StatusCallbackEvent', event)
	}
	return params
}

async function twilioPost(
	config: PhoneConfig,
	path: string,
	params: URLSearchParams,
): Promise<Record<string, unknown>> {
	const res = await fetch(
		`${config.twilioApiBase}/2010-04-01/Accounts/${config.twilioAccountSid}${path}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Basic ${btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`)}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: params.toString(),
		},
	)
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		const code = json.code ? ` (code ${json.code})` : ''
		throw new Error(`twilio ${path} ${res.status}: ${json.message ?? 'request failed'}${code}`)
	}
	return json
}

export async function twilioDial(
	config: PhoneConfig,
	params: URLSearchParams,
): Promise<{ call_sid: string }> {
	const data = await twilioPost(config, '/Calls.json', params)
	if (typeof data.sid !== 'string') throw new Error('twilio dial: no call sid')
	return { call_sid: data.sid }
}

export function twilioHangup(config: PhoneConfig, callSid: string): Promise<unknown> {
	return twilioPost(
		config,
		`/Calls/${encodeURIComponent(callSid)}.json`,
		new URLSearchParams({ Status: 'completed' }),
	)
}

/** Replace the live call's TwiML (see streamTwiml): plays digits, then re-opens the stream. */
export function twilioUpdateTwiml(
	config: PhoneConfig,
	callSid: string,
	twiml: string,
): Promise<unknown> {
	return twilioPost(
		config,
		`/Calls/${encodeURIComponent(callSid)}.json`,
		new URLSearchParams({ Twiml: twiml }),
	)
}

/**
 * Twilio signs the exact callback URL followed by every POST field (sorted by
 * name, name immediately followed by value) with HMAC-SHA1 keyed by the auth token.
 */
export async function verifyTwilioSignature(input: {
	authToken: string
	signature: string | null
	url: string
	params: URLSearchParams
}): Promise<boolean> {
	if (!input.signature) return false
	const data = [...input.params.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.reduce((acc, [name, value]) => acc + name + value, input.url)
	const encoder = new TextEncoder()
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(input.authToken),
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign'],
	)
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
	return timingSafeEqual(btoa(String.fromCharCode(...mac)), input.signature)
}

export interface CallStatusEvent {
	call_id: string
	call_sid: string | null
	/** queued | initiated | ringing | in-progress | completed | busy | no-answer | failed | canceled */
	status: string
}

export const TERMINAL_CALL_STATUSES = new Set([
	'completed',
	'busy',
	'no-answer',
	'failed',
	'canceled',
])

/** The call id rides in the callback URL (`?call=`); Twilio's fields are form-encoded. */
export function parseStatusCallback(url: URL, params: URLSearchParams): CallStatusEvent | null {
	const callId = url.searchParams.get('call')
	const status = params.get('CallStatus')
	if (!callId || !status) return null
	return { call_id: callId, call_sid: params.get('CallSid'), status }
}

/** Outcome for a call that ended before anyone answered. */
export function unansweredOutcome(status: string): string {
	switch (status) {
		case 'busy':
			return 'busy'
		case 'failed':
			return 'failed'
		case 'canceled':
			return 'canceled'
		default:
			return 'no_answer'
	}
}

/** Twilio → PhoneCallDO /event. Signature-verified; unknown calls are acknowledged and dropped. */
export async function handlePhoneWebhook(request: Request, env: Env): Promise<Response> {
	const authToken = await readPhoneValue('TWILIO_AUTH_TOKEN', env)
	if (!authToken) {
		return Response.json({ ok: false, error: 'twilio_auth_token_not_configured' }, { status: 503 })
	}
	const params = new URLSearchParams(await request.text())
	const url = new URL(request.url)
	// Twilio signs the URL it was given; behind a tunnel or proxy request.url can differ.
	const publicUrl = (await readPhoneValue('FERMI_PUBLIC_URL', env))?.replace(/\/+$/, '')
	const valid = await verifyTwilioSignature({
		authToken,
		signature: request.headers.get('x-twilio-signature'),
		url: `${publicUrl ?? url.origin}${url.pathname}${url.search}`,
		params,
	})
	if (!valid) return new Response('Unauthorized', { status: 401 })
	const event = parseStatusCallback(url, params)
	if (!event) return Response.json({ ok: true, ignored: true })
	const ns = env.PHONE_CALL
	await ns
		.get(ns.idFromName(event.call_id))
		.fetch('https://do/event', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
		})
		.catch(() => {})
	return Response.json({ ok: true })
}

// ---------------------------------------------------------------------------
// GPT-Live session

export const LIVE_TOOLS = [
	{
		type: 'function',
		name: 'send_dtmf',
		description:
			'Press keys on the phone keypad to navigate an automated menu (IVR). Use w for a half-second pause between digits.',
		parameters: {
			type: 'object',
			properties: {
				digits: { type: 'string', description: 'Digits to press: 0-9, *, #, and w for pauses' },
			},
			required: ['digits'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'wait_on_hold',
		description:
			'The line is on hold, ringing, or a recording asked us to wait. Pauses the voice session (no speaking) until a person picks up, then the conversation resumes automatically.',
		parameters: {
			type: 'object',
			properties: { reason: { type: 'string', description: 'What was heard, in a few words' } },
			required: ['reason'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'end_call',
		description:
			'Hang up. Call this only after the goal is achieved, cannot be achieved, a voicemail was left, or the other party has hung up. Say goodbye first.',
		parameters: {
			type: 'object',
			properties: {
				outcome: {
					type: 'string',
					enum: ['success', 'partial', 'failed', 'voicemail', 'wrong_number', 'callback_later'],
				},
				summary: {
					type: 'string',
					description:
						'2-4 sentences: what happened, any reference/confirmation numbers, names, dates, amounts, and next steps',
				},
			},
			required: ['outcome', 'summary'],
			additionalProperties: false,
		},
	},
] as const

// The backend's reply is injected into the live session. Keep it a descriptive
// sentence: with a bare "done" the voice model stopped delegating for the rest
// of the call (3 of 3 simulated calls), so it never held or hung up.
const BACKEND_INSTRUCTIONS =
	'You are the tool backend for a live phone call handled by a voice model; you never speak to the other party. ' +
	'When the voice model delegates, call exactly one matching tool: send_dtmf to press phone-menu keys, ' +
	'wait_on_hold when the line is on hold or a recording asks to wait, end_call when the conversation is over ' +
	'(give a concrete outcome and a 2-4 sentence summary with any reference numbers, names, dates, or next steps). ' +
	'After the tool result, reply with one short sentence.'

export function buildLiveInstructions(record: CallRecord): string {
	const sections = [
		'# Personality',
		"You are Fermi, a calm and polite phone assistant placing a call on behalf of the user. Speak naturally at an unhurried pace, clearly and directly, in short turns. If asked directly whether you are a person, say you are an AI assistant calling on the user's behalf.",
		'',
		'# Goal of this call',
		record.goal,
		'',
		'# Facts you may use',
		record.context ??
			'(none provided — if the other party needs information you do not have, say you will follow up and end the call politely)',
		'',
		'# Backchannel policy',
		'Use brief acknowledgements ("okay", "mm-hm") only while the other party is explaining something long.',
		'',
		'# Interruption policy',
		'Stop speaking when the other party interrupts. Listen, then respond.',
		'',
		'# Phone menus, hold, and voicemail',
		'- Automated menu: listen to all options, then delegate to the backend to press the right keys (send_dtmf). Do not talk to a menu unless it asks for spoken input.',
		'- Hold music, ringing, a "please hold" / "your call is important" recording, or an estimated wait: do NOT speak. Delegate wait_on_hold to the backend immediately. You will be reconnected when a person picks up.',
		'- Voicemail: unless the goal or facts say to leave a message, do not leave one; delegate end_call with outcome "voicemail" right away. If you are told to leave one, keep it under 20 seconds and delegate end_call the moment you finish speaking. Never stay on the line after a voicemail.',
		'',
		'# Delegation policy',
		'Delegate to the backend when: you need to press keys (send_dtmf); you are on hold or asked to wait (wait_on_hold); the goal is achieved, cannot be achieved, or the other party hung up (end_call). Say goodbye BEFORE delegating end_call. Do not delegate for ordinary conversation, and never guess the result of a delegated action.',
	]
	if (record.hold_count > 0 || record.transcript.length > 0) {
		sections.push(
			'',
			'# Reconnected',
			`You were reconnected after waiting on hold (${record.hold_count} time(s) so far). The first audio you hear is what the person said as they picked up — respond to it. If it is still hold music or a recording, delegate wait_on_hold again without speaking.`,
			'',
			'# Call so far',
			formatTranscript(record, 80) || '(nothing said yet)',
		)
	}
	return sections.join('\n')
}

/** `session` object for GPT-Live `session.start`. μ-law both ways so Twilio frames pass through untouched. */
export function buildLiveSession(record: CallRecord, config: PhoneConfig): Record<string, unknown> {
	return {
		model: config.liveModel,
		instructions: buildLiveInstructions(record),
		audio: {
			format: { type: 'audio/pcmu', rate: 8000 },
			output: { voice: config.voice },
		},
		delegation: {
			type: 'responses',
			responses: {
				model: config.backendModel,
				instructions: BACKEND_INSTRUCTIONS,
				tools: LIVE_TOOLS,
				tool_choice: 'auto',
				parallel_tool_calls: false,
			},
		},
	}
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/** Request body asking the backend model to summarize a call that ended without `end_call`. */
export function buildSummaryRequest(
	record: CallRecord,
	config: PhoneConfig,
): Record<string, unknown> {
	return {
		model: config.backendModel,
		instructions:
			'You summarize a phone call for the person who asked for it. Write 2-4 plain sentences: what happened, what the other party said, any reference numbers, names, dates, or amounts, and the next step. State only what the transcript supports. If almost nothing was said, say that in one sentence.',
		input: [
			`Goal of the call: ${record.goal}`,
			`How it ended: ${record.outcome ?? 'unknown'}`,
			'',
			'Transcript ("caller" is the other party, "agent" is our assistant):',
			formatTranscript(record, 200) || '(nothing was said)',
		].join('\n'),
	}
}

/** Text of a Responses API result: the `output_text` parts of its message items. */
export function extractResponseText(json: unknown): string | null {
	const output = (json as { output?: Array<{ type?: string; content?: unknown }> } | null)?.output
	if (!Array.isArray(output)) return null
	const parts: string[] = []
	for (const item of output) {
		if (item.type !== 'message' || !Array.isArray(item.content)) continue
		for (const part of item.content as Array<{ type?: string; text?: unknown }>) {
			if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text)
		}
	}
	const text = parts.join('').trim()
	return text || null
}

/**
 * Only `end_call` writes a summary. When the other party hangs up first (or the
 * call times out) the requester would get a bare transcript, so ask the backend
 * model for one. Best-effort: returns null on any failure.
 */
export async function writeCallSummary(
	config: PhoneConfig,
	record: CallRecord,
): Promise<string | null> {
	const res = await fetch(OPENAI_RESPONSES_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${config.openaiApiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(buildSummaryRequest(record, config)),
		signal: AbortSignal.timeout(20_000),
	})
	if (!res.ok) throw new Error(`summary request failed: ${res.status}`)
	return extractResponseText(await res.json())
}

/** What tools return to hosts: the record minus nothing, but with a compact transcript. */
export function summarizeCall(record: CallRecord): Record<string, unknown> {
	return {
		call_id: record.id,
		to: record.to,
		from: record.from,
		status: record.status,
		phase: record.phase,
		outcome: record.outcome,
		summary: record.summary,
		error: record.error,
		hangup_cause: record.hangup_cause,
		created_at: record.created_at,
		answered_at: record.answered_at,
		ended_at: record.ended_at,
		live_seconds: Math.round(record.live_seconds),
		hold_count: record.hold_count,
		transcript: formatTranscript(record),
		events: record.events.slice(-60),
	}
}
