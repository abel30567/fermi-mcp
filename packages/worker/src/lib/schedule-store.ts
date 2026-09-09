export const EVERY_MINUTES_MIN = 5
export const EVERY_MINUTES_MAX = 10_080 // 7 days
export const MAX_ACTIVE_SCHEDULES = 20
export const PROMPT_MAX_LENGTH = 8_000
export const AT_MAX_FUTURE_MS = 365 * 86_400_000

export interface ScheduleRow {
	id: string
	channel: string
	chat_id: string
	prompt: string
	kind: 'at' | 'every'
	run_at: number | null
	every_minutes: number | null
	next_run_at: number
	enabled: number
	created_at: number
	last_run_at: number | null
	last_status: string | null
}

export type ScheduleCreateResult =
	| { ok: true; id: string; kind: 'at' | 'every'; next_run_at: number }
	| { ok: false; error: string }

export async function createSchedule(
	db: D1Database,
	input: { channel: string; chatId: string; prompt: string; everyMinutes?: number; runAt?: number },
	now = Date.now(),
): Promise<ScheduleCreateResult> {
	const prompt = input.prompt.trim()
	if (!prompt) return { ok: false, error: 'prompt_empty' }
	if (prompt.length > PROMPT_MAX_LENGTH) return { ok: false, error: 'prompt_too_long' }

	const hasEvery = input.everyMinutes != null
	const hasAt = input.runAt != null
	if (hasEvery === hasAt) return { ok: false, error: 'exactly_one_of_every_or_at' }

	if (hasEvery) {
		const n = input.everyMinutes as number
		if (!Number.isInteger(n) || n < EVERY_MINUTES_MIN || n > EVERY_MINUTES_MAX) {
			return { ok: false, error: 'every_minutes_out_of_range' }
		}
	} else {
		const at = input.runAt as number
		if (at <= now) return { ok: false, error: 'run_at_in_past' }
		if (at > now + AT_MAX_FUTURE_MS) return { ok: false, error: 'run_at_too_far' }
	}

	const active = await db
		.prepare('SELECT COUNT(*) AS n FROM schedules WHERE enabled = 1')
		.first<{ n: number }>()
	if ((active?.n ?? 0) >= MAX_ACTIVE_SCHEDULES) {
		return { ok: false, error: 'too_many_active_schedules' }
	}

	const id = crypto.randomUUID().slice(0, 8)
	const kind = hasEvery ? 'every' : 'at'
	const nextRunAt = hasEvery
		? now + (input.everyMinutes as number) * 60_000
		: (input.runAt as number)
	await db
		.prepare(
			`INSERT INTO schedules (id, channel, chat_id, prompt, kind, run_at, every_minutes, next_run_at, enabled, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)`,
		)
		.bind(
			id,
			input.channel,
			input.chatId,
			prompt,
			kind,
			input.runAt ?? null,
			input.everyMinutes ?? null,
			nextRunAt,
			now,
		)
		.run()
	return { ok: true, id, kind, next_run_at: nextRunAt }
}

export async function listSchedules(
	db: D1Database,
	opts: { includeDisabled?: boolean } = {},
): Promise<ScheduleRow[]> {
	const where = opts.includeDisabled ? '' : 'WHERE enabled = 1'
	const { results } = await db
		.prepare(`SELECT * FROM schedules ${where} ORDER BY next_run_at ASC LIMIT 100`)
		.all<ScheduleRow>()
	return results
}

export async function deleteSchedule(
	db: D1Database,
	id: string,
): Promise<{ ok: boolean; error?: string }> {
	const { meta } = await db.prepare('DELETE FROM schedules WHERE id = ?1').bind(id).run()
	if (meta.changes === 0) return { ok: false, error: 'not_found' }
	return { ok: true }
}

export async function dueSchedules(
	db: D1Database,
	now = Date.now(),
	limit = 25,
): Promise<ScheduleRow[]> {
	const { results } = await db
		.prepare(
			'SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?1 ORDER BY next_run_at ASC LIMIT ?2',
		)
		.bind(now, limit)
		.all<ScheduleRow>()
	return results
}

/**
 * Advance after a firing. 'every' schedules advance from their own scheduled
 * time (phase-aligned) — advancing from tick time makes the due moment race
 * the next tick's jitter and every other firing slips a full tick. Missed
 * slots are skipped (no catch-up burst); 'at' schedules disable.
 */
export async function advanceSchedule(
	db: D1Database,
	schedule: ScheduleRow,
	status: string,
	now = Date.now(),
): Promise<void> {
	if (schedule.kind === 'every') {
		const cadenceMs = (schedule.every_minutes ?? EVERY_MINUTES_MIN) * 60_000
		let next = schedule.next_run_at + cadenceMs
		while (next <= now) next += cadenceMs
		await db
			.prepare(
				'UPDATE schedules SET next_run_at = ?1, last_run_at = ?2, last_status = ?3 WHERE id = ?4',
			)
			.bind(next, now, status, schedule.id)
			.run()
	} else {
		await db
			.prepare('UPDATE schedules SET enabled = 0, last_run_at = ?1, last_status = ?2 WHERE id = ?3')
			.bind(now, status, schedule.id)
			.run()
	}
}
