import type { OutboundMedia } from '../channels/media.ts'

export interface OutboxRow {
	id: string
	channel: string
	chat_id: string
	body: string
	media: string | null
	status: 'pending' | 'sent'
	created_at: number
	sent_at: number | null
}

export interface PendingOutbox {
	id: string
	chat_id: string
	body: string
	created_at: number
	/** Attachment to send with (or instead of) the body; null for plain text. */
	media: OutboundMedia | null
}

const DEFAULT_LIST_LIMIT = 10
const MAX_ACK_IDS = 50
const DEFAULT_PRUNE_MS = 7 * 86_400_000

export async function enqueueOutbound(
	db: D1Database,
	input: { channel: string; chatId: string; body: string; media?: OutboundMedia },
): Promise<{ id: string; created_at: number }> {
	const id = crypto.randomUUID()
	const createdAt = Date.now()
	await db
		.prepare(
			'INSERT INTO outbox (id, channel, chat_id, body, media, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
		)
		.bind(
			id,
			input.channel,
			input.chatId,
			input.body,
			input.media ? JSON.stringify(input.media) : null,
			createdAt,
		)
		.run()
	return { id, created_at: createdAt }
}

function parseMedia(raw: string | null): OutboundMedia | null {
	if (!raw) return null
	try {
		return JSON.parse(raw) as OutboundMedia
	} catch {
		return null
	}
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
			`SELECT id, chat_id, body, media, created_at FROM outbox
			 WHERE channel = ?1 AND status = 'pending'
			 ORDER BY created_at ASC LIMIT ?2`,
		)
		.bind(channel, clamped)
		.all<Omit<PendingOutbox, 'media'> & { media: string | null }>()
	return results.map((row) => ({ ...row, media: parseMedia(row.media) }))
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
