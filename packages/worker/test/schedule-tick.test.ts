import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleScheduleTick } from '../src/cron/schedule-tick.ts'
import { createSchedule, listSchedules } from '../src/lib/schedule-store.ts'
import { enqueueTask, listTasks } from '../src/lib/task-store.ts'
import { clearSchedules, clearTasks, setupSchedulesSchema, setupTasksSchema } from './setup-d1.ts'

const NOW = 1_800_000_000_000
const workerEnv = env as unknown as Env
const base = { channel: 'tg', chatId: '99', prompt: 'runbook: check the thing' }

describe('handleScheduleTick', () => {
	beforeAll(async () => {
		await setupSchedulesSchema()
		await setupTasksSchema()
	})

	beforeEach(async () => {
		await clearSchedules()
		await clearTasks()
	})

	it('enqueues a due schedule as a task and advances it', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		const fireAt = created.next_run_at

		const result = await handleScheduleTick(workerEnv, fireAt)
		expect(result.due).toBe(1)

		const tasks = await listTasks(env.FERMI_DB, { status: 'pending' })
		expect(tasks).toHaveLength(1)
		expect(tasks[0]).toMatchObject({
			sender: `schedule:${created.id}`,
			channel: 'tg',
			chat_id: '99',
			payload: 'runbook: check the thing',
		})

		const [schedule] = await listSchedules(env.FERMI_DB)
		expect(schedule.next_run_at).toBe(fireAt + 5 * 60_000)
		expect(schedule.last_status).toBe('enqueued')
	})

	it('coalesces when a pending task from the schedule already exists', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: `schedule:${created.id}`,
			chatId: '99',
			payload: base.prompt,
		})

		await handleScheduleTick(workerEnv, created.next_run_at)

		expect(await listTasks(env.FERMI_DB, { status: 'pending' })).toHaveLength(1)
		const [schedule] = await listSchedules(env.FERMI_DB)
		expect(schedule.last_status).toBe('coalesced')
		expect(schedule.next_run_at).toBe(created.next_run_at + 5 * 60_000)
	})

	it('fires an at-schedule once and disables it', async () => {
		const at = NOW + 60_000
		const created = await createSchedule(env.FERMI_DB, { ...base, runAt: at }, NOW)
		if (!created.ok) throw new Error('setup failed')

		expect((await handleScheduleTick(workerEnv, at)).due).toBe(1)
		expect(await listTasks(env.FERMI_DB, { status: 'pending' })).toHaveLength(1)

		await clearTasks()
		expect((await handleScheduleTick(workerEnv, at + 5 * 60_000)).due).toBe(0)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})

	it('is a no-op when nothing is due', async () => {
		await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 60 }, NOW)
		expect((await handleScheduleTick(workerEnv, NOW + 60_000)).due).toBe(0)
		expect(await listTasks(env.FERMI_DB)).toHaveLength(0)
	})
})
