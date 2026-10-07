export interface MessageRow {
	id: number
	session_id: string
	role: string
	body: string
	created_at: number
}

export interface MessageHit extends MessageRow {
	/** sessions.host, e.g. "wa:1234@g.us" for a channel chat. */
	host: string
	channel: string | null
	chat_id: string | null
}

const CHANNEL_HOST_RE = /^(tg|wa|dc|sl):(.+)$/

/** Split a channel host ("wa:123@g.us") into its channel and chat id. */
export function parseChannelHost(host: string): { channel: string | null; chat_id: string | null } {
	const m = CHANNEL_HOST_RE.exec(host)
	return m ? { channel: m[1], chat_id: m[2] } : { channel: null, chat_id: null }
}

/**
 * FTS5 search over all session messages, optionally restricted to one
 * channel chat (all of its sessions). Hits carry the session host so the
 * caller can tell which chat said what.
 */
export async function searchMessages(
	query: string,
	limit: number,
	env: Env,
	filter?: { channel: string; chatId: string },
): Promise<MessageHit[]> {
	const binds: unknown[] = [query, limit]
	let where = 'messages_fts MATCH ?1'
	if (filter) {
		binds.push(`${filter.channel}:${filter.chatId}`)
		where += ` AND s.host = ?${binds.length}`
	}
	const { results } = await env.FERMI_DB.prepare(
		`SELECT m.id, m.session_id, m.role, m.body, m.created_at, s.host
		   FROM messages_fts f
		   JOIN messages m ON f.rowid = m.id
		   JOIN sessions s ON s.id = m.session_id
		  WHERE ${where} ORDER BY rank LIMIT ?2`,
	)
		.bind(...binds)
		.all<MessageRow & { host: string }>()
	return results.map((row) => ({ ...row, ...parseChannelHost(row.host) }))
}

export async function setSessionMode(
	sessionId: string,
	mode: 'chat' | 'plan' | 'execute',
	env: Env,
): Promise<void> {
	await env.FERMI_DB.prepare('UPDATE sessions SET mode = ?1 WHERE id = ?2')
		.bind(mode, sessionId)
		.run()
}
