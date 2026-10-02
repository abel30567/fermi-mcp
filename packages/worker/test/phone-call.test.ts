import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	type CallRecord,
	type PhoneConfig,
	appendTranscript,
	buildDialParams,
	buildLiveSession,
	buildNotifyPayload,
	buildSummaryRequest,
	extractResponseText,
	parseStatusCallback,
	readPhoneConfig,
	sanitizeDigits,
	streamTwiml,
	unansweredOutcome,
	verifyTwilioSignature,
} from '../src/lib/phone-call.ts'
import { FRAME_MS, HoldDetector, ulawFrameRms, ulawToPcm16 } from '../src/lib/phone-hold.ts'
import { putSecret } from '../src/lib/secrets-store.ts'
import { clearSecrets, setupSecretsSchema } from './setup-d1.ts'

const workerEnv = env as unknown as Env

const config: PhoneConfig = {
	twilioAccountSid: 'ACtest',
	twilioAuthToken: 'token',
	twilioApiBase: 'https://api.twilio.com',
	fromNumber: '+15550001111',
	openaiApiKey: 'sk',
	publicUrl: 'https://fermi.example.workers.dev',
	liveModel: 'gpt-live-1',
	backendModel: 'gpt-6-luna',
	voice: 'marin',
}

function record(overrides: Partial<CallRecord> = {}): CallRecord {
	return {
		id: 'call-1',
		to: '+18005551212',
		from: config.fromNumber,
		goal: 'Ask for a penalty abatement',
		context: null,
		status: 'active',
		phase: 'live',
		outcome: null,
		summary: null,
		error: null,
		transcript: [],
		events: [],
		call_sid: 'CAabc',
		hangup_cause: null,
		created_at: 1_000_000,
		answered_at: 1_010_000,
		ended_at: null,
		deadline_at: 5_000_000,
		notify: null,
		live_seconds: 0,
		hold_count: 0,
		...overrides,
	}
}

describe('phone config', () => {
	beforeAll(async () => {
		await setupSecretsSchema()
	})
	beforeEach(async () => {
		await clearSecrets()
	})

	it('reports every missing required value', async () => {
		const result = await readPhoneConfig(workerEnv)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.missing).toEqual([
			'TWILIO_ACCOUNT_SID',
			'TWILIO_AUTH_TOKEN',
			'TWILIO_FROM_NUMBER',
			'OPENAI_API_KEY',
			'FERMI_PUBLIC_URL',
		])
	})

	it('reads values from the secrets store and applies defaults', async () => {
		const values: Record<string, string> = {
			TWILIO_ACCOUNT_SID: 'ACtest',
			TWILIO_AUTH_TOKEN: 'token',
			TWILIO_FROM_NUMBER: '+15550001111',
			OPENAI_API_KEY: 'sk',
			FERMI_PUBLIC_URL: 'https://fermi.example.workers.dev/',
		}
		for (const [name, value] of Object.entries(values)) {
			await putSecret({ name, value, scope: 'app' }, workerEnv)
		}
		const result = await readPhoneConfig(workerEnv)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.config).toMatchObject({
			twilioAccountSid: 'ACtest',
			twilioApiBase: 'https://api.twilio.com',
			fromNumber: '+15550001111',
			publicUrl: 'https://fermi.example.workers.dev',
			liveModel: 'gpt-live-1',
			backendModel: 'gpt-6-luna',
			voice: 'marin',
		})
	})
})

describe('twilio helpers', () => {
	it('builds TwiML that streams to the call DO, optionally pressing keys first', () => {
		expect(streamTwiml(config, 'call-1', 'tok')).toBe(
			'<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://fermi.example.workers.dev/phone/stream/call-1/tok"/></Connect></Response>',
		)
		expect(streamTwiml(config, 'call-1', 'tok', '2w#"<x>')).toContain(
			'<Response><Play digits="2w#"/><Connect>',
		)
		expect(sanitizeDigits('1 2-3*#wWaZ')).toBe('123*#wW')
	})

	it('builds a dial request with status callbacks pointing back at the worker', () => {
		const params = buildDialParams({
			config,
			callId: 'call-1',
			to: '+18005551212',
			streamToken: 'tok',
			maxSeconds: 5400,
		})
		expect(params.get('To')).toBe('+18005551212')
		expect(params.get('From')).toBe('+15550001111')
		expect(params.get('Twiml')).toBe(streamTwiml(config, 'call-1', 'tok'))
		expect(params.get('StatusCallback')).toBe(
			'https://fermi.example.workers.dev/phone/webhook?call=call-1',
		)
		expect(params.getAll('StatusCallbackEvent')).toEqual([
			'initiated',
			'ringing',
			'answered',
			'completed',
		])
		expect(params.get('TimeLimit')).toBe('5400')
		const short = buildDialParams({
			config,
			callId: 'x',
			to: '+1',
			streamToken: 't',
			maxSeconds: 5,
		})
		expect(short.get('TimeLimit')).toBe('30')
	})

	it('parses status callbacks and maps unanswered outcomes', () => {
		const url = new URL('https://fermi.example.workers.dev/phone/webhook?call=call-1')
		const params = new URLSearchParams({ CallSid: 'CAabc', CallStatus: 'no-answer' })
		expect(parseStatusCallback(url, params)).toEqual({
			call_id: 'call-1',
			call_sid: 'CAabc',
			status: 'no-answer',
		})
		expect(parseStatusCallback(new URL('https://x/phone/webhook'), params)).toBeNull()
		expect(parseStatusCallback(url, new URLSearchParams())).toBeNull()
		expect(unansweredOutcome('busy')).toBe('busy')
		expect(unansweredOutcome('no-answer')).toBe('no_answer')
		expect(unansweredOutcome('failed')).toBe('failed')
		expect(unansweredOutcome('completed')).toBe('no_answer')
	})

	it('verifies the Twilio webhook signature and rejects tampering', async () => {
		// Worked example from Twilio's webhook security documentation.
		const authToken = '12345'
		const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
		const params = new URLSearchParams({
			CallSid: 'CA1234567890ABCDE',
			Caller: '+12349013030',
			Digits: '1234',
			From: '+12349013030',
			To: '+18005551212',
		})
		const signature = '0/KCTR6DLpKmkAf8muzZqo1nDgQ='
		expect(await verifyTwilioSignature({ authToken, signature, url, params })).toBe(true)
		// field order in the body must not matter
		const shuffled = new URLSearchParams([...params.entries()].reverse())
		expect(await verifyTwilioSignature({ authToken, signature, url, params: shuffled })).toBe(true)

		const tampered = new URLSearchParams(params)
		tampered.set('To', '+18005550000')
		expect(await verifyTwilioSignature({ authToken, signature, url, params: tampered })).toBe(false)
		expect(await verifyTwilioSignature({ authToken, signature, url: `${url}&x=1`, params })).toBe(
			false,
		)
		expect(await verifyTwilioSignature({ authToken: 'wrong', signature, url, params })).toBe(false)
		expect(await verifyTwilioSignature({ authToken, signature: null, url, params })).toBe(false)
	})
})

describe('hold detector', () => {
	const LOUD = 3000
	const QUIET = 0

	function run(detector: HoldDetector, segments: Array<[number, number]>, startMs = 0): number[] {
		const fired: number[] = []
		let t = startMs
		for (const [rms, ms] of segments) {
			for (let i = 0; i < ms / FRAME_MS; i++) {
				if (detector.feed(rms, t)) fired.push(t)
				t += FRAME_MS
			}
		}
		return fired
	}

	it('never fires on continuous hold music', () => {
		expect(run(new HoldDetector(), [[LOUD, 60_000]])).toEqual([])
	})

	it('fires once when a greeting is followed by silence, then waits for a new burst', () => {
		const detector = new HoldDetector()
		const fired = run(detector, [
			[QUIET, 4000],
			[LOUD, 1500], // "Thanks for holding, how can I help?"
			[QUIET, 6000], // agent waits
		])
		expect(fired).toHaveLength(1)
		expect(fired[0]).toBe(4000 + 1500 + 1200 - FRAME_MS)
		expect(detector.utteranceStartedAt).toBe(4000)
	})

	it('ignores short blips, pauses inside an utterance, and the arm delay', () => {
		expect(
			run(new HoldDetector(), [
				[QUIET, 4000],
				[LOUD, 100],
				[QUIET, 5000],
			]),
		).toEqual([])
		expect(
			run(new HoldDetector(), [
				[LOUD, 1000],
				[QUIET, 5000],
			]),
		).toEqual([]) // inside arm delay
		// two words with a 300 ms pause still count as one burst
		expect(
			run(new HoldDetector(), [
				[QUIET, 4000],
				[LOUD, 300],
				[QUIET, 300],
				[LOUD, 300],
				[QUIET, 3000],
			]),
		).toHaveLength(1)
	})

	it('applies a cooldown across resets so a false positive cannot loop', () => {
		const detector = new HoldDetector({ cooldownMs: 20_000 })
		const first = run(detector, [
			[QUIET, 4000],
			[LOUD, 1000],
			[QUIET, 3000],
		])
		expect(first).toHaveLength(1)
		detector.reset() // model said wait_on_hold again
		const soon = run(
			detector,
			[
				[QUIET, 4000],
				[LOUD, 1000],
				[QUIET, 3000],
			],
			8000,
		)
		expect(soon).toEqual([])
		const later = run(
			detector,
			[
				[QUIET, 4000],
				[LOUD, 1000],
				[QUIET, 3000],
			],
			40_000,
		)
		expect(later).toHaveLength(1)
	})

	it('measures μ-law frame energy', () => {
		expect(ulawToPcm16(0xff)).toBe(0)
		expect(ulawToPcm16(0x00)).toBeLessThan(-30_000)
		expect(ulawFrameRms(new Uint8Array(160).fill(0xff))).toBe(0)
		expect(ulawFrameRms(new Uint8Array(160).fill(0x10))).toBeGreaterThan(5000)
	})
})

describe('call record helpers', () => {
	it('merges same-speaker fragments and splits on speaker change or gaps', () => {
		const lines: CallRecord['transcript'] = []
		appendTranscript(lines, 'caller', 'Thank you ', 1000)
		appendTranscript(lines, 'caller', 'for calling.', 1600)
		appendTranscript(lines, 'agent', 'Hi, ', 2500)
		appendTranscript(lines, 'agent', 'I am calling about', 3000)
		appendTranscript(lines, 'agent', 'a new topic', 9000)
		appendTranscript(lines, 'agent', '', 9100)
		expect(lines.map((l) => `${l.role}:${l.text}`)).toEqual([
			'caller:Thank you for calling.',
			'agent:Hi, I am calling about',
			'agent:a new topic',
		])
	})

	it('builds a GPT-Live session with PCMU pass-through and the call tools', () => {
		const session = buildLiveSession(record(), config)
		expect(session.model).toBe('gpt-live-1')
		expect(session.audio).toEqual({
			format: { type: 'audio/pcmu', rate: 8000 },
			output: { voice: 'marin' },
		})
		const delegation = session.delegation as {
			responses: { model: string; tools: Array<{ name: string }> }
		}
		expect(delegation.responses.model).toBe('gpt-6-luna')
		expect(delegation.responses.tools.map((t) => t.name)).toEqual([
			'send_dtmf',
			'wait_on_hold',
			'end_call',
		])
		expect(session.instructions).toContain('Ask for a penalty abatement')
		expect(session.instructions).not.toContain('# Reconnected')

		const resumed = record({ hold_count: 1 })
		appendTranscript(resumed.transcript, 'caller', 'Please hold.', 1_020_000)
		const again = buildLiveSession(resumed, config)
		expect(again.instructions).toContain('# Reconnected')
		expect(again.instructions).toContain('+10s caller: Please hold.')
	})

	it('formats the completion task payload for the daemon', () => {
		const done = record({
			status: 'ended',
			phase: 'ended',
			outcome: 'success',
			summary: 'Abatement approved, ref 12345.',
			ended_at: 1_300_000,
			live_seconds: 95.4,
			hold_count: 2,
		})
		appendTranscript(done.transcript, 'agent', 'Goodbye.', 1_290_000)
		const payload = buildNotifyPayload(done)
		expect(payload).toContain('[Phone call call-1 to +18005551212 ended — outcome: success]')
		expect(payload).toContain('Summary: Abatement approved, ref 12345.')
		expect(payload).toContain('300s total, 95s with the voice model, 2 hold period(s)')
		expect(payload).toContain('+280s agent: Goodbye.')
		expect(payload).toContain('phone_call_status with call_id call-1')
	})
	it('asks the backend model for a summary when a call ends without one', () => {
		const ended = record({ status: 'ended', phase: 'ended', outcome: 'remote_hangup' })
		appendTranscript(ended.transcript, 'caller', 'Your reference number is 4 7 2.', 1_020_000)
		const request = buildSummaryRequest(ended, config)
		expect(request.model).toBe('gpt-6-luna')
		expect(request.input).toContain('Goal of the call: Ask for a penalty abatement')
		expect(request.input).toContain('How it ended: remote_hangup')
		expect(request.input).toContain('+10s caller: Your reference number is 4 7 2.')
	})

	it('extracts the text of a Responses API result', () => {
		expect(
			extractResponseText({
				output: [
					{ type: 'reasoning', summary: [] },
					{
						type: 'message',
						content: [
							{ type: 'output_text', text: 'They approved it. ' },
							{ type: 'output_text', text: 'Reference 472.' },
						],
					},
				],
			}),
		).toBe('They approved it. Reference 472.')
		expect(extractResponseText({ output: [] })).toBeNull()
		expect(extractResponseText({ error: { message: 'nope' } })).toBeNull()
	})
})
