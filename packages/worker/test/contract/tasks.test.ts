import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// The channel task queue the local daemon drains: enqueue → claim → complete.

interface Claimed {
	tasks: Array<{ id: string; payload: string; queue: string }>
	total: number
	error?: string
}

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.prepare('DELETE FROM tasks').run()
	client = new McpClient()
	await client.initialize()
})

async function enqueue(payload: string, extra: Record<string, unknown> = {}): Promise<string> {
	const created = resultJson<{ id: string; created_at: number }>(
		await client.callTool('task_enqueue', {
			channel: 'tg',
			sender: 'u1',
			chat_id: 'c1',
			payload,
			...extra,
		}),
	)
	return created.id
}

async function claim(args: Record<string, unknown> = {}, c = client): Promise<Claimed> {
	return resultJson<Claimed>(await c.callTool('task_claim', args))
}

async function taskRow(id: string) {
	return env.FERMI_DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<{
		status: string
		result: string | null
		queue: string
		claimed_by: string | null
		parent_task_id: string | null
	}>()
}

describeTool('task_enqueue', () => {
	it('inserts a pending task on the main queue by default', async () => {
		const id = await enqueue('hello')
		expect(id).toMatch(/^[0-9a-f-]{36}$/)
		expect(await taskRow(id)).toMatchObject({ status: 'pending', queue: 'main', claimed_by: null })
	})

	it('records the queue and parent task id', async () => {
		const parent = await enqueue('parent')
		const child = await enqueue('child', { queue: 'grok-bot', parent_task_id: parent })
		expect(await taskRow(child)).toMatchObject({ queue: 'grok-bot', parent_task_id: parent })
	})
})

describeTool('task_claim', () => {
	it('claims the oldest pending tasks first, up to limit (default 3)', async () => {
		const ids: string[] = []
		for (let i = 0; i < 4; i++) ids.push(await enqueue(`t${i}`))
		const first = await claim()
		expect(first.tasks.map((t) => t.id)).toEqual(ids.slice(0, 3))
		expect(first.total).toBe(3)
		expect((await claim()).tasks.map((t) => t.id)).toEqual([ids[3]])
		expect(await claim()).toEqual({ tasks: [], total: 0 })
	})

	it('20 concurrent claims against 10 tasks never hand a task out twice', async () => {
		const ids = new Set<string>()
		for (let i = 0; i < 10; i++) ids.add(await enqueue(`race${i}`))
		const workers = await Promise.all(
			Array.from({ length: 4 }, async () => {
				const c = new McpClient()
				await c.initialize()
				return c
			}),
		)
		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				claim({ limit: 1, claimed_by: `w${i}` }, workers[i % workers.length]).then((r) => ({
					worker: `w${i}`,
					tasks: r.tasks,
				})),
			),
		)
		const claimed = results.flatMap((r) => r.tasks.map((t) => t.id))
		expect(claimed).toHaveLength(10)
		expect(new Set(claimed)).toEqual(ids)
		// each task's lease belongs to the one claimer that received it
		for (const r of results) {
			for (const t of r.tasks) {
				expect(await taskRow(t.id)).toMatchObject({ status: 'claimed', claimed_by: r.worker })
			}
		}
	})

	it('reclaims a task whose lease has expired', async () => {
		const id = await enqueue('stuck')
		// stale_minutes also sets the claimer's lease: ~60ms here
		expect((await claim({ stale_minutes: 0.001, claimed_by: 'a' })).tasks.map((t) => t.id)).toEqual(
			[id],
		)
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect((await claim({ claimed_by: 'b' })).tasks.map((t) => t.id)).toEqual([id])
		expect(await taskRow(id)).toMatchObject({ claimed_by: 'b' })
	})

	it('does not reclaim a task inside its lease', async () => {
		await enqueue('busy')
		expect((await claim()).total).toBe(1)
		expect(await claim({ stale_minutes: 0.001 })).toEqual({ tasks: [], total: 0 })
	})

	it('reclaims a lease-less claimed row older than stale_minutes', async () => {
		const id = await enqueue('legacy')
		await env.FERMI_DB.prepare(
			"UPDATE tasks SET status = 'claimed', claimed_at = ?1, lease_expires_at = NULL WHERE id = ?2",
		)
			.bind(Date.now() - 20 * 60_000, id)
			.run()
		expect(await claim({ stale_minutes: 30 })).toEqual({ tasks: [], total: 0 })
		expect((await claim({ stale_minutes: 10 })).tasks.map((t) => t.id)).toEqual([id])
	})

	it('the unscoped claim ignores fleet and handoff queues', async () => {
		for (const queue of ['agent:box-1', 'broker:exec', 'grok-bot', 'muse']) {
			await enqueue(`on ${queue}`, { queue })
		}
		const main = await enqueue('on main')
		const unscoped = await claim({ limit: 10 })
		expect(unscoped.tasks.map((t) => t.id)).toEqual([main])

		// an explicit non-fleet queue is claimable by its consumer
		const grok = await claim({ queue: 'grok-bot' })
		expect(grok.tasks.map((t) => t.payload)).toEqual(['on grok-bot'])
	})

	it('refuses an explicit fleet queue and leaves its tasks pending', async () => {
		for (const queue of ['agent:box-1', 'broker:exec']) {
			const id = await enqueue(`on ${queue}`, { queue })
			const refused = await claim({ queue })
			expect(refused).toMatchObject({ tasks: [], total: 0, error: 'fleet_queue_off_limits' })
			expect(await taskRow(id)).toMatchObject({ status: 'pending' })
		}
	})
})

describeTool('task_complete', () => {
	it('marks a claimed task done with its result (status defaults to done)', async () => {
		const id = await enqueue('work')
		await claim()
		const done = resultJson(await client.callTool('task_complete', { id, result: 'replied' }))
		expect(done).toEqual({ ok: true })
		expect(await taskRow(id)).toMatchObject({ status: 'done', result: 'replied' })
	})

	it('marks a claimed task failed', async () => {
		const id = await enqueue('work')
		await claim()
		const failed = resultJson(
			await client.callTool('task_complete', { id, status: 'failed', result: 'boom' }),
		)
		expect(failed).toEqual({ ok: true })
		expect(await taskRow(id)).toMatchObject({ status: 'failed', result: 'boom' })
	})

	it('rejects a task that is not claimed: pending, already completed or unknown', async () => {
		const notClaimed = { ok: false, error: 'not_found_or_not_claimed' }
		const id = await enqueue('work')
		expect(resultJson(await client.callTool('task_complete', { id }))).toEqual(notClaimed)
		await claim()
		expect(resultJson(await client.callTool('task_complete', { id }))).toEqual({ ok: true })
		expect(resultJson(await client.callTool('task_complete', { id }))).toEqual(notClaimed)
		expect(resultJson(await client.callTool('task_complete', { id: crypto.randomUUID() }))).toEqual(
			notClaimed,
		)
	})

	it('only the lease holder completes when claimed_by is given', async () => {
		const id = await enqueue('work')
		await claim({ claimed_by: 'box-a' })
		expect(resultJson(await client.callTool('task_complete', { id, claimed_by: 'box-b' }))).toEqual(
			{ ok: false, error: 'not_found_or_not_claimed' },
		)
		expect(await taskRow(id)).toMatchObject({ status: 'claimed' })
		expect(resultJson(await client.callTool('task_complete', { id, claimed_by: 'box-a' }))).toEqual(
			{ ok: true },
		)
	})
})

describeTool('task_list', () => {
	it('lists newest first, filtered by status and queue', async () => {
		const a = await enqueue('a')
		const b = await enqueue('b', { queue: 'muse' })
		const c = await enqueue('c')
		await env.FERMI_DB.prepare("UPDATE tasks SET status = 'done' WHERE id = ?1").bind(a).run()

		const list = async (args: Record<string, unknown>) =>
			resultJson<{ tasks: Array<{ id: string }>; total: number }>(
				await client.callTool('task_list', args),
			)
		const all = await list({})
		expect(all.tasks.map((t) => t.id).sort()).toEqual([a, b, c].sort())
		expect(all.total).toBe(3)
		expect((await list({ status: 'done' })).tasks.map((t) => t.id)).toEqual([a])
		expect((await list({ queue: 'muse' })).tasks.map((t) => t.id)).toEqual([b])
		expect((await list({ limit: 1 })).total).toBe(1)
	})

	it('lists a fan-out by parent_task_id, oldest first', async () => {
		const parent = await enqueue('parent')
		const kids = [
			await enqueue('k1', { parent_task_id: parent }),
			await enqueue('k2', { parent_task_id: parent }),
		]
		await enqueue('unrelated')
		const fanout = resultJson<{ tasks: Array<{ id: string }>; total: number }>(
			await client.callTool('task_list', { parent_task_id: parent }),
		)
		expect(fanout.tasks.map((t) => t.id)).toEqual(kids)
	})
})

describeTool('task_wait', () => {
	it('returns the terminal status and result of a completed task', async () => {
		const id = await enqueue('work')
		await claim()
		await client.callTool('task_complete', { id, status: 'failed', result: 'nope' })
		expect(resultJson(await client.callTool('task_wait', { id }))).toEqual({
			status: 'failed',
			result: 'nope',
		})
	})

	it('returns once a concurrent worker completes the task', async () => {
		const id = await enqueue('work')
		await claim()
		const waiting = client.callTool('task_wait', { id, timeout_seconds: 10, poll_seconds: 0.5 })
		const worker = new McpClient()
		await worker.initialize()
		await worker.callTool('task_complete', { id, result: 'ok' })
		expect(resultJson(await waiting)).toEqual({ status: 'done', result: 'ok' })
	})

	it('times out on an open task and reports not_found for an unknown id', async () => {
		const id = await enqueue('work')
		expect(
			resultJson(await client.callTool('task_wait', { id, timeout_seconds: 1, poll_seconds: 0.5 })),
		).toEqual({ status: 'timeout' })
		expect(resultJson(await client.callTool('task_wait', { id: crypto.randomUUID() }))).toEqual({
			status: 'not_found',
		})
	})
})
