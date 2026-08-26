export async function hashArgs(args: unknown): Promise<string> {
	const data = new TextEncoder().encode(JSON.stringify(args))
	const digest = await crypto.subtle.digest('SHA-256', data)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function writeAudit(
	db: D1Database,
	entry: {
		tool: string
		args_hash: string
		outcome: 'ok' | 'denied' | 'pending'
		risk: string
		approved_by?: string
		duration_ms?: number
		result_bytes?: number
		session_id?: string
	},
): Promise<void> {
	await db
		.prepare(
			'INSERT INTO audit (ts, tool, args_hash, outcome, risk, approved_by, duration_ms, result_bytes, session_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
		)
		.bind(
			Date.now(),
			entry.tool,
			entry.args_hash,
			entry.outcome,
			entry.risk,
			entry.approved_by ?? null,
			entry.duration_ms ?? null,
			entry.result_bytes ?? null,
			entry.session_id ?? null,
		)
		.run()
}

/** Byte size of the JSON-serialized tool result, for token estimation. */
export function measureResultBytes(value: unknown): number | undefined {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).length
	} catch {
		return undefined
	}
}
