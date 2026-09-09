import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	claimTasks,
	completeTask,
	countPendingTasks,
	enqueueTask,
	listTasks,
	listTasksByParent,
} from '../src/lib/task-store.ts'
import { clearTasks, setupTasksSchema } from './setup-d1.ts'

describe('task-store', () => {
	beforeAll(async () => {
		await setupTasksSchema()
	})

	beforeEach(async () => {
		await clearTasks()
	})

	it('enqueues a task as pending', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '111',
			chatId: '222',
			payload: 'hello',
		})
		expect(id).toBeTruthy()
		const tasks = await listTasks(env.FERMI_DB)
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({ id, channel: 'tg', status: 'pending', payload: 'hello' })
		expect(await countPendingTasks(env.FERMI_DB)).toBe(1)
	})

	it('claims tasks FIFO and marks them claimed', async () => {
		const first = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '1',
			chatId: 'c',
			payload: 'first',
		})
		// Force distinct created_at ordering regardless of clock resolution
		await env.FERMI_DB.prepare('UPDATE tasks SET created_at = created_at - 1000 WHERE id = ?1')
			.bind(first.id)
			.run()
		await enqueueTask(env.FERMI_DB, { channel: 'tg', sender: '2', chatId: 'c', payload: 'second' })

		const claimed = await claimTasks(env.FERMI_DB, { limit: 1 })
		expect(claimed).toHaveLength(1)
		expect(claimed[0].payload).toBe('first')

		const rows = await listTasks(env.FERMI_DB, { status: 'claimed' })
		expect(rows).toHaveLength(1)
		expect(rows[0].claimed_at).toBeTypeOf('number')
		expect(await countPendingTasks(env.FERMI_DB)).toBe(1)
	})

	it('does not re-claim a freshly claimed task', async () => {
		await enqueueTask(env.FERMI_DB, { channel: 'tg', sender: '1', chatId: 'c', payload: 'x' })
		expect(await claimTasks(env.FERMI_DB)).toHaveLength(1)
		expect(await claimTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('reclaims tasks whose claim went stale', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '1',
			chatId: 'c',
			payload: 'x',
		})
		await claimTasks(env.FERMI_DB)
		// Age the claim past the stale window; NULL lease = legacy pre-0017 row,
		// which falls back to the claimed_at + staleMs window
		await env.FERMI_DB.prepare(
			'UPDATE tasks SET claimed_at = ?1, lease_expires_at = NULL WHERE id = ?2',
		)
			.bind(Date.now() - 16 * 60_000, id)
			.run()
		const reclaimed = await claimTasks(env.FERMI_DB)
		expect(reclaimed).toHaveLength(1)
		expect(reclaimed[0].id).toBe(id)
	})

	it('completes a claimed task as done with result', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '1',
			chatId: 'c',
			payload: 'x',
		})
		await claimTasks(env.FERMI_DB)
		const outcome = await completeTask(env.FERMI_DB, id, { result: 'answered' })
		expect(outcome.ok).toBe(true)
		const [row] = await listTasks(env.FERMI_DB, { status: 'done' })
		expect(row).toMatchObject({ id, result: 'answered' })
		expect(row.completed_at).toBeTypeOf('number')
	})

	it('completes a claimed task as failed', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '1',
			chatId: 'c',
			payload: 'x',
		})
		await claimTasks(env.FERMI_DB)
		const outcome = await completeTask(env.FERMI_DB, id, { status: 'failed', result: 'no can do' })
		expect(outcome.ok).toBe(true)
		expect(await listTasks(env.FERMI_DB, { status: 'failed' })).toHaveLength(1)
	})

	it('refuses to complete a task that is not claimed', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: '1',
			chatId: 'c',
			payload: 'x',
		})
		expect(await completeTask(env.FERMI_DB, id)).toEqual({
			ok: false,
			error: 'not_found_or_not_claimed',
		})
		expect(await completeTask(env.FERMI_DB, 'missing-id')).toEqual({
			ok: false,
			error: 'not_found_or_not_claimed',
		})
	})
})

// T1 gates for cloud-fleet queue ownership (plan/feat-cloud-agents)
describe('task-store queues and leases', () => {
	beforeAll(async () => {
		await setupTasksSchema()
	})

	beforeEach(async () => {
		await clearTasks()
	})

	it('claimants on different queues never cross-claim', async () => {
		await enqueueTask(env.FERMI_DB, { channel: 'tg', sender: '1', chatId: 'c', payload: 'mac' })
		await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orchestrator',
			chatId: 'c',
			payload: 'box-work',
			queue: 'box:alpha',
		})

		const boxClaims = await claimTasks(env.FERMI_DB, { queue: 'box:alpha', claimedBy: 'box-alpha' })
		expect(boxClaims).toHaveLength(1)
		expect(boxClaims[0]).toMatchObject({ payload: 'box-work', queue: 'box:alpha' })

		const macClaims = await claimTasks(env.FERMI_DB)
		expect(macClaims).toHaveLength(1)
		expect(macClaims[0]).toMatchObject({ payload: 'mac', queue: 'main' })

		expect(await claimTasks(env.FERMI_DB, { queue: 'box:alpha' })).toHaveLength(0)
		expect(await claimTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('10 concurrent claimants produce zero double-claims', async () => {
		for (let i = 0; i < 10; i++) {
			await enqueueTask(env.FERMI_DB, {
				channel: 'cloud',
				sender: 'orch',
				chatId: 'c',
				payload: `t${i}`,
				queue: 'box:alpha',
			})
		}
		const batches = await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				claimTasks(env.FERMI_DB, { queue: 'box:alpha', limit: 1, claimedBy: `w${i}` }),
			),
		)
		const ids = batches.flat().map((t) => t.id)
		expect(ids).toHaveLength(10)
		expect(new Set(ids).size).toBe(10)
		expect(await claimTasks(env.FERMI_DB, { queue: 'box:alpha' })).toHaveLength(0)
	})

	it('reclaims an expired lease but never a live one', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'c',
			payload: 'x',
			queue: 'box:alpha',
		})
		await claimTasks(env.FERMI_DB, { queue: 'box:alpha', claimedBy: 'box-a', leaseMs: 60_000 })
		// Live lease: not reclaimable even by the same box
		expect(await claimTasks(env.FERMI_DB, { queue: 'box:alpha', claimedBy: 'box-b' })).toHaveLength(
			0,
		)
		// Expire the lease → reclaimable, ownership transfers
		await env.FERMI_DB.prepare('UPDATE tasks SET lease_expires_at = ?1 WHERE id = ?2')
			.bind(Date.now() - 1000, id)
			.run()
		const reclaimed = await claimTasks(env.FERMI_DB, { queue: 'box:alpha', claimedBy: 'box-b' })
		expect(reclaimed).toHaveLength(1)
		expect(reclaimed[0].id).toBe(id)
		const [row] = await listTasks(env.FERMI_DB, { status: 'claimed', queue: 'box:alpha' })
		expect(row.claimed_by).toBe('box-b')
	})

	it('only the lease holder may complete; double-complete is a no-op error', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'c',
			payload: 'x',
			queue: 'box:alpha',
		})
		await claimTasks(env.FERMI_DB, { queue: 'box:alpha', claimedBy: 'box-a' })
		expect(await completeTask(env.FERMI_DB, id, { claimedBy: 'box-b' })).toEqual({
			ok: false,
			error: 'not_found_or_not_claimed',
		})
		expect((await completeTask(env.FERMI_DB, id, { claimedBy: 'box-a' })).ok).toBe(true)
		expect((await completeTask(env.FERMI_DB, id, { claimedBy: 'box-a' })).ok).toBe(false)
	})

	it('aggregates fan-out children by parent_task_id', async () => {
		const parent = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'c',
			payload: 'fan-out 3 agents',
			queue: 'main',
		})
		for (let i = 0; i < 3; i++) {
			await enqueueTask(env.FERMI_DB, {
				channel: 'cloud',
				sender: 'orch',
				chatId: 'c',
				payload: `child ${i}`,
				queue: `box:${i}`,
				parentTaskId: parent.id,
			})
		}
		for (let i = 0; i < 3; i++) {
			const [t] = await claimTasks(env.FERMI_DB, { queue: `box:${i}`, claimedBy: `box-${i}` })
			await completeTask(env.FERMI_DB, t.id, {
				status: i === 2 ? 'failed' : 'done',
				result: i === 2 ? 'proof missing' : 'proof attached',
				claimedBy: `box-${i}`,
			})
		}
		const children = await listTasksByParent(env.FERMI_DB, parent.id)
		expect(children).toHaveLength(3)
		expect(children.map((c) => c.status).sort()).toEqual(['done', 'done', 'failed'])
		expect(children.every((c) => c.parent_task_id === parent.id)).toBe(true)
	})
})

import { countPendingTasks as _cpt, isFleetQueue as _ifq } from '../src/lib/task-store.ts'
describe('fleet queues isolated from channel drain (2026-09-08 SCA incident)', () => {
	beforeAll(async () => { await setupTasksSchema() })
	beforeEach(async () => { await clearTasks() })
	it('unscoped pending count excludes agent:* and broker:* queues', async () => {
		await enqueueTask(env.FERMI_DB, { channel: 'wa', sender: 'u', chatId: 'c', payload: '{}', queue: 'default' })
		await enqueueTask(env.FERMI_DB, { channel: 'cloud', sender: 'x', chatId: 'c', payload: '{}', queue: 'agent:ca_x' })
		await enqueueTask(env.FERMI_DB, { channel: 'broker', sender: 'x', chatId: 'c', payload: '{}', queue: 'broker:ops' })
		expect(await countPendingTasks(env.FERMI_DB)).toBe(1) // only the default-queue channel task
		expect(await countPendingTasks(env.FERMI_DB, 'agent:ca_x')).toBe(1) // explicit scope still sees it
	})
	it('isFleetQueue classifies correctly', () => {
		expect(_ifq('agent:ca_1')).toBe(true)
		expect(_ifq('broker:ops')).toBe(true)
		expect(_ifq('default')).toBe(false)
		expect(_ifq(undefined)).toBe(false)
	})
})
