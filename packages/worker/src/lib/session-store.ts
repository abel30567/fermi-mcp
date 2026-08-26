export interface MessageRow {
	id: number
	session_id: string
	role: string
	body: string
	created_at: number
}

export async function searchMessages(
	query: string,
	limit: number,
	env: Env,
): Promise<MessageRow[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT m.id, m.session_id, m.role, m.body, m.created_at
		   FROM messages_fts f JOIN messages m ON f.rowid = m.id
		  WHERE messages_fts MATCH ?1 ORDER BY rank LIMIT ?2`,
	)
		.bind(query, limit)
		.all<MessageRow>()
	return results
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
