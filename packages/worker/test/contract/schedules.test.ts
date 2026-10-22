import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

interface Created {
	ok: boolean
	id?: string
	kind?: string
	next_run_at?: number
	error?: string
}

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.prepare('DELETE FROM schedules').run()
	client = new McpClient()
	await client.initialize()
})

const base = { channel: 'tg', chat_id: 'c1', prompt: 'Check the build and report.' }

async function create(args: Record<string, unknown>): Promise<Created> {
	return resultJson<Created>(await client.callTool('schedule_create', { ...base, ...args }))
}

async function list(args: Record<string, unknown> = {}) {
	return resultJson<{ schedules: Array<{ id: string; enabled: number }>; total: number }>(
		await client.callTool('schedule_list', args),
	)
}

describeTool('schedule_create', () => {
	it('creates a recurring schedule due every_minutes from now', async () => {
		const before = Date.now()
		const created = await create({ every_minutes: 5 })
		expect(created).toMatchObject({ ok: true, kind: 'every' })
		expect(created.id).toMatch(/^[0-9a-f]{8}$/)
		expect(created.next_run_at).toBeGreaterThanOrEqual(before + 5 * 60_000)
	})

	it('creates a one-shot from an ISO timestamp or epoch ms', async () => {
		const at = Date.now() + 3_600_000
		expect(await create({ at })).toMatchObject({ ok: true, kind: 'at', next_run_at: at })
		const iso = new Date(at).toISOString()
		expect(await create({ at: iso })).toMatchObject({ ok: true, kind: 'at', next_run_at: at })
	})

	it('rejects a cadence below 5 minutes at the schema, storing nothing', async () => {
		const result = await client.callTool('schedule_create', { ...base, every_minutes: 4 })
		expect(result.isError).toBe(true)
		expect(result.content[0].text).toMatch(/every_minutes/)
		expect((await list({ include_disabled: true })).total).toBe(0)
	})

	it('rejects every+at together, neither, a past or unparseable at', async () => {
		expect(await create({ every_minutes: 10, at: Date.now() + 60_000 })).toEqual({
			ok: false,
			error: 'exactly_one_of_every_or_at',
		})
		expect(await create({})).toEqual({ ok: false, error: 'exactly_one_of_every_or_at' })
		expect(await create({ at: Date.now() - 1_000 })).toEqual({
			ok: false,
			error: 'run_at_in_past',
		})
		expect(await create({ at: 'not a date' })).toEqual({
			ok: false,
			error: 'invalid_at_timestamp',
		})
		expect((await list({ include_disabled: true })).total).toBe(0)
	})
})

describeTool('schedule_list', () => {
	it('lists enabled schedules soonest first; include_disabled adds the rest', async () => {
		const later = await create({ every_minutes: 60 })
		const sooner = await create({ every_minutes: 5 })
		const off = await create({ every_minutes: 30 })
		await env.FERMI_DB.prepare('UPDATE schedules SET enabled = 0 WHERE id = ?1').bind(off.id).run()

		const enabled = await list()
		expect(enabled.schedules.map((s) => s.id)).toEqual([sooner.id, later.id])
		expect(enabled.total).toBe(2)
		const all = await list({ include_disabled: true })
		expect(all.schedules.map((s) => s.id)).toEqual([sooner.id, off.id, later.id])
	})
})

describeTool('schedule_delete', () => {
	it('deletes by id and reports not_found for an unknown id', async () => {
		const created = await create({ every_minutes: 15 })
		expect(resultJson(await client.callTool('schedule_delete', { id: created.id }))).toEqual({
			ok: true,
		})
		expect((await list({ include_disabled: true })).total).toBe(0)
		expect(resultJson(await client.callTool('schedule_delete', { id: created.id }))).toEqual({
			ok: false,
			error: 'not_found',
		})
	})
})
