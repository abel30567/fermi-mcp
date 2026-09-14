import { env, fetchMock } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleSlackBridgeWebhook } from '../src/channels/slack.ts'
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

interface SlackSend {
	channel: string
	text: string
}

const slackSent: SlackSend[] = []

function interceptSlack() {
	fetchMock
		.get('https://slack.com')
		.intercept({ path: '/api/chat.postMessage', method: 'POST' })
		.reply(200, (opts) => {
			slackSent.push(JSON.parse(String(opts.body)) as SlackSend)
			return { ok: true }
		})
		.persist()
}

function webhookRequest(body: unknown, secret?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (secret) headers['x-sl-bridge-secret'] = secret
	return new Request('https://fermi.example.com/sl/webhook', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
}

beforeAll(async () => {
	await setupTasksSchema()
	await setupSessionsSchema()
	await setupAllowlistSchema()
	fetchMock.activate()
	fetchMock.disableNetConnect()
	interceptSlack()
})

describe('handleSlackBridgeWebhook', () => {
	beforeEach(async () => {
		slackSent.length = 0
		await clearTasks()
		await clearSessions()
		await clearAllowlist()
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		await Promise.all(keys.map((k) => env.FERMI_KV.delete(k.name)))
	})

	it('rejects a request with no secret header', async () => {
		const res = await handleSlackBridgeWebhook(
			webhookRequest({ author_id: '1', channel_id: 'D1', is_im: true, text: 'hi' }),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('rejects a request with a wrong secret header', async () => {
		const res = await handleSlackBridgeWebhook(
			webhookRequest({ author_id: '1', channel_id: 'D1', is_im: true, text: 'hi' }, 'wrong'),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('queues a pairing code for an unknown DM sender without enqueueing', async () => {
		const res = await handleSlackBridgeWebhook(
			webhookRequest(
				{
					author_id: 'U1',
					display_name: 'Ann',
					channel_id: 'D1',
					team_id: 'T9',
					is_im: true,
					text: 'hi',
				},
				'test-sl-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		expect(slackSent).toHaveLength(1)
		expect(slackSent[0].channel).toBe('D1')
		expect(slackSent[0].text).toContain('Pairing code:')

		const code = /Pairing code: (\w+)/.exec(slackSent[0].text)?.[1]
		expect(code).toBeTruthy()
		const record = await env.FERMI_KV.get(`pairing:${code}`)
		expect(JSON.parse(record ?? '{}')).toMatchObject({ channel: 'sl', senderId: 'U1' })

		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		const logged = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{
			n: number
		}>()
		expect(logged?.n).toBe(0)
	})

	it('enqueues an attributed channel task without acking when the workspace is allowlisted', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'sl', senderId: 'T9' })
		const res = await handleSlackBridgeWebhook(
			webhookRequest(
				{
					author_id: 'U7',
					display_name: 'Bob',
					channel_id: 'C42',
					team_id: 'T9',
					is_im: false,
					text: 'hello workspace',
				},
				'test-sl-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'sl',
			sender: 'U7',
			chat_id: 'C42',
			payload: '[Bob] hello workspace',
		})

		expect(slackSent).toHaveLength(0)

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'sl:C42'",
		).all<{ body: string }>()
		expect(logged.results).toEqual([{ body: '[Bob] hello workspace' }])
	})

	it('ignores a message in a non-allowlisted workspace (no task, no send)', async () => {
		const res = await handleSlackBridgeWebhook(
			webhookRequest(
				{
					author_id: 'U7',
					display_name: 'Bob',
					channel_id: 'C42',
					team_id: 'T-nope',
					is_im: false,
					text: 'hello',
				},
				'test-sl-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		expect(slackSent).toHaveLength(0)
	})

	it('enqueues, acks, and logs for an allowlisted DM sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'sl', senderId: 'U1' })
		const res = await handleSlackBridgeWebhook(
			webhookRequest(
				{
					author_id: 'U1',
					display_name: 'Ann',
					channel_id: 'D1',
					team_id: 'T9',
					is_im: true,
					text: 'what is on my calendar?',
				},
				'test-sl-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'sl',
			sender: 'U1',
			chat_id: 'D1',
			payload: 'what is on my calendar?',
		})

		expect(slackSent).toHaveLength(1)
		expect(slackSent[0]).toMatchObject({ channel: 'D1' })
		expect(slackSent[0].text).toContain('Got it')

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.role, m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'sl:D1'",
		).all<{ role: string; body: string }>()
		expect(logged.results).toEqual([{ role: 'user', body: 'what is on my calendar?' }])
	})

	it('approves a pairing code via /approve from an allowlisted DM sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'sl', senderId: 'U-owner' })
		await env.FERMI_KV.put(
			'pairing:CODE1234',
			JSON.stringify({ channel: 'sl', senderId: 'U9', chatId: 'D9' }),
		)
		const res = await handleSlackBridgeWebhook(
			webhookRequest(
				{
					author_id: 'U-owner',
					display_name: 'Owner',
					channel_id: 'D-owner',
					team_id: 'T9',
					is_im: true,
					text: '/approve CODE1234',
				},
				'test-sl-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await isAllowed(env.FERMI_DB, 'sl', 'U9')).toBe(true)
		expect(await env.FERMI_KV.get('pairing:CODE1234')).toBeNull()
		expect(slackSent.map((m) => m.channel).sort()).toEqual(['D-owner', 'D9'])
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})
})
