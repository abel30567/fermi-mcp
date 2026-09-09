import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleNarrate } from '../src/channels/narrate.ts'
import { clearSessions, setupSessionsSchema } from './setup-d1.ts'

const workerEnv = { ...env, FERMI_BEARER_TOKEN: 'test-bearer' } as unknown as Env

function req(body: unknown, bearer?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (bearer) headers.authorization = `Bearer ${bearer}`
	return new Request('https://fermi.example.com/admin/narrate', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
}

describe('handleNarrate', () => {
	beforeAll(async () => {
		await setupSessionsSchema()
	})

	beforeEach(async () => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
		await clearSessions()
	})

	afterEach(() => {
		fetchMock.deactivate()
	})

	it('rejects without a bearer token', async () => {
		const res = await handleNarrate(req({ channel: 'dc', chat_id: '1', text: 'x' }), workerEnv)
		expect(res.status).toBe(401)
	})

	it('rejects an unknown channel or missing fields', async () => {
		const bad = await handleNarrate(
			req({ channel: 'zz', chat_id: '1', text: 'x' }, 'test-bearer'),
			workerEnv,
		)
		expect(bad.status).toBe(400)
		const missing = await handleNarrate(req({ channel: 'dc', text: 'x' }, 'test-bearer'), workerEnv)
		expect(missing.status).toBe(400)
	})

	it('sends a discord narration without logging to conversation history', async () => {
		let posted = ''
		fetchMock
			.get('https://discord.com')
			.intercept({ path: (p) => p.includes('/messages'), method: 'POST' })
			.reply(200, (opts) => {
				posted = JSON.parse(String(opts.body)).content
				return { id: '1' }
			})

		const res = await handleNarrate(
			req({ channel: 'dc', chat_id: '555', text: '📖 Reading catalog.json' }, 'test-bearer'),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(posted).toBe('📖 Reading catalog.json')

		const logged = await env.FERMI_DB.prepare(
			"SELECT COUNT(*) AS n FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'dc:555'",
		).first<{ n: number }>()
		expect(logged?.n).toBe(0)
	})
})
