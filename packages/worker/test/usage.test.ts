import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { measureResultBytes, writeAudit } from '../src/lib/audit.ts'
import { getUsageStats, parseSince } from '../src/lib/usage-store.ts'
import { clearAudit, setupAuditSchema } from './setup-d1.ts'

beforeAll(async () => {
	await setupAuditSchema()
})

beforeEach(async () => {
	await clearAudit()
})

describe('parseSince', () => {
	const now = 1_000_000_000_000
	it('parses relative windows', () => {
		expect(parseSince('7d', now)).toBe(now - 7 * 86_400_000)
		expect(parseSince('24h', now)).toBe(now - 24 * 3_600_000)
	})
	it('passes through epoch ms and defaults to 30d', () => {
		expect(parseSince('123456789', now)).toBe(123456789)
		expect(parseSince(undefined, now)).toBe(now - 30 * 86_400_000)
		expect(parseSince('garbage', now)).toBe(now - 30 * 86_400_000)
	})
})

describe('getUsageStats', () => {
	it('aggregates per tool with token estimates', async () => {
		await writeAudit(env.FERMI_DB, {
			tool: 'search',
			args_hash: 'a',
			outcome: 'ok',
			risk: 'low',
			duration_ms: 100,
			result_bytes: 4000,
			session_id: 's1',
		})
		await writeAudit(env.FERMI_DB, {
			tool: 'search',
			args_hash: 'b',
			outcome: 'ok',
			risk: 'low',
			duration_ms: 300,
			result_bytes: 8000,
			session_id: 's1',
		})
		await writeAudit(env.FERMI_DB, {
			tool: 'memory_write',
			args_hash: 'c',
			outcome: 'denied',
			risk: 'low',
		})

		const stats = await getUsageStats({}, env)
		expect(stats.group_by).toBe('tool')
		expect(stats.rows).toHaveLength(2)

		const search = stats.rows.find((r) => r.key === 'search')
		expect(search).toMatchObject({
			calls: 2,
			ok: 2,
			denied: 0,
			total_result_bytes: 12000,
			avg_result_bytes: 6000,
			est_tokens: 3000,
			avg_duration_ms: 200,
		})

		const memWrite = stats.rows.find((r) => r.key === 'memory_write')
		expect(memWrite).toMatchObject({ calls: 1, ok: 0, denied: 1, total_result_bytes: 0 })

		expect(stats.totals).toEqual({ calls: 3, total_result_bytes: 12000, est_tokens: 3000 })
	})

	it('filters by since and tool', async () => {
		await writeAudit(env.FERMI_DB, { tool: 'old', args_hash: 'x', outcome: 'ok', risk: 'low' })
		// writeAudit always stamps now; emulate an old row directly
		await env.FERMI_DB.prepare('UPDATE audit SET ts = 1000 WHERE tool = ?1').bind('old').run()
		await writeAudit(env.FERMI_DB, { tool: 'fresh', args_hash: 'y', outcome: 'ok', risk: 'low' })

		const stats = await getUsageStats({ since: '1d' }, env)
		expect(stats.rows.map((r) => r.key)).toEqual(['fresh'])

		const filtered = await getUsageStats({ since: '1', tool: 'old' }, env)
		expect(filtered.rows.map((r) => r.key)).toEqual(['old'])
	})

	it('groups by outcome', async () => {
		await writeAudit(env.FERMI_DB, { tool: 'a', args_hash: 'x', outcome: 'ok', risk: 'low' })
		await writeAudit(env.FERMI_DB, { tool: 'b', args_hash: 'y', outcome: 'denied', risk: 'med' })
		const stats = await getUsageStats({ group_by: 'outcome' }, env)
		expect(new Set(stats.rows.map((r) => r.key))).toEqual(new Set(['ok', 'denied']))
	})
})

describe('measureResultBytes', () => {
	it('measures serialized size', () => {
		expect(measureResultBytes({ a: 1 })).toBe(7)
	})
	it('returns undefined for unserializable values', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		expect(measureResultBytes(cyclic)).toBeUndefined()
	})
})
