import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations } from './setup-d1.ts'

async function ftsIds(query: string) {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT rowid AS id FROM messages_fts WHERE messages_fts MATCH ?1 ORDER BY rowid',
	)
		.bind(query)
		.all<{ id: number }>()
	return results.map((r) => r.id)
}

describe('migrations', () => {
	beforeAll(async () => {
		await applyMigrations()
	})

	it('indexes the message seeded before the FTS triggers existed', async () => {
		expect(await ftsIds('Hello')).toEqual([1])
	})

	it('deletes the seeded message without corrupting the FTS index', async () => {
		await env.FERMI_DB.prepare('DELETE FROM messages WHERE id = 1').run()
		expect(await ftsIds('Hello')).toEqual([])
		const check = env.FERMI_DB.prepare(
			"INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)",
		)
		await expect(check.run()).resolves.toBeDefined()
	})

	it('indexes messages inserted after migrations', async () => {
		await env.FERMI_DB.prepare(
			"INSERT INTO messages (id, session_id, role, body, created_at) VALUES (2, 'seed-session-001', 'user', 'quasar ping', 0)",
		).run()
		expect(await ftsIds('quasar')).toEqual([2])
	})
})
