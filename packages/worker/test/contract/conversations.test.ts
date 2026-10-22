import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { getOrCreateChannelSession, logChannelMessage } from '../../src/lib/conversation.ts'
import { endSession } from '../../src/lib/session.ts'
import { describeTool } from './describe-tool.ts'
import { resultJson } from './mcp-client.ts'
import { expectSchemaRejection, resetTables, session } from './tool-call.ts'

interface Turn {
	role: string
	body: string
}

beforeEach(() => resetTables('messages', 'sessions', 'memory', 'profile_docs'))

async function logTurns(chatId: string, bodies: string[]): Promise<void> {
	for (const [i, body] of bodies.entries()) {
		await logChannelMessage(env.FERMI_DB, 'tg', chatId, i % 2 ? 'assistant' : 'user', body)
	}
}

describeTool('conversation_history', () => {
	it('returns the chat transcript oldest first, scoped to the chat', async () => {
		await logTurns('contract-a', ['hi', 'hello', 'how are you'])
		await logTurns('contract-b', ['other chat'])
		const client = await session()
		const res = resultJson<{ messages: Turn[]; total: number; prior_summary: null }>(
			await client.callTool('conversation_history', { channel: 'tg', chat_id: 'contract-a' }),
		)
		expect(res).toMatchObject({ total: 3, prior_summary: null })
		expect(res.messages.map(({ role, body }) => ({ role, body }))).toEqual([
			{ role: 'user', body: 'hi' },
			{ role: 'assistant', body: 'hello' },
			{ role: 'user', body: 'how are you' },
		])
	})

	it('limit keeps the newest turns', async () => {
		await logTurns('contract-a', ['one', 'two', 'three'])
		const client = await session()
		const res = resultJson<{ messages: Turn[] }>(
			await client.callTool('conversation_history', {
				channel: 'tg',
				chat_id: 'contract-a',
				limit: 2,
			}),
		)
		expect(res.messages.map((m) => m.body)).toEqual(['two', 'three'])
	})

	it('returns an empty transcript for an unknown chat', async () => {
		const client = await session()
		expect(
			resultJson(
				await client.callTool('conversation_history', { channel: 'wa', chat_id: 'contract-none' }),
			),
		).toEqual({ messages: [], prior_summary: null, total: 0 })
	})

	it('rejects a call without chat_id', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('conversation_history', { channel: 'tg' }),
			'conversation_history',
			'chat_id',
		)
	})
})

describeTool('context_bootstrap', () => {
	it('bundles profile docs, prior summary, transcript and pinned memories', async () => {
		const client = await session()
		await client.callTool('profile_update', { target: 'user', action: 'add', content: 'Owner' })
		await client.callTool('memory_write', { kind: 'fact', body: 'pinned fact', pinned: true })
		await client.callTool('memory_write', { kind: 'fact', body: 'loose fact' })

		const closed = await getOrCreateChannelSession(env.FERMI_DB, 'dc', 'contract-ctx')
		await env.FERMI_DB.prepare('UPDATE sessions SET summary = ?1 WHERE id = ?2')
			.bind('talked about tea', closed)
			.run()
		await endSession(env.FERMI_DB, closed)
		await logChannelMessage(env.FERMI_DB, 'dc', 'contract-ctx', 'user', 'new session turn')

		const ctx = resultJson(
			await client.callTool('context_bootstrap', { channel: 'dc', chat_id: 'contract-ctx' }),
		)
		expect(ctx).toMatchObject({
			agent_doc: { body: '', usage: 0 },
			user_doc: { body: 'Owner', usage: 5 },
			prior_summary: 'talked about tea',
			history: [{ role: 'user', body: 'new session turn' }],
			pinned_memories: [{ kind: 'fact', body: 'pinned fact' }],
		})
	})

	it('rejects an unknown channel', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('context_bootstrap', { channel: 'xx', chat_id: 'c' }),
			'context_bootstrap',
			'channel',
		)
	})

	it('rejects a call without chat_id', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('context_bootstrap', { channel: 'tg' }),
			'context_bootstrap',
			'chat_id',
		)
	})
})
