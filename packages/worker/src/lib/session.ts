export async function createSession(db: D1Database, host: string): Promise<string> {
	const id = crypto.randomUUID()
	await db
		.prepare('INSERT INTO sessions (id, host, mode, started_at) VALUES (?, ?, ?, ?)')
		.bind(id, host, 'chat', Date.now())
		.run()
	return id
}

export async function endSession(db: D1Database, sessionId: string): Promise<void> {
	await db
		.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?')
		.bind(Date.now(), sessionId)
		.run()
}

export async function logMessage(
	db: D1Database,
	sessionId: string,
	role: string,
	body: string,
): Promise<void> {
	await db
		.prepare('INSERT INTO messages (session_id, role, body, created_at) VALUES (?, ?, ?, ?)')
		.bind(sessionId, role, body, Date.now())
		.run()
}
