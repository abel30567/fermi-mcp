import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { seedStatements } from '../../scripts/eval-db.mjs'
import fixture from '../fixtures/eval/history.json'
import { resultJson } from './mcp-client.ts'
import { session } from './tool-call.ts'

interface Turn {
	role: string
	body: string
	created_at: number
}

const { channel, chat_id, history } = fixture.conversation

// eval-seed.mjs runs these statements through `wrangler d1 execute --local`;
// here they run against the contract D1, then the real tools read them over /mcp.
async function seed(f: unknown) {
	const db = env.FERMI_DB
	await db.batch(seedStatements(f).map((s: string) => db.prepare(s)))
}

function expectSeededTurns(turns: Turn[]) {
	const now = Date.now()
	expect(turns.map(({ role, body }) => ({ role, body }))).toEqual(
		history.map(({ role, text }) => ({ role, body: text })),
	)
	for (const [i, turn] of turns.entries()) {
		const expected = now - history[i].minutes_ago * 60_000
		expect(Math.abs(turn.created_at - expected)).toBeLessThanOrEqual(60_000)
	}
}

describe('eval seed: conversation history', () => {
	beforeAll(() => seed(fixture))

	it('context_bootstrap returns the seeded turns in order with roles and timestamps', async () => {
		const client = await session()
		const res = resultJson<{ history: Turn[] }>(
			await client.callTool('context_bootstrap', { channel, chat_id }),
		)
		expectSeededTurns(res.history)
	})

	it('conversation_history returns the seeded turns in order with roles and timestamps', async () => {
		const client = await session()
		const res = resultJson<{ messages: Turn[]; total: number }>(
			await client.callTool('conversation_history', { channel, chat_id }),
		)
		expect(res.total).toBe(history.length)
		expectSeededTurns(res.messages)
	})

	it('session_search finds a phrase from a seeded turn', async () => {
		const client = await session()
		const res = resultJson<{ results: { role: string; body: string }[] }>(
			await client.callTool('session_search', { query: '"line was busy"' }),
		)
		expect(res.results).toContainEqual(
			expect.objectContaining({ role: 'assistant', body: history[3].text }),
		)
	})

	it('re-seeding replaces the chat transcript instead of appending', async () => {
		await seed(fixture)
		const client = await session()
		const res = resultJson<{ total: number }>(
			await client.callTool('conversation_history', { channel, chat_id }),
		)
		expect(res.total).toBe(history.length)
	})

	it('prefixes user turns with the sender like a group turn', async () => {
		await seed({
			conversation: {
				channel: 'sl',
				chat_id: 'C0EVALGROUP',
				sender: 'Eval Owner',
				history: [
					{ role: 'user', text: 'who is calling?', minutes_ago: 3 },
					{ role: 'assistant', text: 'Nobody yet.', minutes_ago: 2 },
				],
			},
		})
		const client = await session()
		const res = resultJson<{ messages: Turn[] }>(
			await client.callTool('conversation_history', { channel: 'sl', chat_id: 'C0EVALGROUP' }),
		)
		expect(res.messages.map((m) => m.body)).toEqual(['[Eval Owner] who is calling?', 'Nobody yet.'])
	})

	it('rejects a turn with an unknown role', () => {
		expect(() =>
			seedStatements({
				conversation: {
					channel,
					chat_id,
					history: [{ role: 'system', text: 'x', minutes_ago: 1 }],
				},
			}),
		).toThrow('role must be user or assistant')
	})
})
