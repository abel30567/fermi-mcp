export interface BrowserSessionRow {
	id: string
	label: string | null
	live_view_url: string | null
	status: 'active' | 'waiting_for_human' | 'closed'
	created_at: number
	last_activity: number
	closed_at: number | null
}

export async function listBrowserSessions(env: Env): Promise<BrowserSessionRow[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT id, label, live_view_url, status, created_at, last_activity, closed_at
		 FROM browser_sessions WHERE status != 'closed' ORDER BY created_at DESC`,
	).all<BrowserSessionRow>()
	return results
}

export async function upsertBrowserSession(row: BrowserSessionRow, env: Env): Promise<void> {
	await env.FERMI_DB.prepare(
		`INSERT OR REPLACE INTO browser_sessions
		 (id, label, live_view_url, status, created_at, last_activity, closed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			row.id,
			row.label ?? null,
			row.live_view_url ?? null,
			row.status,
			row.created_at,
			row.last_activity,
			row.closed_at ?? null,
		)
		.run()
}

export async function updateBrowserSessionStatus(
	id: string,
	status: BrowserSessionRow['status'],
	env: Env,
): Promise<void> {
	const now = Date.now()
	const closedAt = status === 'closed' ? now : null
	await env.FERMI_DB.prepare(
		'UPDATE browser_sessions SET status = ?, last_activity = ?, closed_at = ? WHERE id = ?',
	)
		.bind(status, now, closedAt, id)
		.run()
}

export async function deleteBrowserSession(id: string, env: Env): Promise<void> {
	await env.FERMI_DB.prepare('DELETE FROM browser_sessions WHERE id = ?').bind(id).run()
}
