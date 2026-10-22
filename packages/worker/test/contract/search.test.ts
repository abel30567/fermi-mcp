import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { logChannelMessage } from '../../src/lib/conversation.ts'
import { describeTool } from './describe-tool.ts'
import { resultJson } from './mcp-client.ts'
import { expectSchemaRejection, resetTables, session } from './tool-call.ts'

interface Match {
	id: string
	type: string
	name?: string
	snippet?: string
	metadata?: Record<string, unknown>
}
interface SearchResult {
	matches: Match[]
	offline: boolean
	warnings: string[]
	guidance: string[]
}

beforeEach(() => resetTables('memory', 'skills', 'messages', 'sessions'))

const SKILL_BODY = `---
name: contract-zebra
description: Groom the contract zebra
keywords: ["zebra"]
---
Brush the stripes.
`

describeTool('search', () => {
	it('ranks a written skill above a written memory for the same query', async () => {
		const client = await session()
		const memory = resultJson<{ id: number }>(
			await client.callTool('memory_write', { kind: 'fact', body: 'contract: zebra facts' }),
		)
		await client.callTool('skill_set', { slug: 'contract-zebra', body: SKILL_BODY })

		const res = resultJson<SearchResult>(
			await client.callTool('search', { query: 'zebra', types: ['skill', 'memory'] }),
		)
		expect(res.matches.map((m) => m.id)).toEqual(['contract-zebra:skill', `${memory.id}:memory`])
		expect(res.matches[1]).toMatchObject({ type: 'memory', snippet: 'contract: zebra facts' })
		// no Vectorize binding in the contract worker: keyword sources only
		expect(res).toMatchObject({ offline: true, warnings: ['vectorize_binding_missing'] })
	})

	it('finds a logged message through the FTS index', async () => {
		await logChannelMessage(env.FERMI_DB, 'tg', 'contract-chat', 'user', 'quokka sighting today')
		const client = await session()
		const res = resultJson<SearchResult>(
			await client.callTool('search', { query: 'quokka', types: ['memory'] }),
		)
		expect(res.matches).toMatchObject([
			{ type: 'message', snippet: 'quokka sighting today', metadata: { role: 'user' } },
		])
	})

	it('entity mode returns the stored entity detail', async () => {
		const client = await session()
		const memory = resultJson<{ id: number }>(
			await client.callTool('memory_write', { kind: 'event', body: 'contract: entity body' }),
		)
		const res = resultJson<SearchResult>(
			await client.callTool('search', { entity: `${memory.id}:memory` }),
		)
		expect(res.matches).toMatchObject([
			{ id: `${memory.id}:memory`, type: 'memory', snippet: 'contract: entity body' },
		])
		expect(res.matches[0].metadata).toMatchObject({ kind: 'event', pinned: false })
	})

	it('returns entity_not_found for an unknown entity and guidance for no match', async () => {
		const client = await session()
		expect(
			resultJson<SearchResult>(
				await client.callTool('search', { entity: 'contract-missing:skill' }),
			),
		).toMatchObject({ matches: [], warnings: ['entity_not_found'] })
		const none = resultJson<SearchResult>(
			await client.callTool('search', { query: 'contract-nothing-matches', types: ['memory'] }),
		)
		expect(none.matches).toEqual([])
		expect(none.guidance).toEqual([
			'No matches for "contract-nothing-matches". Try a different keyword or list with empty query.',
		])
	})

	// search has no required argument; an out-of-range limit is its schema rejection.
	it('rejects a limit outside 1-50', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('search', { query: 'x', limit: 0 }),
			'search',
			'limit',
		)
	})
})

describeTool('session_search', () => {
	it('returns logged messages that match the FTS query', async () => {
		await logChannelMessage(env.FERMI_DB, 'sl', 'contract-chat', 'user', 'wombat burrow notes')
		await logChannelMessage(env.FERMI_DB, 'sl', 'contract-chat', 'assistant', 'unrelated reply')
		const client = await session()
		const res = resultJson<{ query: string; results: Array<{ role: string; body: string }> }>(
			await client.callTool('session_search', { query: 'wombat' }),
		)
		expect(res).toMatchObject({
			query: 'wombat',
			results: [{ role: 'user', body: 'wombat burrow notes' }],
			total: 1,
		})
	})

	it('returns the D1 error as an isError result for malformed FTS syntax', async () => {
		const client = await session()
		const res = await client.callTool('session_search', { query: '"unbalanced' })
		expect(res.isError).toBe(true)
		expect(res.content[0]?.text).toContain('D1_ERROR')
	})

	it('rejects a call without query', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('session_search', {}), 'session_search', 'query')
	})
})
