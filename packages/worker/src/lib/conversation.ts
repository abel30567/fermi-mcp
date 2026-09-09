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
}

/**
 * Recent transcript for a chat, chronological. Joins on sessions.host so
 * messages survive session resets and duplicate sessions are merged.
 * prior_summary carries the newest closed session's distilled summary.
 */
export async function getConversationHistory(
	db: D1Database,
	channel: string,
	chatId: string,
	limit = 20,
): Promise<ConversationHistory> {
	const host = channelHost(channel, chatId)
	const clamped = Math.min(Math.max(limit, 1), 50)
	const { results } = await db
		.prepare(
			`SELECT m.role, m.body, m.created_at
			 FROM messages m
			 JOIN sessions s ON m.session_id = s.id
			 WHERE s.host = ?1
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT ?2`,
		)
		.bind(host, clamped)
		.all<ConversationRow>()

	const prior = await db
		.prepare(
			`SELECT summary FROM sessions
			 WHERE host = ?1 AND ended_at IS NOT NULL AND summary IS NOT NULL
			 ORDER BY ended_at DESC LIMIT 1`,
		)
		.bind(host)
		.first<{ summary: string }>()

	return { messages: results.reverse(), prior_summary: prior?.summary ?? null }
}
