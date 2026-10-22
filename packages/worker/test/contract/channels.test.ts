import { env, fetchMock } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Bot tokens are the fake values from wrangler.test.jsonc; every outbound call
// below is answered by fetchMock (setup.ts refuses anything unmocked).

interface Captured {
	path: string
	method: string
	headers: Record<string, string>
	body: unknown
}

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.batch([
		env.FERMI_DB.prepare('DELETE FROM outbox'),
		env.FERMI_DB.prepare('DELETE FROM allowlist'),
	])
	client = new McpClient()
	await client.initialize()
})

/** Intercept one request to `origin` and record what was sent. */
function capture(origin: string, method: string, path: string, reply: unknown): Captured[] {
	const seen: Captured[] = []
	fetchMock
		.get(origin)
		.intercept({ path, method })
		.reply((opts) => {
			seen.push({
				path: opts.path,
				method: opts.method,
				headers: Object.fromEntries(
					Object.entries(opts.headers as Record<string, string>).map(([k, v]) => [
						k.toLowerCase(),
						v,
					]),
				),
				body: opts.body ? JSON.parse(String(opts.body)) : undefined,
			})
			return { statusCode: 200, data: JSON.stringify(reply) }
		})
	return seen
}

async function outboxRows() {
	return (
		await env.FERMI_DB.prepare(
			'SELECT channel, chat_id, body, status FROM outbox ORDER BY created_at',
		).all()
	).results
}

describeTool('channel_send', () => {
	const send = (channel: string, chat_id: string, extra: Record<string, unknown> = {}) =>
		client.callTool('channel_send', { channel, chat_id, text: 'hello there', ...extra })

	it('wa: queues a pending outbox row for the bridge, with no outbound request', async () => {
		expect(resultJson(await send('wa', '15555550100'))).toEqual({ ok: true, channel: 'wa' })
		expect(await outboxRows()).toEqual([
			{ channel: 'wa', chat_id: '15555550100', body: 'hello there', status: 'pending' },
		])
	})

	it('tg: POSTs sendMessage with the bot token', async () => {
		const seen = capture('https://api.telegram.org', 'POST', '/bottg-contract-token/sendMessage', {
			ok: true,
		})
		expect(resultJson(await send('tg', '42'))).toEqual({ ok: true, channel: 'tg' })
		expect(seen).toHaveLength(1)
		expect(seen[0].body).toEqual({ chat_id: '42', text: 'hello there', parse_mode: 'Markdown' })
	})

	it('sl: POSTs chat.postMessage with the bot token', async () => {
		const seen = capture('https://slack.com', 'POST', '/api/chat.postMessage', { ok: true })
		expect(resultJson(await send('sl', 'C123'))).toEqual({ ok: true, channel: 'sl' })
		expect(seen).toHaveLength(1)
		expect(seen[0].headers.authorization).toBe('Bearer xoxb-contract-token')
		expect(seen[0].body).toEqual({ channel: 'C123', text: 'hello there' })
	})

	it('dc: POSTs a channel message with the bot token', async () => {
		const seen = capture('https://discord.com', 'POST', '/api/v10/channels/987/messages', {
			id: 'm1',
		})
		expect(resultJson(await send('dc', '987'))).toEqual({ ok: true, channel: 'dc' })
		expect(seen).toHaveLength(1)
		expect(seen[0].headers.authorization).toBe('Bot dc-contract-token')
		expect(seen[0].body).toEqual({ content: 'hello there' })
	})

	it('media is not an argument: it is dropped and only the text is sent', async () => {
		const media = { url: 'https://example.com/cat.png', type: 'image' }
		expect(resultJson(await send('wa', '15555550100', { media }))).toEqual({
			ok: true,
			channel: 'wa',
		})
		expect(await outboxRows()).toEqual([
			{ channel: 'wa', chat_id: '15555550100', body: 'hello there', status: 'pending' },
		])

		const seen = capture('https://api.telegram.org', 'POST', '/bottg-contract-token/sendMessage', {
			ok: true,
		})
		expect(resultJson(await send('tg', '42', { media }))).toEqual({ ok: true, channel: 'tg' })
		expect(seen.map((r) => r.body)).toEqual([
			{ chat_id: '42', text: 'hello there', parse_mode: 'Markdown' },
		])
	})
})

describeTool('channel_read', () => {
	const message = (id: string, content: string, name: string) => ({
		content,
		timestamp: `2026-01-0${id}T00:00:00Z`,
		author: { id: `u${id}`, username: name, global_name: null },
	})

	it('reads a channel by id, oldest first, with a keyword filter', async () => {
		const seen = capture('https://discord.com', 'GET', '/api/v10/channels/555/messages?limit=5', [
			message('2', 'Launch is on Friday', 'bob'),
			message('1', 'hello', 'amy'),
		])
		const all = resultJson(
			await client.callTool('channel_read', { channel: 'dc', channel_id: '555', limit: 5 }),
		)
		expect(seen[0].headers.authorization).toBe('Bot dc-contract-token')
		expect(all).toEqual({
			channel_id: '555',
			messages: [
				{ author: 'amy', author_id: 'u1', content: 'hello', timestamp: '2026-01-01T00:00:00Z' },
				{
					author: 'bob',
					author_id: 'u2',
					content: 'Launch is on Friday',
					timestamp: '2026-01-02T00:00:00Z',
				},
			],
			total: 2,
		})

		capture('https://discord.com', 'GET', '/api/v10/channels/555/messages?limit=20', [
			message('2', 'Launch is on Friday', 'bob'),
			message('1', 'hello', 'amy'),
		])
		const filtered = resultJson<{ messages: Array<{ content: string }>; total: number }>(
			await client.callTool('channel_read', { channel: 'dc', channel_id: '555', query: 'launch' }),
		)
		expect(filtered.messages.map((m) => m.content)).toEqual(['Launch is on Friday'])
		expect(filtered.total).toBe(1)
	})

	it('resolves guild_id + channel_name to a text channel', async () => {
		capture('https://discord.com', 'GET', '/api/v10/guilds/g1/channels', [
			{ id: '700', name: 'announcements', type: 2 },
			{ id: '701', name: 'Announcements', type: 0 },
		])
		capture('https://discord.com', 'GET', '/api/v10/channels/701/messages?limit=20', [])
		expect(
			resultJson(
				await client.callTool('channel_read', {
					channel: 'dc',
					guild_id: 'g1',
					channel_name: '#announcements',
				}),
			),
		).toEqual({ channel_id: '701', messages: [], total: 0 })
	})

	it('returns an error without a channel to read', async () => {
		expect(resultJson(await client.callTool('channel_read', { channel: 'dc' }))).toEqual({
			error: 'provide channel_id, or guild_id + channel_name',
		})
	})
})

describeTool('channel_pair_approve', () => {
	it('consumes the pairing code and allowlists the sender', async () => {
		await env.FERMI_KV.put(
			'pairing:AB12CD34',
			JSON.stringify({ channel: 'wa', senderId: '15555550100', chatId: '15555550100' }),
		)
		const approved = resultJson(
			await client.callTool('channel_pair_approve', { code: ' ab12cd34 ' }),
		)
		expect(approved).toEqual({
			ok: true,
			channel: 'wa',
			senderId: '15555550100',
			chatId: '15555550100',
		})
		expect(await env.FERMI_KV.get('pairing:AB12CD34')).toBeNull()
		const row = await env.FERMI_DB.prepare(
			'SELECT channel, sender_id, added_by FROM allowlist',
		).all()
		expect(row.results).toEqual([{ channel: 'wa', sender_id: '15555550100', added_by: 'pairing' }])

		// single use
		expect(resultJson(await client.callTool('channel_pair_approve', { code: 'AB12CD34' }))).toEqual(
			{ ok: false, error: 'invalid_or_expired_code' },
		)
	})
})
