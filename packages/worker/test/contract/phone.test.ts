import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PHONE_REQUIRED_CONFIG } from '../../src/lib/phone-call.ts'
import { putSecret } from '../../src/lib/secrets-store.ts'
import { callApproved } from './approval.ts'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Outbound calls run in the local PhoneCallDO; Twilio is faked with fetchMock.
// The phone config is stored as app-scope secrets, as phone_call_start's hint says.

const TWILIO = 'https://api.twilio.com'
const ACCOUNT = 'AC_contract'
const AUTH = 'twilio-contract-token'
const TO = '+15555550100'
const FROM = '+15555550101'

interface Captured {
	path: string
	authorization: string
	form: URLSearchParams
}

let client: McpClient

beforeEach(async () => {
	client = new McpClient()
	await client.initialize()
})

afterEach(async () => {
	await env.FERMI_DB.prepare(
		`DELETE FROM secrets WHERE scope = 'app' AND name IN (${PHONE_REQUIRED_CONFIG.map(() => '?').join(',')})`,
	)
		.bind(...PHONE_REQUIRED_CONFIG)
		.run()
})

async function configurePhone() {
	const values: Record<(typeof PHONE_REQUIRED_CONFIG)[number], string> = {
		TWILIO_ACCOUNT_SID: ACCOUNT,
		TWILIO_AUTH_TOKEN: AUTH,
		TWILIO_FROM_NUMBER: FROM,
		OPENAI_API_KEY: 'sk-contract',
		FERMI_PUBLIC_URL: 'https://fermi.test',
	}
	for (const [name, value] of Object.entries(values)) {
		await putSecret({ name, value, scope: 'app' }, env)
	}
}

/** Intercept one Twilio REST call and record what was sent. */
function twilio(path: string, statusCode: number, reply: unknown): Captured[] {
	const seen: Captured[] = []
	fetchMock
		.get(TWILIO)
		.intercept({ path: `/2010-04-01/Accounts/${ACCOUNT}${path}`, method: 'POST' })
		.reply((opts) => {
			const headers = new Headers(opts.headers as Record<string, string>)
			seen.push({
				path: opts.path,
				authorization: headers.get('authorization') ?? '',
				form: new URLSearchParams(String(opts.body)),
			})
			return { statusCode, data: JSON.stringify(reply) }
		})
	return seen
}

const goal = { to: TO, goal: 'Ask for the opening hours' }

async function startCall(): Promise<string> {
	twilio('/Calls.json', 201, { sid: 'CA_contract' })
	const started = resultJson<{ call_id: string; ok: boolean }>(
		await callApproved(client, 'phone_call_start', goal),
	)
	expect(started.ok).toBe(true)
	return started.call_id
}

describeTool('phone_call_start', () => {
	it('requires an approval token', async () => {
		expect(resultJson(await client.callTool('phone_call_start', goal))).toMatchObject({
			status: 'pending_approval',
		})
	})

	it('reports every missing config value and dials nothing', async () => {
		const result = resultJson(await callApproved(client, 'phone_call_start', goal))
		expect(result).toMatchObject({
			error: 'phone_not_configured',
			missing: [...PHONE_REQUIRED_CONFIG],
		})
	})

	it('dials through Twilio with the caller id, stream TwiML and status callback', async () => {
		await configurePhone()
		const seen = twilio('/Calls.json', 201, { sid: 'CA_contract' })
		const result = resultJson<{
			call_id: string
			ok: boolean
			call: { status: string; to: string; from: string }
		}>(await callApproved(client, 'phone_call_start', { ...goal, max_minutes: 5 }))
		expect(result).toMatchObject({
			ok: true,
			call: { status: 'dialing', to: TO, from: FROM },
		})
		expect(seen).toHaveLength(1)
		expect(seen[0].authorization).toBe(`Basic ${btoa(`${ACCOUNT}:${AUTH}`)}`)
		const form = seen[0].form
		expect(form.get('To')).toBe(TO)
		expect(form.get('From')).toBe(FROM)
		expect(form.get('StatusCallback')).toBe(
			`https://fermi.test/phone/webhook?call=${result.call_id}`,
		)
		expect(form.getAll('StatusCallbackEvent')).toEqual([
			'initiated',
			'ringing',
			'answered',
			'completed',
		])
		expect(form.get('TimeLimit')).toBe('300')
		expect(form.get('Twiml')).toContain(`/phone/stream/${result.call_id}/`)
	})

	it('ends the call as dial_failed when Twilio refuses', async () => {
		await configurePhone()
		twilio('/Calls.json', 400, { message: 'invalid To', code: 21211 })
		const result = resultJson<{ ok: boolean; error: string; call: { outcome: string } }>(
			await callApproved(client, 'phone_call_start', goal),
		)
		expect(result.ok).toBe(false)
		expect(result.error).toMatch(/twilio \/Calls.json 400: invalid To \(code 21211\)/)
		expect(result.call.outcome).toBe('dial_failed')
	})

	it('requires notify_channel and notify_chat_id together', async () => {
		await configurePhone()
		const result = resultJson(
			await callApproved(client, 'phone_call_start', { ...goal, notify_channel: 'tg' }),
		)
		expect(result).toEqual({ error: 'notify_channel and notify_chat_id must be given together' })
	})
})

describeTool('phone_call_status', () => {
	it('returns the call record of a started call', async () => {
		await configurePhone()
		const id = await startCall()
		const status = resultJson(await client.callTool('phone_call_status', { call_id: id }))
		expect(status).toMatchObject({
			ok: true,
			call: { call_id: id, to: TO, status: 'dialing', outcome: null },
		})
	})

	it('reports an unknown call as not_found', async () => {
		const status = resultJson(
			await client.callTool('phone_call_status', { call_id: crypto.randomUUID() }),
		)
		expect(status).toEqual({ ok: false, error: 'not_found' })
	})
})

describeTool('phone_call_hangup', () => {
	it('completes the Twilio call and ends the record as cancelled', async () => {
		await configurePhone()
		const id = await startCall()
		const seen = twilio('/Calls/CA_contract.json', 200, { sid: 'CA_contract' })
		const hungUp = resultJson(await client.callTool('phone_call_hangup', { call_id: id }))
		expect(hungUp).toMatchObject({ ok: true, call: { status: 'ended', outcome: 'cancelled' } })
		expect(seen).toHaveLength(1)
		expect(Object.fromEntries(seen[0].form)).toEqual({ Status: 'completed' })
	})

	it('reports an unknown call as not_found', async () => {
		const hungUp = resultJson(
			await client.callTool('phone_call_hangup', { call_id: crypto.randomUUID() }),
		)
		expect(hungUp).toEqual({ ok: false, error: 'not_found' })
	})
})
