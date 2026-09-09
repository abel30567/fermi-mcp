export interface TaskRow {
	id: string
	channel: string
	sender: string
	chat_id: string
	payload: string
	status: 'pending' | 'claimed' | 'done' | 'failed'
	result: string | null
	created_at: number
	claimed_at: number | null
	completed_at: number | null
	queue: string
	claimed_by: string | null
	lease_expires_at: number | null
	parent_task_id: string | null
}

export type ClaimedTask = Pick<
	TaskRow,
	'id' | 'channel' | 'sender' | 'chat_id' | 'payload' | 'created_at' | 'queue'
>

const DEFAULT_CLAIM_LIMIT = 3
const DEFAULT_STALE_MS = 15 * 60_000
export const DEFAULT_QUEUE = 'main'

export async function enqueueTask(
	db: D1Database,
	input: {
		channel: string
		sender: string
		chatId: string
		payload: string
		queue?: string
		parentTaskId?: string
	},
): Promise<{ id: string; created_at: number }> {
	const id = crypto.randomUUID()
	const createdAt = Date.now()
	await db
		.prepare(
			'INSERT INTO tasks (id, channel, sender, chat_id, payload, created_at, queue, parent_task_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
		)
		.bind(
			id,
			input.channel,
			input.sender,
			input.chatId,
			input.payload,
			createdAt,
			input.queue ?? DEFAULT_QUEUE,
			input.parentTaskId ?? null,
		)
		.run()
	return { id, created_at: createdAt }
}

/**
 * Atomically claim the oldest pending tasks (FIFO) from one queue. Claims take
 * a lease (lease_expires_at); expired leases are reclaimed. Legacy claimed rows
 * without a lease fall back to the claimed_at + staleMs window.
 */
export async function claimTasks(
	db: D1Database,
	opts: {
		limit?: number
		staleMs?: number
		queue?: string
		claimedBy?: string
		leaseMs?: number
	} = {},
): Promise<ClaimedTask[]> {
	const limit = Math.min(Math.max(opts.limit ?? DEFAULT_CLAIM_LIMIT, 1), 10)
	const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
	const leaseMs = opts.leaseMs ?? staleMs
	const queue = opts.queue ?? DEFAULT_QUEUE
	const now = Date.now()
	const { results } = await db
		.prepare(
			`UPDATE tasks SET status = 'claimed', claimed_at = ?1, claimed_by = ?2, lease_expires_at = ?3
			 WHERE id IN (
			   SELECT id FROM tasks
			    WHERE queue = ?4 AND (
			      status = 'pending'
			      OR (status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?1)
			      OR (status = 'claimed' AND lease_expires_at IS NULL AND claimed_at < ?5)
			    )
			    ORDER BY created_at ASC LIMIT ?6
			 )
			 RETURNING id, channel, sender, chat_id, payload, created_at, queue`,
		)
		.bind(now, opts.claimedBy ?? null, now + leaseMs, queue, now - staleMs, limit)
		.all<ClaimedTask>()
	return results
}

/**
 * Complete a claimed task. When claimedBy is given, only the current lease
 * holder may complete it (a box cannot finish another box's task).
 */
export async function completeTask(
	db: D1Database,
	id: string,
	opts: { status?: 'done' | 'failed'; result?: string; claimedBy?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
	const { meta } = await db
		.prepare(
			`UPDATE tasks SET status = ?1, result = ?2, completed_at = ?3
			 WHERE id = ?4 AND status = 'claimed' AND (?5 IS NULL OR claimed_by = ?5)`,
		)
		.bind(opts.status ?? 'done', opts.result ?? null, Date.now(), id, opts.claimedBy ?? null)
		.run()
	if (meta.changes === 0) return { ok: false, error: 'not_found_or_not_claimed' }
	return { ok: true }
}

export async function hasOpenTaskFromSender(db: D1Database, sender: string): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 AS x FROM tasks WHERE sender = ?1 AND status = 'pending' LIMIT 1")
		.bind(sender)
		.first<{ x: number }>()
	return row != null
}

export async function countPendingTasks(db: D1Database, queue?: string): Promise<number> {
	if (queue) {
		const row = await db
			.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'pending' AND queue = ?1")
			.bind(queue)
			.first<{ n: number }>()
		return row?.n ?? 0
	}
	// Unscoped count is the CHANNEL drain's signal (/admin/tasks/pending → the
	// Mac warm worker). Fleet queues (agent:<id> work tasks, broker:ops) are
	// drained by boxes and the broker executor, NOT the channel drain — counting
	// them here woke the drain, which then claimed cloud-agent tasks out from
	// under their boxes (2026-09-08). Exclude them.
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM tasks WHERE status = 'pending' AND queue NOT LIKE 'agent:%' AND queue NOT LIKE 'broker:%'",
		)
		.first<{ n: number }>()
	return row?.n ?? 0
}

/** Queues owned by the cloud fleet / broker — off-limits to the channel drain. */
export function isFleetQueue(queue?: string): boolean {
	return !!queue && (queue.startsWith('agent:') || queue.startsWith('broker:'))
}

export async function listTasks(
	db: D1Database,
	opts: { status?: TaskRow['status']; limit?: number; queue?: string } = {},
): Promise<TaskRow[]> {
	const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
	const where: string[] = []
	const binds: unknown[] = []
	if (opts.status) {
		binds.push(opts.status)
		where.push(`status = ?${binds.length}`)
	}
	if (opts.queue) {
		binds.push(opts.queue)
		where.push(`queue = ?${binds.length}`)
	}
	binds.push(limit)
	const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?${binds.length}`
	const { results } = await db
		.prepare(sql)
		.bind(...binds)
		.all<TaskRow>()
	return results
}

/**
 * Poll a task until it reaches a terminal status or the timeout elapses.
 * Lets an orchestrator await a completion instead of reconciling out-of-band.
 */
export async function waitForTask(
	db: D1Database,
	id: string,
	opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ status: 'done' | 'failed' | 'timeout' | 'not_found'; result?: string | null }> {
	const timeoutMs = opts.timeoutMs ?? 30_000
	const pollMs = Math.max(opts.pollMs ?? 2_000, 100)
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const row = await db
			.prepare('SELECT status, result FROM tasks WHERE id = ?1')
			.bind(id)
			.first<{ status: TaskRow['status']; result: string | null }>()
		if (!row) return { status: 'not_found' }
		if (row.status === 'done' || row.status === 'failed') {
			return { status: row.status, result: row.result }
		}
		if (Date.now() + pollMs > deadline) return { status: 'timeout' }
		await new Promise((resolve) => setTimeout(resolve, pollMs))
	}
}

/** Fan-out aggregation: all child tasks of a parent, oldest first. */
export async function listTasksByParent(db: D1Database, parentTaskId: string): Promise<TaskRow[]> {
	const { results } = await db
		.prepare('SELECT * FROM tasks WHERE parent_task_id = ?1 ORDER BY created_at ASC')
		.bind(parentTaskId)
		.all<TaskRow>()
	return results
}
