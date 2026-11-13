import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { resultJson } from './mcp-client.ts'
import { expectSchemaRejection, resetTables, session } from './tool-call.ts'

interface Memory {
	id: number
	kind: string
	body: string
	pinned: number | boolean
	created_at: number
}
interface MemoryList {
	results: Memory[]
	total: number
}

beforeEach(() => resetTables('memory'))

async function memoryRow(id: number) {
	return env.FERMI_DB.prepare('SELECT kind, body, pinned, decayed_at FROM memory WHERE id = ?1')
		.bind(id)
		.first<{ kind: string; body: string; pinned: number; decayed_at: number | null }>()
}

async function write(body: string, extra: Record<string, unknown> = {}): Promise<Memory> {
	const client = await session()
	return resultJson<Memory>(await client.callTool('memory_write', { kind: 'fact', body, ...extra }))
}

describeTool('memory_write', () => {
	it('persists the memory and returns it', async () => {
		const written = await write('contract: the owner drinks oolong', { pinned: true })
		expect(written).toMatchObject({
			kind: 'fact',
			body: 'contract: the owner drinks oolong',
			pinned: true,
		})
		expect(written.id).toBeGreaterThan(0)
		expect(await memoryRow(written.id)).toEqual({
			kind: 'fact',
			body: 'contract: the owner drinks oolong',
			pinned: 1,
			decayed_at: null,
		})
	})

	it('rejects a call without body and writes nothing', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('memory_write', { kind: 'fact' }),
			'memory_write',
			'body',
		)
		const count = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM memory').first<{
			n: number
		}>()
		expect(count?.n).toBe(0)
	})

	it('round-trips through memory_recall', async () => {
		const written = await write('contract: round trip marker 7f3a')
		const client = await session()
		const recalled = resultJson<MemoryList>(
			await client.callTool('memory_recall', { query: 'marker 7f3a' }),
		)
		expect(recalled.results).toEqual([
			{
				id: written.id,
				kind: 'fact',
				body: written.body,
				pinned: 0,
				created_at: written.created_at,
			},
		])
	})
})

describeTool('memory_recall', () => {
	it('returns matching memories, pinned first, and skips non-matches', async () => {
		const plain = await write('contract: recall tea plain')
		const pinned = await write('contract: recall tea pinned', { pinned: true })
		await write('contract: unrelated coffee')
		const client = await session()
		const recalled = resultJson<MemoryList & { query: string; sort_by: string }>(
			await client.callTool('memory_recall', { query: 'recall tea' }),
		)
		expect(recalled).toMatchObject({ query: 'recall tea', sort_by: 'relevance', total: 2 })
		expect(recalled.results.map((m) => m.id)).toEqual([pinned.id, plain.id])
	})

	it('excludes soft-deleted memories', async () => {
		const gone = await write('contract: recall decayed')
		const client = await session()
		await client.callTool('memory_delete', { id: gone.id })
		const recalled = resultJson<MemoryList>(
			await client.callTool('memory_recall', { query: 'recall decayed' }),
		)
		expect(recalled).toMatchObject({ results: [], total: 0 })
	})

	it('rejects a call without query', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('memory_recall', {}), 'memory_recall', 'query')
	})
})

describeTool('memory_list_recent', () => {
	it('lists the newest non-decayed memories first, up to limit', async () => {
		const ids: number[] = []
		for (const n of [1, 2, 3]) {
			const m = await write(`contract: recent ${n}`)
			await env.FERMI_DB.prepare('UPDATE memory SET created_at = ?1 WHERE id = ?2')
				.bind(1_000 * n, m.id)
				.run()
			ids.push(m.id)
		}
		const client = await session()
		const listed = resultJson<MemoryList>(await client.callTool('memory_list_recent', { limit: 2 }))
		expect(listed.total).toBe(2)
		expect(listed.results.map((m) => m.id)).toEqual([ids[2], ids[1]])
	})

	it('rejects a non-numeric limit', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('memory_list_recent', { limit: 'ten' }),
			'memory_list_recent',
			'limit',
		)
	})
})

describeTool('memory_update', () => {
	it('changes only the provided fields and the change reads back', async () => {
		const written = await write('contract: before update')
		const client = await session()
		const updated = resultJson(
			await client.callTool('memory_update', {
				id: written.id,
				patch: { body: 'contract: after update', pinned: true },
			}),
		)
		expect(updated).toEqual({ id: written.id, updated: true, changes: 1 })
		expect(await memoryRow(written.id)).toEqual({
			kind: 'fact',
			body: 'contract: after update',
			pinned: 1,
			decayed_at: null,
		})
		const recalled = resultJson<MemoryList>(
			await client.callTool('memory_recall', { query: 'after update' }),
		)
		expect(recalled.results.map((m) => m.id)).toEqual([written.id])
	})

	it('returns the documented error for an empty patch', async () => {
		const written = await write('contract: empty patch')
		const client = await session()
		expect(
			resultJson(await client.callTool('memory_update', { id: written.id, patch: {} })),
		).toEqual({ error: 'No fields to update' })
	})

	it('reports updated=false for an unknown id', async () => {
		const client = await session()
		expect(
			resultJson(await client.callTool('memory_update', { id: 999_999, patch: { body: 'x' } })),
		).toEqual({ id: 999_999, updated: false, changes: 0 })
	})

	it('rejects a call without patch', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('memory_update', { id: 1 }),
			'memory_update',
			'patch',
		)
	})
})

describeTool('memory_delete', () => {
	it('soft-deletes: the row stays with decayed_at set', async () => {
		const written = await write('contract: to delete')
		const client = await session()
		expect(resultJson(await client.callTool('memory_delete', { id: written.id }))).toEqual({
			id: written.id,
			deleted: true,
		})
		const row = await memoryRow(written.id)
		expect(row?.body).toBe('contract: to delete')
		expect(row?.decayed_at).toEqual(expect.any(Number))
		const listed = resultJson<MemoryList>(await client.callTool('memory_list_recent', {}))
		expect(listed.results.map((m) => m.id)).not.toContain(written.id)
	})

	it('reports deleted=false for an unknown or already deleted id', async () => {
		const written = await write('contract: delete twice')
		const client = await session()
		await client.callTool('memory_delete', { id: written.id })
		expect(resultJson(await client.callTool('memory_delete', { id: written.id }))).toEqual({
			id: written.id,
			deleted: false,
		})
	})

	it('rejects a call without id', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('memory_delete', {}), 'memory_delete', 'id')
	})
})
