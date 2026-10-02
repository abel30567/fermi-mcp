#!/usr/bin/env node
// Local end-to-end test for outbound phone calls with no real carrier.
//
// This script stands in for Twilio: it serves the REST endpoints the worker
// calls (create call, update call), sends HMAC-signed status callbacks, and
// opens the media WebSocket to the worker, streaming a scripted "callee"
// (phone menu → hold music → a human agent) as 20 ms μ-law frames. Pressing a
// key works the way it does on Twilio: the worker replaces the call's TwiML
// with <Play digits>, and the media stream is torn down and reconnected.
// GPT-Live is real: the worker talks to OpenAI with your OPENAI_API_KEY.
//
//   node scripts/phone-sim.mjs      # runs the scenario against a local `wrangler dev`
//
// See "Local test" in docs/USAGE.md §8 for the full recipe.
// Needs macOS `say` and `ffmpeg` to synthesize the callee's audio.

import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const WORKER = process.env.PHONE_SIM_WORKER ?? 'http://127.0.0.1:8787'
const PORT = Number(process.env.PHONE_SIM_PORT ?? 8899)
const DIR = process.env.PHONE_SIM_DIR ?? '/tmp/fermi-phone-sim'
const HOLD_SECONDS = Number(process.env.PHONE_SIM_HOLD_SECONDS ?? 25)
const VOICE = process.env.PHONE_SIM_VOICE ?? 'Samantha'
// PHONE_SIM_CALLEE_HANGS_UP=1: the human hangs up right after answering the request,
// before the agent can end the call — exercises the summary written on remote hang-up.
const CALLEE_HANGS_UP = process.env.PHONE_SIM_CALLEE_HANGS_UP === '1'
// Must match TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in the worker's env file.
const ACCOUNT_SID = 'ACsim'
const AUTH_TOKEN = 'sim-token'
const CALL_SID = 'CAphonesim0000000000000000000000'
const FRAME_BYTES = 160 // 20 ms of 8 kHz μ-law
const SILENCE = 0xff

const started = Date.now()
const log = (...args) =>
	console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s]`, ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

mkdirSync(DIR, { recursive: true })

// -- callee audio ------------------------------------------------------------

function speech(name, text) {
	const aiff = join(DIR, `${name}.aiff`)
	const ulaw = join(DIR, `${name}.ulaw`)
	execFileSync('say', ['-v', VOICE, '-o', aiff, text])
	execFileSync('ffmpeg', [
		'-y',
		'-loglevel',
		'error',
		'-i',
		aiff,
		'-ar',
		'8000',
		'-ac',
		'1',
		'-f',
		'mulaw',
		ulaw,
	])
	return readFileSync(ulaw)
}

function holdMusic(seconds) {
	const ulaw = join(DIR, 'music.ulaw')
	const tone = (hz) => [
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=${hz}:sample_rate=8000:duration=${seconds}`,
	]
	execFileSync('ffmpeg', [
		'-y',
		'-loglevel',
		'error',
		...tone(392),
		...tone(494),
		...tone(587),
		'-filter_complex',
		'amix=inputs=3,tremolo=f=2:d=0.4,volume=3',
		'-ar',
		'8000',
		'-ac',
		'1',
		'-f',
		'mulaw',
		ulaw,
	])
	return readFileSync(ulaw)
}

log('synthesizing callee audio…')
const clips = {
	ivr: speech(
		'ivr',
		'Thank you for calling the Internal Revenue Service. For questions about a penalty or a notice you received, press 2. For all other questions, press 3.',
	),
	hold: speech(
		'hold',
		'All of our representatives are currently assisting other callers. Your estimated wait time is ten minutes. Please stay on the line.',
	),
	music: holdMusic(HOLD_SECONDS),
	human: speech(
		'human',
		'Thank you for holding. This is Maria with the I R S. How can I help you today?',
	),
	approve: speech(
		'approve',
		'I can help with that. I have approved the first time penalty abatement for tax year 2024. Your confirmation number is 4 7 2 9 1. Is there anything else I can help you with?',
	),
	bye: speech('bye', 'You are welcome. Have a nice day. Goodbye.'),
}

// -- minimal MCP client (streamable HTTP, auth disabled in local dev) --------

let mcpSession
let rpcId = 0
async function mcp(method, params, notification = false) {
	const headers = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	}
	if (mcpSession) headers['mcp-session-id'] = mcpSession
	const id = notification ? undefined : ++rpcId
	const res = await fetch(`${WORKER}/mcp`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	})
	mcpSession = res.headers.get('mcp-session-id') ?? mcpSession
	const text = await res.text()
	if (notification) return null
	const messages = text
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => JSON.parse(line.slice(6)))
	const message =
		messages.find((m) => m.id === id) ?? (text.trim().startsWith('{') ? JSON.parse(text) : null)
	if (!message)
		throw new Error(`mcp ${method}: unexpected response ${res.status}: ${text.slice(0, 300)}`)
	if (message.error) throw new Error(`mcp ${method}: ${JSON.stringify(message.error)}`)
	return message.result
}
async function tool(name, args) {
	const result = await mcp('tools/call', { name, arguments: args })
	return JSON.parse(result.content[0].text)
}

// -- fake Twilio ---------------------------------------------------------------

const call = { dial: null, streamUrl: null, ws: null, streamSid: null, ended: false, endedBy: null }
const dtmf = []
const checks = []
const check = (name, pass, detail = '') => {
	checks.push({ name, pass })
	log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const streamUrlOf = (twiml) => twiml.match(/<Stream url="([^"]+)"/)?.[1] ?? null

/** Signed the way Twilio does: HMAC-SHA1 over the URL + sorted name/value pairs. */
async function statusCallback(status, { tamper = false } = {}) {
	const fields = {
		AccountSid: ACCOUNT_SID,
		CallSid: CALL_SID,
		CallStatus: status,
		Direction: 'outbound-api',
		From: call.dial.From,
		To: call.dial.To,
		Timestamp: new Date().toUTCString(),
	}
	const url = call.dial.StatusCallback
	const data = Object.keys(fields)
		.sort()
		.reduce((acc, key) => acc + key + fields[key], url)
	const signature = createHmac('sha1', AUTH_TOKEN).update(data).digest('base64')
	if (tamper) fields.CallStatus = 'completed'
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-twilio-signature': signature,
		},
		body: new URLSearchParams(fields).toString(),
	})
	return res.status
}

const readForm = (req) =>
	new Promise((resolve) => {
		let data = ''
		req.on('data', (chunk) => {
			data += chunk
		})
		req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))))
	})

const server = createServer(async (req, res) => {
	const body = req.method === 'POST' ? await readForm(req) : {}
	const send = (status, json) => {
		res.writeHead(status, { 'content-type': 'application/json' })
		res.end(JSON.stringify(json))
	}
	const expected = `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`
	if (req.headers.authorization !== expected)
		return send(401, { code: 20003, message: 'Authenticate' })
	const base = `/2010-04-01/Accounts/${ACCOUNT_SID}/Calls`
	if (req.method === 'POST' && req.url === `${base}.json`) {
		call.dial = body
		call.streamUrl = streamUrlOf(body.Twiml ?? '')
		log(`twilio: create call ${body.From} → ${body.To} (limit ${body.TimeLimit}s)`)
		send(201, { sid: CALL_SID, status: 'queued', direction: 'outbound-api' })
		setTimeout(() => answer().catch((e) => log('answer failed:', e)), 300)
		return
	}
	if (req.method === 'POST' && req.url === `${base}/${CALL_SID}.json`) {
		if (body.Status === 'completed') {
			log('twilio: hangup (Status=completed)')
			send(200, { sid: CALL_SID, status: 'completed' })
			endCall('agent')
			return
		}
		if (body.Twiml) {
			const digits = body.Twiml.match(/<Play digits="([^"]+)"/)?.[1] ?? ''
			log(`twilio: TwiML update, <Play digits="${digits}"> then reconnect the stream`)
			if (digits) dtmf.push(digits)
			send(200, { sid: CALL_SID, status: 'in-progress' })
			restartStream(streamUrlOf(body.Twiml), digits).catch((e) => log('restart failed:', e))
			return
		}
	}
	send(404, { code: 20404, message: `no route ${req.method} ${req.url}` })
})

// -- media stream --------------------------------------------------------------

let calleeQueue = Buffer.alloc(0) // what the simulated callee still has to say
let agentQueue = Buffer.alloc(0) // audio from the worker waiting to "play" on the line
const calleeTrack = []
const agentTrack = []
let ticks = 0
let streamStart = 0
let ticker = null
let agentBytes = 0
let wrongStreamSid = 0
let streamRestarts = 0
let lastAgentAudioTick = -1 // last tick where the agent was audibly speaking
const agentReceived = [] // [wall-clock ms, bytes] of every media frame from the worker
const marks = {} // wall-clock times of scenario moments, for latency reporting

function ulawToPcm16(byte) {
	const u = ~byte & 0xff
	const sample = ((((u & 0x0f) << 3) + 0x84) << ((u >> 4) & 0x07)) - 0x84
	return u & 0x80 ? -sample : sample
}

function frameRms(frame) {
	let sum = 0
	for (const byte of frame) sum += ulawToPcm16(byte) ** 2
	return Math.sqrt(sum / frame.length)
}

function take(queue) {
	if (queue.length >= FRAME_BYTES)
		return [queue.subarray(0, FRAME_BYTES), queue.subarray(FRAME_BYTES), true]
	const frame = Buffer.alloc(FRAME_BYTES, SILENCE)
	queue.copy(frame)
	return [frame, Buffer.alloc(0), queue.length > 0]
}

function pump() {
	const due = Math.floor((performance.now() - streamStart) / 20)
	while (ticks < due && !call.ended) {
		let frame
		;[frame, calleeQueue] = take(calleeQueue)
		calleeTrack.push(frame)
		let agentFrame
		let hadAudio
		;[agentFrame, agentQueue, hadAudio] = take(agentQueue)
		agentTrack.push(agentFrame)
		// GPT-Live streams digital silence between utterances; only energy counts as speech.
		if (hadAudio && frameRms(agentFrame) > 300) lastAgentAudioTick = ticks
		// While the stream is down (DTMF restart) the callee's audio is simply not delivered.
		if (call.ws?.readyState === WebSocket.OPEN && call.streamSid) {
			call.ws.send(
				JSON.stringify({
					event: 'media',
					sequenceNumber: String(ticks + 2),
					media: {
						track: 'inbound',
						chunk: String(ticks + 1),
						timestamp: String(ticks * 20),
						payload: frame.toString('base64'),
					},
					streamSid: call.streamSid,
				}),
			)
		}
		ticks++
	}
}

const say = async (clip) => {
	calleeQueue = Buffer.concat([calleeQueue, clip])
	while (calleeQueue.length > 0 && !call.ended) await sleep(50)
}
const waitFor = async (condition, maxMs) => {
	const deadline = Date.now() + maxMs
	while (Date.now() < deadline && !call.ended) {
		if (condition()) return true
		await sleep(50)
	}
	return condition()
}
/** Wait for the agent to start talking and then go quiet (its turn is over). */
async function agentTurn(maxMs, quietMs = 1800) {
	const from = ticks
	const spoke = await waitFor(() => lastAgentAudioTick >= from, maxMs)
	if (!spoke) return false
	await waitFor(
		() => agentQueue.length === 0 && (ticks - lastAgentAudioTick) * 20 >= quietMs,
		maxMs,
	)
	return true
}

function openStream(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url)
		const streamSid = `MZ${randomUUID().replace(/-/g, '')}`
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }))
			ws.send(
				JSON.stringify({
					event: 'start',
					sequenceNumber: '1',
					start: {
						accountSid: ACCOUNT_SID,
						streamSid,
						callSid: CALL_SID,
						tracks: ['inbound'],
						customParameters: {},
						mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
					},
					streamSid,
				}),
			)
			call.ws = ws
			call.streamSid = streamSid
			resolve(ws)
		})
		ws.addEventListener('message', (event) => {
			const msg = JSON.parse(String(event.data))
			if (msg.event === 'media' && msg.media?.payload) {
				if (msg.streamSid !== streamSid) wrongStreamSid++
				const audio = Buffer.from(msg.media.payload, 'base64')
				agentBytes += audio.length
				agentReceived.push([Date.now(), audio.length])
				agentQueue = Buffer.concat([agentQueue, audio])
			} else if (msg.event === 'clear') {
				agentQueue = Buffer.alloc(0)
			}
		})
		ws.addEventListener('close', () => {
			// The worker closing the current stream ends <Connect>, and with it the call.
			if (call.ws === ws && !call.ended) endCall('agent')
		})
		ws.addEventListener('error', (e) => reject(new Error(`stream error: ${e.message ?? e}`)))
	})
}

/** What Twilio does on a TwiML update: stop the stream, play the digits, connect a new one. */
async function restartStream(url, digits) {
	const old = call.ws
	call.ws = null
	call.streamSid = null
	try {
		old?.send(JSON.stringify({ event: 'stop', sequenceNumber: String(ticks + 2) }))
		old?.close()
	} catch {}
	await sleep(300 + 500 * digits.length)
	if (call.ended) return
	await openStream(url)
	streamRestarts++
	log('twilio: media stream reconnected')
}

async function answer() {
	const tampered = await statusCallback('initiated', { tamper: true })
	check('status callback with a bad signature is rejected', tampered === 401, `status ${tampered}`)
	const initiated = await statusCallback('initiated')
	check('signed status callback is accepted', initiated === 200, `status ${initiated}`)
	await statusCallback('ringing')
	await sleep(800)
	await statusCallback('in-progress')
	log('twilio: answered, opening media stream')
	await openStream(call.streamUrl)
	streamStart = performance.now()
	ticker = setInterval(pump, 10)
	scenario().catch((e) => log('scenario failed:', e))
}

function endCall(by) {
	if (call.ended) return
	call.ended = true
	call.endedBy = by
	clearInterval(ticker)
	try {
		if (by === 'callee') call.ws?.send(JSON.stringify({ event: 'stop', streamSid: call.streamSid }))
		call.ws?.close()
	} catch {}
	statusCallback('completed')
		.then((status) => log(`twilio: completed status callback → ${status}`))
		.catch(() => {})
}

let callId = null
let midHold = null

async function scenario() {
	await sleep(700)
	log('callee: phone menu')
	await say(clips.ivr)
	const pressed = await waitFor(() => dtmf.length > 0, 30_000)
	check(
		'agent pressed a menu key (send_dtmf)',
		pressed,
		pressed ? `digits "${dtmf.join(',')}"` : 'none within 30 s',
	)
	await waitFor(() => call.streamSid !== null, 10_000)
	check('call survived the DTMF stream restart', !call.ended && streamRestarts === 1)
	await sleep(600)
	log('callee: "please stay on the line" + hold music')
	await say(clips.hold)
	setTimeout(
		async () => {
			midHold = await tool('phone_call_status', { call_id: callId }).catch((e) => ({
				error: String(e),
			}))
			log(`status mid-hold: phase=${midHold.call?.phase} hold_count=${midHold.call?.hold_count}`)
		},
		HOLD_SECONDS * 1000 * 0.75,
	)
	await say(clips.music)
	await sleep(400)
	log('callee: a human picks up')
	await say(clips.human)
	marks.humanDone = Date.now()
	const fromTick = ticks
	waitFor(() => lastAgentAudioTick >= fromTick, 30_000).then((spoke) => {
		if (spoke) marks.agentReply = Date.now()
	})
	const replied = await agentTurn(30_000)
	check('agent answered the human after the hold', replied)
	if (call.ended) return
	log('callee: approves the request')
	await say(clips.approve)
	if (CALLEE_HANGS_UP) {
		await sleep(500)
		log('callee hangs up right away')
		endCall('callee')
		return
	}
	await agentTurn(30_000)
	if (!call.ended) {
		log('callee: goodbye')
		await say(clips.bye)
		await waitFor(() => call.ended, 25_000)
	}
	if (!call.ended) {
		log('callee hangs up (agent did not end the call)')
		endCall('callee')
	}
}

// -- recording -----------------------------------------------------------------

function writeRecording(path) {
	const frames = Math.min(calleeTrack.length, agentTrack.length)
	const samples = frames * FRAME_BYTES
	const wav = Buffer.alloc(44 + samples * 4)
	wav.write('RIFF', 0)
	wav.writeUInt32LE(36 + samples * 4, 4)
	wav.write('WAVEfmt ', 8)
	wav.writeUInt32LE(16, 16)
	wav.writeUInt16LE(1, 20) // PCM
	wav.writeUInt16LE(2, 22) // stereo: left = callee, right = agent
	wav.writeUInt32LE(8000, 24)
	wav.writeUInt32LE(8000 * 4, 28)
	wav.writeUInt16LE(4, 32)
	wav.writeUInt16LE(16, 34)
	wav.write('data', 36)
	wav.writeUInt32LE(samples * 4, 40)
	let offset = 44
	for (let f = 0; f < frames; f++) {
		for (let i = 0; i < FRAME_BYTES; i++) {
			wav.writeInt16LE(ulawToPcm16(calleeTrack[f][i]), offset)
			wav.writeInt16LE(ulawToPcm16(agentTrack[f][i]), offset + 2)
			offset += 4
		}
	}
	writeFileSync(path, wav)
}

// -- run -----------------------------------------------------------------------

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
log(`fake Twilio listening on http://127.0.0.1:${PORT}`)

await mcp('initialize', {
	protocolVersion: '2025-03-26',
	capabilities: {},
	clientInfo: { name: 'phone-sim', version: '1.0' },
})
await mcp('notifications/initialized', {}, true)

const args = {
	to: '+18008291040',
	goal: 'Request a first-time penalty abatement for the failure-to-file penalty on the 2024 tax year, and get a confirmation number.',
	context:
		'This is a test call. You are calling on behalf of Jordan Sample, a fictional taxpayer. Tax year: 2024. Callback number: 555-0100.',
	notify_channel: 'tg',
	notify_chat_id: 'phone-sim-chat',
	max_minutes: 10,
}
let start = await tool('phone_call_start', args)
check('phone_call_start is approval-gated', start.status === 'pending_approval')
if (start.status === 'pending_approval')
	start = await tool('phone_call_start', { ...args, approval_token: start.token })
if (!start.ok) {
	console.error('phone_call_start failed:', JSON.stringify(start, null, 2))
	process.exit(1)
}
callId = start.call_id
log(`call started: ${callId}`)

await waitFor(() => call.ended, 6 * 60_000)
if (!call.ended) endCall('callee')
await sleep(6000) // let the worker finalize and enqueue the completion task

const final = await tool('phone_call_status', { call_id: callId })
const tasks = await tool('task_list', { status: 'pending', limit: 50 })
const events = (final.call?.events ?? []).map((e) => e.type)
const notify = (tasks.tasks ?? []).find((t) => t.sender === `phone:${callId}`)
const eventAt = (type) => (final.call?.events ?? []).find((e) => e.type === type)?.at
const holdStart = eventAt('hold_start')
const holdEnd = eventAt('hold_end')
// Anything the worker sent to the line while it reported `hold` (250 ms slack for frames in flight).
const agentBytesDuringHold =
	holdStart && holdEnd
		? agentReceived
				.filter(([at]) => at > holdStart + 250 && at < holdEnd)
				.reduce((sum, [, bytes]) => sum + bytes, 0)
		: -1

check('GPT-Live session opened', events.includes('live_open'))
check(
	'agent audio reached the line with the right streamSid',
	agentBytes > 0 && wrongStreamSid === 0,
	`${(agentBytes / 8000).toFixed(1)} s, ${wrongStreamSid} mislabelled frames`,
)
check('agent went on hold (wait_on_hold)', events.includes('hold_start'))
check(
	'voice model was closed during hold',
	midHold?.call?.phase === 'hold' && agentBytesDuringHold === 0,
	`phase=${midHold?.call?.phase}, agent audio during hold=${agentBytesDuringHold} bytes`,
)
check(
	'hold detector re-engaged the model',
	events.includes('hold_end') && events.includes('live_reconnect'),
)
if (CALLEE_HANGS_UP) {
	check(
		'summary written after the callee hung up first',
		call.endedBy === 'callee' && events.includes('summary_written'),
		`ended by ${call.endedBy}`,
	)
} else {
	check(
		'agent ended the call itself (end_call)',
		call.endedBy === 'agent' && events.includes('end_requested'),
		`ended by ${call.endedBy}`,
	)
}
check(
	'outcome and summary recorded',
	Boolean(final.call?.outcome && final.call?.summary),
	`outcome=${final.call?.outcome}`,
)
check('completion task enqueued for the requesting chat', Boolean(notify))

writeRecording(join(DIR, 'call.wav'))
writeFileSync(join(DIR, 'result.json'), JSON.stringify({ final, notify, checks }, null, 2))

console.log('\n===== transcript =====')
console.log(final.call?.transcript || '(empty)')
console.log('\n===== summary =====')
console.log(`outcome: ${final.call?.outcome}\nsummary: ${final.call?.summary}`)
console.log(
	`voice-model seconds: ${final.call?.live_seconds}, hold periods: ${final.call?.hold_count}`,
)
console.log(`events: ${events.join(' → ')}`)
if (holdStart && holdEnd)
	console.log(`hold: ${((holdEnd - holdStart) / 1000).toFixed(1)} s with the voice model closed`)
if (marks.agentReply) {
	console.log(
		`pickup latency (human stops talking → agent starts): ${((marks.agentReply - marks.humanDone) / 1000).toFixed(1)} s`,
	)
}
console.log(`\nrecording (left = callee, right = agent): ${join(DIR, 'call.wav')}`)
console.log(`full result: ${join(DIR, 'result.json')}`)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
server.close()
process.exit(failed.length ? 1 : 0)
