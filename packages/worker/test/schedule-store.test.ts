import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	advanceSchedule,
	createSchedule,
	deleteSchedule,
	dueSchedules,
	listSchedules,
} from '../src/lib/schedule-store.ts'
import { clearSchedules, setupSchedulesSchema } from './setup-d1.ts'

const NOW = 1_800_000_000_000
const base = { channel: 'tg', chatId: '99', prompt: 'do the thing' }

describe('schedule-store', () => {
	beforeAll(async () => {
		await setupSchedulesSchema()
	})

	beforeEach(async () => {
		await clearSchedules()
	})

	it('creates an every schedule with next_run_at = now + cadence', async () => {
		const result = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		expect(result).toMatchObject({ ok: true, kind: 'every', next_run_at: NOW + 5 * 60_000 })
	})

	it('creates an at schedule with next_run_at = run_at', async () => {
		const at = NOW + 3_600_000
		const result = await createSchedule(env.FERMI_DB, { ...base, runAt: at }, NOW)
		expect(result).toMatchObject({ ok: true, kind: 'at', next_run_at: at })
	})

	it('accepts cadence boundaries 5 and 10080, rejects 4 and 10081', async () => {
		expect((await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)).ok).toBe(true)
		expect((await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 10_080 }, NOW)).ok).toBe(
			true,
		)
		expect(await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 4 }, NOW)).toEqual({
			ok: false,
			error: 'every_minutes_out_of_range',
		})
		expect(await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 10_081 }, NOW)).toEqual({
			ok: false,
			error: 'every_minutes_out_of_range',
		})
	})

	it('requires exactly one of every_minutes and at', async () => {
		expect(await createSchedule(env.FERMI_DB, { ...base }, NOW)).toEqual({
			ok: false,
			error: 'exactly_one_of_every_or_at',
		})
		expect(
			await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5, runAt: NOW + 1000 }, NOW),
		).toEqual({ ok: false, error: 'exactly_one_of_every_or_at' })
	})

	it('validates the prompt', async () => {
		expect(
			await createSchedule(env.FERMI_DB, { ...base, prompt: '  ', everyMinutes: 5 }, NOW),
		).toEqual({ ok: false, error: 'prompt_empty' })
		expect(
			await createSchedule(
				env.FERMI_DB,
				{ ...base, prompt: 'x'.repeat(8001), everyMinutes: 5 },
				NOW,
			),
		).toEqual({ ok: false, error: 'prompt_too_long' })
	})

	it('validates run_at bounds', async () => {
		expect(await createSchedule(env.FERMI_DB, { ...base, runAt: NOW }, NOW)).toEqual({
			ok: false,
			error: 'run_at_in_past',
		})
		expect(
			await createSchedule(env.FERMI_DB, { ...base, runAt: NOW + 366 * 86_400_000 }, NOW),
		).toEqual({ ok: false, error: 'run_at_too_far' })
	})

	it('rejects the 21st active schedule', async () => {
		for (let i = 0; i < 20; i++) {
			expect((await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 60 }, NOW)).ok).toBe(true)
		}
		expect(await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 60 }, NOW)).toEqual({
			ok: false,
			error: 'too_many_active_schedules',
		})
	})

	it('dueSchedules honors the next_run_at boundary', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		expect(await dueSchedules(env.FERMI_DB, created.next_run_at - 1)).toHaveLength(0)
		expect(await dueSchedules(env.FERMI_DB, created.next_run_at)).toHaveLength(1)
	})

	it('advances every-schedules from now and disables at-schedules', async () => {
		await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 10 }, NOW)
		await createSchedule(env.FERMI_DB, { ...base, runAt: NOW + 1000 }, NOW)
		const later = NOW + 30 * 60_000
		for (const schedule of await dueSchedules(env.FERMI_DB, later)) {
			await advanceSchedule(env.FERMI_DB, schedule, 'enqueued', later)
		}
		const all = await listSchedules(env.FERMI_DB, { includeDisabled: true })
		const every = all.find((s) => s.kind === 'every')
		const at = all.find((s) => s.kind === 'at')
		expect(every?.next_run_at).toBe(later + 10 * 60_000)
		expect(every?.last_status).toBe('enqueued')
		expect(at?.enabled).toBe(0)
	})

	it('keeps the cadence phase when the tick fires late', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		// Tick jitter: handler runs 33s after the due moment
		const tickTime = created.next_run_at + 33_000
		const [due] = await dueSchedules(env.FERMI_DB, tickTime)
		await advanceSchedule(env.FERMI_DB, due, 'enqueued', tickTime)
		const [row] = await listSchedules(env.FERMI_DB)
		// Phase-aligned: scheduled time + cadence, NOT tick time + cadence
		expect(row.next_run_at).toBe(created.next_run_at + 5 * 60_000)
	})

	it('skips missed slots without a catch-up burst', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		// Mac was asleep: 23 minutes pass before the next firing
		const wakeTick = created.next_run_at + 23 * 60_000
		const [due] = await dueSchedules(env.FERMI_DB, wakeTick)
		await advanceSchedule(env.FERMI_DB, due, 'enqueued', wakeTick)
		const [row] = await listSchedules(env.FERMI_DB)
		// First phase-aligned slot strictly after the wake tick: +25 min
		expect(row.next_run_at).toBe(created.next_run_at + 25 * 60_000)
	})

	it('deletes schedules and errors on unknown ids', async () => {
		const created = await createSchedule(env.FERMI_DB, { ...base, everyMinutes: 5 }, NOW)
		if (!created.ok) throw new Error('setup failed')
		expect(await deleteSchedule(env.FERMI_DB, created.id)).toEqual({ ok: true })
		expect(await deleteSchedule(env.FERMI_DB, 'missing')).toEqual({
			ok: false,
			error: 'not_found',
		})
	})
})
