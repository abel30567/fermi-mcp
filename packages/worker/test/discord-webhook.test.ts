import { env, fetchMock } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleDiscordWebhook } from '../src/channels/discord.ts'
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

interface DiscordSend {
	channel_id: string
	content: string
}

const discordSent: DiscordSend[] = []

function interceptDiscord() {
	fetchMock
		.get('https://discord.com')
		.intercept({ path: (p) => /\/channels\/([^/]+)\/messages$/.test(p), method: 'POST' })
		.reply(200, (opts) => {
			const channelId = /\/channels\/([^/]+)\/messages/.exec(opts.path)?.[1] ?? ''
			discordSent.push({ channel_id: channelId, content: JSON.parse(String(opts.body)).content })
			return {}
		})
		.persist()
}

function webhookRequest(body: unknown, secret?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (secret) headers['x-dc-bridge-secret'] = secret
	return new Request('https://fermi.example.com/dc/webhook', {
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
	interceptDiscord()
})

describe('handleDiscordWebhook', () => {
	beforeEach(async () => {
		discordSent.length = 0
		await clearTasks()
		await clearSessions()
		await clearAllowlist()
		const { keys } = await env.FERMI_KV.list({ prefix: 'pairing:' })
		await Promise.all(keys.map((k) => env.FERMI_KV.delete(k.name)))
	})

	it('rejects a request with no secret header', async () => {
		const res = await handleDiscordWebhook(
			webhookRequest({ author_id: '1', channel_id: '1', guild_id: null, text: 'hi' }),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('rejects a request with a wrong secret header', async () => {
		const res = await handleDiscordWebhook(
			webhookRequest({ author_id: '1', channel_id: '1', guild_id: null, text: 'hi' }, 'wrong'),
			workerEnv,
		)
		expect(res.status).toBe(401)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('queues a pairing code for an unknown DM sender without enqueueing', async () => {
		const res = await handleDiscordWebhook(
			webhookRequest(
				{
					author_id: 'user-1',
					display_name: 'Ann',
					channel_id: 'dm-1',
					guild_id: null,
					text: 'hi',
				},
				'test-dc-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		expect(discordSent).toHaveLength(1)
		expect(discordSent[0].channel_id).toBe('dm-1')
		expect(discordSent[0].content).toContain('Pairing code:')

		const code = /Pairing code: (\w+)/.exec(discordSent[0].content)?.[1]
		expect(code).toBeTruthy()
		const record = await env.FERMI_KV.get(`pairing:${code}`)
		expect(JSON.parse(record ?? '{}')).toMatchObject({ channel: 'dc', senderId: 'user-1' })

		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		const logged = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{
			n: number
		}>()
		expect(logged?.n).toBe(0)
	})

	it('enqueues an attributed guild task without acking when the guild is allowlisted', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'dc', senderId: 'guild-9' })
		const res = await handleDiscordWebhook(
			webhookRequest(
				{
					author_id: 'member-7',
					display_name: 'Bob',
					channel_id: 'chan-42',
					guild_id: 'guild-9',
					text: 'hello server',
				},
				'test-dc-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'dc',
			sender: 'member-7',
			chat_id: 'chan-42',
			payload: '[Bob] hello server',
		})

		// No ack in guild channels.
		expect(discordSent).toHaveLength(0)

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'dc:chan-42'",
		).all<{ body: string }>()
		expect(logged.results).toEqual([{ body: '[Bob] hello server' }])
	})

	it('ignores a message in a non-allowlisted guild (no task, no send)', async () => {
		const res = await handleDiscordWebhook(
			webhookRequest(
				{
					author_id: 'member-7',
					display_name: 'Bob',
					channel_id: 'chan-42',
					guild_id: 'guild-nope',
					text: 'hello',
				},
				'test-dc-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
		expect(discordSent).toHaveLength(0)
	})

	it('enqueues, acks, and logs for an allowlisted DM sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'dc', senderId: 'user-1' })
		const res = await handleDiscordWebhook(
			webhookRequest(
				{
					author_id: 'user-1',
					display_name: 'Ann',
					channel_id: 'dm-1',
					guild_id: null,
					text: 'what is on my calendar?',
				},
				'test-dc-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			channel: 'dc',
			sender: 'user-1',
			chat_id: 'dm-1',
			payload: 'what is on my calendar?',
		})

		expect(discordSent).toHaveLength(1)
		expect(discordSent[0]).toMatchObject({ channel_id: 'dm-1' })
		expect(discordSent[0].content).toContain('Got it')

		const logged = await env.FERMI_DB.prepare(
			"SELECT m.role, m.body FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.host = 'dc:dm-1'",
		).all<{ role: string; body: string }>()
		expect(logged.results).toEqual([{ role: 'user', body: 'what is on my calendar?' }])
	})

	it('approves a pairing code via /approve from an allowlisted DM sender', async () => {
		await addToAllowlist(env.FERMI_DB, { channel: 'dc', senderId: 'owner-1' })
		await env.FERMI_KV.put(
			'pairing:CODE1234',
			JSON.stringify({ channel: 'dc', senderId: 'user-9', chatId: 'dm-9' }),
		)
		const res = await handleDiscordWebhook(
			webhookRequest(
				{
					author_id: 'owner-1',
					display_name: 'Owner',
					channel_id: 'dm-owner',
					guild_id: null,
					text: '/approve CODE1234',
				},
				'test-dc-secret',
			),
			workerEnv,
		)
		expect(res.status).toBe(200)
		expect(await isAllowed(env.FERMI_DB, 'dc', 'user-9')).toBe(true)
		expect(await env.FERMI_KV.get('pairing:CODE1234')).toBeNull()
		expect(discordSent.map((m) => m.channel_id).sort()).toEqual(['dm-9', 'dm-owner'])
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})
})
