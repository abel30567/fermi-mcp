import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runRetriever } from '../src/lib/retrievers-store.ts'

// Minimal retrievers table (mirrors migrations/0007_retrievers.sql shape used here)
async function setup() {
	await env.FERMI_DB.prepare(
		`CREATE TABLE IF NOT EXISTS retrievers (name TEXT PRIMARY KEY, sql TEXT NOT NULL, description TEXT, param_schema TEXT NOT NULL DEFAULT '{}', created_at INTEGER, updated_at INTEGER)`,
	).run()
	await env.FERMI_DB.prepare('DELETE FROM retrievers').run()
}

async function tryRun(name: string, sql: string) {
	await env.FERMI_DB.prepare(
		'INSERT OR REPLACE INTO retrievers (name, sql, param_schema, created_at, updated_at) VALUES (?1,?2,?3,0,0)',
	)
		.bind(name, sql, '{}')
		.run()
	try {
		await runRetriever(name, {}, env)
		return 'allowed'
	} catch (e) {
		return String((e as Error).message)
	}
}

describe('retriever read-only guard (#38: ignore literals/comments)', () => {
	beforeAll(setup)
	beforeEach(setup)

	it('allows a SELECT with a data-modifying word inside a string literal', async () => {
		expect(await tryRun('lit', "SELECT 'please delete later' AS note")).toBe('allowed')
	})
	it('allows a SELECT with a comment mentioning update', async () => {
		expect(await tryRun('cmt', 'SELECT 1 AS n -- update the docs later')).toBe('allowed')
	})
	it('blocks WITH ... DELETE', async () => {
		expect(await tryRun('wd', 'WITH x AS (SELECT 1) DELETE FROM retrievers')).toMatch(/read_only/)
	})
	it('blocks a plain UPDATE', async () => {
		expect(await tryRun('up', "UPDATE retrievers SET sql='x'")).toMatch(/read_only/)
	})
})
