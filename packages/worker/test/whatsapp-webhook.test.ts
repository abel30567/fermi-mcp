import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	handleWaOutboxAck,
	handleWaOutboxGet,
	handleWhatsAppWebhook,
} from '../src/channels/whatsapp.ts'
import { addToAllowlist, isAllowed } from '../src/lib/allowlist-store.ts'
import { enqueueOutbound } from '../src/lib/outbox-store.ts'
import { listTasks } from '../src/lib/task-store.ts'
import {
	clearAllowlist,
	clearOutbox,
	clearSessions,
	clearTasks,
	setupAllowlistSchema,
	setupOutboxSchema,
	setupSessionsSchema,
	setupTasksSchema,
} from './setup-d1.ts'

const workerEnv = env as unknown as Env
const bearerEnv = { ...env, FERMI_BEARER_TOKEN: 'test-bearer' } as unknown as Env

function webhookRequest(body: unknown, secret?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (secret) headers['x-wa-bridge-secret'] = secret
	return new Request('https://fermi.example.com/wa/webhook', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
}

async function pendingOutbox(): Promise<{ chat_id: string; body: string }[]> {
	const { results } = await env.FERMI_DB.prepare(
		"SELECT chat_id, body FROM outbox WHERE channel = 'wa' AND status = 'pending' ORDER BY created_at ASC",
	).all<{ chat_id: string; body: string }>()
	return results
}

beforeAll(async () => {
	await setupTasksSchema()
	await setupSessionsSchema()
	await setupOutboxSchema()
	await setupAllowlistSchema()
})

describe('handleWhatsAppWebhook', () => {
	beforeEach(async () => {
		await clearTasks()
		await clearSessions()
		await clearOutbox()
		await clearAllowlist()
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		await Promise.all(keys.map((k) => env.FERMI_KV.delete(k.name)))
	})

	it('rejects a request with no secret header', async () => {
		const res = await handleWhatsAppWebhook(
			webhookRequest({ sender: '1', chat_id: '1', text: 'hi' }),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('rejects a request with a wrong secret header', async () => {
		const res = await handleWhatsAppWebhook(
			webhookRequest({ sender: '1', chat_id: '1', text: 'hi' }, 'wrong-secret'),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('queues a pairing code for an unknown sender without enqueueing', async () => {
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '15551234567', text: 'hello' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const outbox = await pendingOutbox()
		expect(outbox).toHaveLength(1)
		expect(outbox[0].chat_id).toBe('15551234567')
		expect(outbox[0].body).toContain('Pairing code:')

		const code = /Pairing code: (\w+)/.exec(outbox[0].body)?.[1]
		expect(code).toBeTruthy()
		const record = await env.FERMI_KV.get(`pairing:${code}`)
		expect(JSON.parse(record ?? '{}')).toMatchObject({ channel: 'wa', senderId: '15551234567' })

		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		const logged = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{
			n: number
		}>()
		expect(logged?.n).toBe(0)
	})

	it('enqueues a task, acks, and logs for an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'wa', senderId: '15551234567' })
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '15559990000', text: 'what is on my calendar?' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'wa',
			sender: '15551234567',
			chat_id: '15559990000',
			payload: 'what is on my calendar?',
		})

		const outbox = await pendingOutbox()
		expect(outbox).toHaveLength(1)
		expect(outbox[0].body).toContain('Got it')

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.role, m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'wa:15559990000'",
		).all<{ role: string; body: string }>()
		expect(logged.results).toEqual([{ role: 'user', body: 'what is on my calendar?' }])
	})

	it('approves a pairing code via /approve from an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'wa', senderId: '15551234567' })
		await env.FERMI_KV.put(
			'pairing:CODE1234',
			JSON.stringify({ channel: 'wa', senderId: '15557778888', chatId: '15557778888' }),
		)
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '15559990000', text: '/approve CODE1234' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await isAllowed(env.FERMI_DB, 'wa', '15557778888')).toBe(true)
		expect(await env.FERMI_KV.get('pairing:CODE1234')).toBeNull()
		const outbox = await pendingOutbox()
		expect(outbox).toHaveLength(2)
		expect(outbox.map((m) => m.chat_id).sort()).toEqual(['15557778888', '15559990000'])
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('reports an invalid /approve code without changing the allowlist', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'wa', senderId: '15551234567' })
		await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '15559990000', text: '/approve NOPE0000' },
				'test-wa-secret',
			),
			workerEnv,
		)
		const outbox = await pendingOutbox()
		expect(outbox).toHaveLength(1)
		expect(outbox[0].body).toContain('Approval failed')
	})

	it('enqueues an attributed group task without acking for an allowlisted sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'wa', senderId: '15551234567' })
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '123-456@g.us', text: 'hello group' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'wa',
			sender: '15551234567',
			chat_id: '123-456@g.us',
			payload: '[15551234567] hello group',
		})
		// No ack in groups
		expect(await pendingOutbox()).toHaveLength(0)

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'wa:123-456@g.us'",
		).all<{ body: string }>()
		expect(logged.results).toEqual([{ body: '[15551234567] hello group' }])
	})

	it('ignores an unknown sender in a group (no pairing, no task)', async () => {
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '19998887777', chat_id: '123-456@g.us', text: 'hi' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		expect(await pendingOutbox()).toHaveLength(0)
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		expect(keys).toHaveLength(0)
	})

	it('treats /approve in a group as an ordinary message', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'wa', senderId: '15551234567' })
		await env.FERMI_KV.put(
			'pairing:GRPCODE1',
			JSON.stringify({ channel: 'wa', senderId: '15557778888', chatId: '15557778888' }),
		)
		const res = await handleWhatsAppWebhook(
			webhookRequest(
				{ sender: '15551234567', chat_id: '123-456@g.us', text: '/approve GRPCODE1' },
				'test-wa-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0].payload).toContain('/approve GRPCODE1')
		expect(await env.FERMI_KV.get('pairing:GRPCODE1')).not.toBeNull()
		expect(await isAllowed(env.FERMI_DB, 'wa', '15557778888')).toBe(false)
		expect(await pendingOutbox()).toHaveLength(0)
	})
})

function outboxGetRequest(auth?: string): Request {
	const headers: Record<string, string> = {}
	if (auth) headers.authorization = auth
	return new Request('https://fermi.example.com/wa/outbox', { method: 'GET', headers })
}

function outboxAckRequest(ids: unknown, auth?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (auth) headers.authorization = auth
	return new Request('https://fermi.example.com/wa/outbox/ack', {
		method: 'POST',
		headers,
		body: JSON.stringify({ ids }),
	})
}

describe('wa outbox endpoints', () => {
	beforeEach(async () => {
		await clearOutbox()
	})

	it('rejects GET and ack without a bearer token', async () => {
		expect((await handleWaOutboxGet(outboxGetRequest(), bearerEnv)).status).toBe(401)
		expect((await handleWaOutboxAck(outboxAckRequest([]), bearerEnv)).status).toBe(401)
	})

	it('returns only pending wa rows and flips them on ack', async () => {
		const a = await enqueueOutbound(env.FERMI_DB, { channel: 'wa', chatId: '1', body: 'a' })
		await enqueueOutbound(env.FERMI_DB, { channel: 'tg', chatId: '2', body: 'tg row' })

		const getRes = await handleWaOutboxGet(outboxGetRequest('Bearer test-bearer'), bearerEnv)
		expect(getRes.status).toBe(200)
		const { messages } = (await getRes.json()) as { messages: { id: string; body: string }[] }
		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatchObject({ id: a.id, body: 'a' })

		const ackRes = await handleWaOutboxAck(
			outboxAckRequest([a.id], 'Bearer test-bearer'),
			bearerEnv,
		)
		expect(ackRes.status).toBe(200)
		expect(await ackRes.json()).toEqual({ ok: true, acked: 1 })

		const getAgain = await handleWaOutboxGet(outboxGetRequest('Bearer test-bearer'), bearerEnv)
		const after = (await getAgain.json()) as { messages: unknown[] }
		expect(after.messages).toHaveLength(0)
	})

	it('rejects an ack body that is not a string array', async () => {
		const res = await handleWaOutboxAck(
			outboxAckRequest([1, 2, 3], 'Bearer test-bearer'),
			bearerEnv,
		)
		expect(res.status).toBe(400)
	})
})
