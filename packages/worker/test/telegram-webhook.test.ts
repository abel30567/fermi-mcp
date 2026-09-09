import { env, fetchMock } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleTelegramWebhook, setTelegramWebhook } from '../src/channels/telegram.ts'
import { addToAllowlist, isAllowed } from '../src/lib/allowlist-store.ts'
import { listTasks } from '../src/lib/task-store.ts'
import {
	clearAllowlist,
	clearSessions,
	clearTasks,
	setupAllowlistSchema,
	setupSessionsSchema,
	setupTasksSchema,
} from './setup-d1.ts'

const workerEnv = env as unknown as Env

interface SentMessage {
	chat_id: string
	text: string
}

// One persistent interceptor for the whole file; `sent` is reset per test.
// (Persisted undici interceptors outlive individual tests, so per-test
// interceptors would capture into stale arrays.)
const sent: SentMessage[] = []

function interceptSendMessage() {
	fetchMock
		.get('https://api.telegram.org')
		.intercept({ path: (p) => p.endsWith('/sendMessage'), method: 'POST' })
		.reply(200, (opts) => {
			sent.push(JSON.parse(String(opts.body)) as SentMessage)
			return { ok: true }
		})
		.persist()
}

function webhookRequest(update: unknown, secret?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (secret) headers['x-telegram-bot-api-secret-token'] = secret
	return new Request('https://fermi.example.com/tg/webhook', {
		method: 'POST',
		headers,
		body: JSON.stringify(update),
	})
}

interface MsgOpts {
	type?: string
	firstName?: string
	senderChat?: unknown
}

function textUpdate(senderId: number, chatId: number, text: string, opts: MsgOpts = {}) {
	const message: Record<string, unknown> = {
		message_id: 1,
		from: { id: senderId, first_name: opts.firstName },
		chat: { id: chatId, type: opts.type },
		text,
	}
	if (opts.senderChat !== undefined) message.sender_chat = opts.senderChat
	return { update_id: 1, message }
}

beforeAll(async () => {
	await setupTasksSchema()
	await setupSessionsSchema()
	await setupAllowlistSchema()
	fetchMock.activate()
	fetchMock.disableNetConnect()
	interceptSendMessage()
})

describe('handleTelegramWebhook', () => {
	beforeEach(async () => {
		sent.length = 0
		await clearTasks()
		await clearSessions()
		await clearAllowlist()
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		await Promise.all(keys.map((k) => env.FERMI_KV.delete(k.name)))
	})

	it('rejects a request with no secret header', async () => {
		const res = await handleTelegramWebhook(webhookRequest(textUpdate(1, 1, 'hi')), workerEnv)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('rejects a request with a wrong secret header', async () => {
		const res = await handleTelegramWebhook(
			webhookRequest(textUpdate(1, 1, 'hi'), 'wrong-secret'),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('sends a pairing code to an unknown sender without enqueueing', async () => {
		const res = await handleTelegramWebhook(
			webhookRequest(textUpdate(42, 99, 'hello'), 'test-webhook-secret'),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(sent).toHaveLength(1)
		expect(sent[0].chat_id).toBe('99')
		expect(sent[0].text).toContain('Pairing code:')

		const code = /Pairing code: (\w+)/.exec(sent[0].text)?.[1]
		expect(code).toBeTruthy()
		const record = await env.FERMI_KV.get(`pairing:${code}`)
		expect(JSON.parse(record ?? '{}')).toMatchObject({ channel: 'tg', senderId: '42' })
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)

		// Pairing traffic is not logged to conversation sessions
		const logged = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{
			n: number
		}>()
		expect(logged?.n).toBe(0)
	})

	it('enqueues a task and acks for an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		const res = await handleTelegramWebhook(
			webhookRequest(textUpdate(42, 99, 'what is on my calendar?'), 'test-webhook-secret'),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'tg',
			sender: '42',
			chat_id: '99',
			payload: 'what is on my calendar?',
		})
		expect(sent).toHaveLength(1)
		expect(sent[0].text).toContain('Got it')

		// Inbound turn is logged to the chat's conversation session
		const logged = await env.FERMI_DB.prepare(
			"SELECT m.role, m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'tg:99'",
		).all<{ role: string; body: string }>()
		expect(logged.results).toEqual([{ role: 'user', body: 'what is on my calendar?' }])
	})

	it('approves a pairing code via /approve from an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		await env.FERMI_KV.put(
			'pairing:CODE1234',
			JSON.stringify({ channel: 'tg', senderId: '77', chatId: '88' }),
		)
		const res = await handleTelegramWebhook(
			webhookRequest(textUpdate(42, 99, '/approve CODE1234'), 'test-webhook-secret'),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await isAllowed(env.FERMI_DB, 'tg', '77')).toBe(true)
		expect(await env.FERMI_KV.get('pairing:CODE1234')).toBeNull()
		// Approver confirmation + welcome to the newly paired chat
		expect(sent).toHaveLength(2)
		expect(sent.map((m) => m.chat_id).sort()).toEqual(['88', '99'])
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('reports an invalid /approve code without changing the allowlist', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		await handleTelegramWebhook(
			webhookRequest(textUpdate(42, 99, '/approve NOPE0000'), 'test-webhook-secret'),
			workerEnv,
		)
		expect(sent).toHaveLength(1)
		expect(sent[0].text).toContain('Approval failed')
	})

	it('enqueues an attributed group task without acking for an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		const res = await handleTelegramWebhook(
			webhookRequest(
				textUpdate(42, -1001234, 'hey bot', { type: 'supergroup', firstName: 'Cl' }),
				'test-webhook-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'tg',
			sender: '42',
			chat_id: '-1001234',
			payload: '[Cl] hey bot',
		})
		// No ack in groups
		expect(sent).toHaveLength(0)

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'tg:-1001234'",
		).all<{ body: string }>()
		expect(logged.results).toEqual([{ body: '[Cl] hey bot' }])
	})

	it('ignores an unknown sender in a group (no pairing, no task)', async () => {
		const res = await handleTelegramWebhook(
			webhookRequest(
				textUpdate(500, -1001234, 'hi', { type: 'supergroup' }),
				'test-webhook-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		expect(sent).toHaveLength(0)
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		expect(keys).toHaveLength(0)
	})

	it('ignores a message posted as a channel/anonymous admin (sender_chat)', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		const res = await handleTelegramWebhook(
			webhookRequest(
				textUpdate(42, -1001234, 'anon', { type: 'supergroup', senderChat: { id: -1009999 } }),
				'test-webhook-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		expect(sent).toHaveLength(0)
	})

	it('treats /approve in a group as an ordinary message', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'tg', senderId: '42' })
		await env.FERMI_KV.put(
			'pairing:GRPCODE1',
			JSON.stringify({ channel: 'tg', senderId: '77', chatId: '88' }),
		)
		const res = await handleTelegramWebhook(
			webhookRequest(
				textUpdate(42, -1001234, '/approve GRPCODE1', { type: 'supergroup', firstName: 'Cl' }),
				'test-webhook-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0].payload).toContain('/approve GRPCODE1')
		// The code was not consumed and 77 is not allowlisted.
		expect(await env.FERMI_KV.get('pairing:GRPCODE1')).not.toBeNull()
		expect(await isAllowed(env.FERMI_DB, 'tg', '77')).toBe(false)
		expect(sent).toHaveLength(0)
	})
})

describe('setTelegramWebhook', () => {
	it('registers the webhook with the secret token', async () => {
		let posted: { url?: string; secret_token?: string } = {}
		fetchMock
			.get('https://api.telegram.org')
			.intercept({ path: (p) => p.endsWith('/setWebhook'), method: 'POST' })
			.reply(200, (opts) => {
				posted = JSON.parse(String(opts.body))
				return { ok: true, result: true }
			})

		const result = await setTelegramWebhook(workerEnv, 'https://fermi.example.com/tg/webhook')
		expect(result.ok).toBe(true)
		expect(posted.url).toBe('https://fermi.example.com/tg/webhook')
		expect(posted.secret_token).toBe('test-webhook-secret')
	})
})
