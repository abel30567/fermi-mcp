import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	deleteMemory,
	listRecentMemories,
	recallMemories,
	writeMemory,
} from '../src/lib/memory-store.ts'
import { clearMemory, setupMemorySchema } from './setup-d1.ts'

beforeAll(async () => {
	await setupMemorySchema()
})

beforeEach(async () => {
	await clearMemory()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('listRecentMemories', () => {
	it('returns memories in descending created_at order', async () => {
		await writeMemory({ kind: 'fact', body: 'one' }, env)
		await sleep(5)
		await writeMemory({ kind: 'fact', body: 'two' }, env)
		await sleep(5)
		await writeMemory({ kind: 'fact', body: 'three' }, env)
		const r = await listRecentMemories(10, env)
		expect(r.map((m) => m.body)).toEqual(['three', 'two', 'one'])
	})

	it('respects limit', async () => {
		for (let i = 0; i < 5; i++) {
			await writeMemory({ kind: 'fact', body: `m${i}` }, env)
			await sleep(2)
		}
		const r = await listRecentMemories(2, env)
		expect(r).toHaveLength(2)
	})

	it('excludes decayed memories', async () => {
		await writeMemory({ kind: 'fact', body: 'keep' }, env)
		await sleep(5)
		const b = await writeMemory({ kind: 'fact', body: 'kill' }, env)
		await deleteMemory(b.id, env)
		const r = await listRecentMemories(10, env)
		expect(r.map((m) => m.body)).toEqual(['keep'])
	})

	it('returns empty array when no memories', async () => {
		const r = await listRecentMemories(10, env)
		expect(r).toEqual([])
	})
})

describe('recallMemories sort_by', () => {
	it("sort_by='created_at' ignores pinned ordering (newest wins)", async () => {
		await writeMemory({ kind: 'fact', body: 'matchword old', pinned: true }, env)
		await sleep(5)
		const fresh = await writeMemory({ kind: 'fact', body: 'matchword fresh' }, env)
		const r = await recallMemories('matchword', 10, env, 'created_at')
		expect(r[0].id).toBe(fresh.id)
	})

	it("default sort_by='relevance' puts pinned first", async () => {
		await writeMemory({ kind: 'fact', body: 'matchword fresh' }, env)
		await sleep(5)
		const pinned = await writeMemory({ kind: 'fact', body: 'matchword old', pinned: true }, env)
		const r = await recallMemories('matchword', 10, env)
		expect(r[0].id).toBe(pinned.id)
	})
})
