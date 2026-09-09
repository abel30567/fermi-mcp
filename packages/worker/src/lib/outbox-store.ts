export interface OutboxRow {
	id: string
	channel: string
	chat_id: string
	body: string
	status: 'pending' | 'sent'
	created_at: number
	sent_at: number | null
}

export type PendingOutbox = Pick<OutboxRow, 'id' | 'chat_id' | 'body' | 'created_at'>

const DEFAULT_LIST_LIMIT = 10
const MAX_ACK_IDS = 50
const DEFAULT_PRUNE_MS = 7 * 86_400_000

export async function enqueueOutbound(
	db: D1Database,
	input: { channel: string; chatId: string; body: string },
): Promise<{ id: string; created_at: number }> {
	const id = crypto.randomUUID()
	const createdAt = Date.now()
	await db
		.prepare(
			'INSERT INTO outbox (id, channel, chat_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
		)
		.bind(id, input.channel, input.chatId, input.body, createdAt)
		.run()
	return { id, created_at: createdAt }
}

/** Oldest-first pending messages for a channel, for the bridge to deliver. */
export async function listPendingOutbox(
	db: D1Database,
	channel: string,
	limit = DEFAULT_LIST_LIMIT,
): Promise<PendingOutbox[]> {
	const clamped = Math.min(Math.max(limit, 1), 50)
	const { results } = await db
		.prepare(
			`SELECT id, chat_id, body, created_at FROM outbox
			 WHERE channel = ?1 AND status = 'pending'
			 ORDER BY created_at ASC LIMIT ?2`,
		)
		.bind(channel, clamped)
		.all<PendingOutbox>()
	return results
}

/** Mark delivered messages as sent. Only flips pending rows. */
export async function ackOutbox(db: D1Database, ids: string[]): Promise<{ acked: number }> {
	if (ids.length === 0) return { acked: 0 }
	const capped = ids.slice(0, MAX_ACK_IDS)
	const placeholders = capped.map((_, i) => `?${i + 2}`).join(', ')
	const { meta } = await db
		.prepare(
			`UPDATE outbox SET status = 'sent', sent_at = ?1
			 WHERE status = 'pending' AND id IN (${placeholders})`,
		)
		.bind(Date.now(), ...capped)
		.run()
	return { acked: meta.changes }
}

/** Drop sent messages older than the retention window. */
export async function pruneSentOutbox(
	db: D1Database,
	olderThanMs = DEFAULT_PRUNE_MS,
): Promise<void> {
	await db
		.prepare("DELETE FROM outbox WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?1")
		.bind(Date.now() - olderThanMs)
		.run()
}
