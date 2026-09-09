export interface AllowlistEntry {
	channel: string
	sender_id: string
	note: string | null
	added_at: number
	added_by: string | null
	tasks_total: number
	tasks_7d: number
	last_used_at: number | null
}

const SEVEN_DAYS_MS = 7 * 86_400_000

/** True when the sender is on the channel's allowlist. */
export async function isAllowed(
	db: D1Database,
	channel: string,
	senderId: string,
): Promise<boolean> {
	const row = await db
		.prepare('SELECT 1 AS x FROM allowlist WHERE channel = ?1 AND sender_id = ?2 LIMIT 1')
		.bind(channel, senderId)
		.first<{ x: number }>()
	return row != null
}

/** Add (or refresh) a sender on a channel's allowlist. Idempotent. */
export async function addToAllowlist(
	db: D1Database,
	input: { channel: string; senderId: string; note?: string; addedBy?: string },
): Promise<{ ok: true }> {
	await db
		.prepare(
			'INSERT OR REPLACE INTO allowlist (channel, sender_id, note, added_at, added_by) VALUES (?1, ?2, ?3, ?4, ?5)',
		)
		.bind(input.channel, input.senderId, input.note ?? null, Date.now(), input.addedBy ?? null)
		.run()
	return { ok: true }
}

export async function removeFromAllowlist(
	db: D1Database,
	channel: string,
	senderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const { meta } = await db
		.prepare('DELETE FROM allowlist WHERE channel = ?1 AND sender_id = ?2')
		.bind(channel, senderId)
		.run()
	if (meta.changes === 0) return { ok: false, error: 'not_found' }
	return { ok: true }
}

/**
 * List every allowlisted sender with task-usage stats (total, last 7 days,
 * last-used timestamp) so callers can see who leans on the bot most.
 * Group tasks store the bare sender id in tasks.sender, so the join matches.
 */
export async function listAllowlist(db: D1Database, now = Date.now()): Promise<AllowlistEntry[]> {
	const { results } = await db
		.prepare(
			`SELECT a.channel, a.sender_id, a.note, a.added_at, a.added_by,
			        COUNT(t.id) AS tasks_total,
			        SUM(CASE WHEN t.created_at > ?1 THEN 1 ELSE 0 END) AS tasks_7d,
			        MAX(t.created_at) AS last_used_at
			 FROM allowlist a
			 LEFT JOIN tasks t ON t.channel = a.channel AND t.sender = a.sender_id
			 GROUP BY a.channel, a.sender_id
			 ORDER BY tasks_total DESC`,
		)
		.bind(now - SEVEN_DAYS_MS)
		.all<AllowlistEntry>()
	return results
}
