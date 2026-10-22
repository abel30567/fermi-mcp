import { createSession, logMessage } from './session.ts'

export function channelHost(channel: string, chatId: string): string {
	return `${channel}:${chatId}`
}

/** Newest open session for this chat, creating one if none exists. */
export async function getOrCreateChannelSession(
	db: D1Database,
	channel: string,
	chatId: string,
): Promise<string> {
	const host = channelHost(channel, chatId)
	const row = await db
		.prepare(
			'SELECT id FROM sessions WHERE host = ?1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
		)
		.bind(host)
		.first<{ id: string }>()
	if (row) return row.id
	return createSession(db, host)
}

export async function logChannelMessage(
	db: D1Database,
	channel: string,
	chatId: string,
	role: 'user' | 'assistant',
	body: string,
): Promise<void> {
	const sessionId = await getOrCreateChannelSession(db, channel, chatId)
	await logMessage(db, sessionId, role, body)
}

export interface ConversationRow {
	role: string
	body: string
	created_at: number
}

export interface ConversationHistory {
	messages: ConversationRow[]
	prior_summary: string | null
	/** created_at of the oldest message returned; pass as `before` to page back. */
	oldest_at: number | null
	/** True when older messages exist for this chat beyond the returned window. */
	has_more: boolean
}

/**
 * Recent transcript for a chat, chronological. Joins on sessions.host so
 * messages survive session resets and duplicate sessions are merged.
 * `before` (ms epoch) pages back: only messages older than it are returned.
 * prior_summary carries the newest closed session's distilled summary.
 */
export async function getConversationHistory(
	db: D1Database,
	channel: string,
	chatId: string,
	limit = 20,
	before?: number,
): Promise<ConversationHistory> {
	const host = channelHost(channel, chatId)
	const clamped = Math.min(Math.max(limit, 1), 50)
	const cursor = before ?? Number.MAX_SAFE_INTEGER
	// Fetch one extra row to learn whether the window is truncated.
	const { results } = await db
		.prepare(
			`SELECT m.role, m.body, m.created_at
			 FROM messages m
			 JOIN sessions s ON m.session_id = s.id
			 WHERE s.host = ?1 AND m.created_at < ?2
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT ?3`,
		)
		.bind(host, cursor, clamped + 1)
		.all<ConversationRow>()
	const has_more = results.length > clamped
	const page = results.slice(0, clamped).reverse()

	const prior = await db
		.prepare(
			`SELECT summary FROM sessions
			 WHERE host = ?1 AND ended_at IS NOT NULL AND summary IS NOT NULL
			 ORDER BY ended_at DESC LIMIT 1`,
		)
		.bind(host)
		.first<{ summary: string }>()

	return {
		messages: page,
		prior_summary: prior?.summary ?? null,
		oldest_at: page[0]?.created_at ?? null,
		has_more,
	}
}
