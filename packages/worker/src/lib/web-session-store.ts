import { decryptSecret, encryptSecret } from './crypto.ts'

export interface WebSessionMeta {
	name: string
	site: string
	max_concurrent: number
	allowed_boxes: string[]
	created_at: number
	updated_at: number
	expires_at: number | null
	revoked_at: number | null
	active_leases?: number
}

export async function captureWebSession(
	env: Env,
	input: {
		name: string
		site: string
		storageState: string
		maxConcurrent?: number
		allowedBoxes?: string[]
		ttlSeconds?: number
	},
): Promise<WebSessionMeta> {
	const { encrypted, iv } = await encryptSecret(input.storageState, env)
	const now = Date.now()
	const expiresAt = input.ttlSeconds ? now + input.ttlSeconds * 1000 : null
	await env.FERMI_DB.prepare(
		`INSERT INTO web_sessions (name, site, encrypted_state, iv, max_concurrent, allowed_boxes, created_at, updated_at, expires_at, revoked_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, NULL)
		 ON CONFLICT(name) DO UPDATE SET
		   site = excluded.site, encrypted_state = excluded.encrypted_state, iv = excluded.iv,
		   max_concurrent = excluded.max_concurrent, allowed_boxes = excluded.allowed_boxes,
		   updated_at = excluded.updated_at, expires_at = excluded.expires_at, revoked_at = NULL`,
	)
		.bind(
			input.name,
			input.site,
			encrypted,
			iv,
			input.maxConcurrent ?? 1,
			JSON.stringify(input.allowedBoxes ?? []),
			now,
			expiresAt,
		)
		.run()
	return (await getWebSessionMeta(env, input.name)) as WebSessionMeta
}

function rowToMeta(row: Record<string, unknown>): WebSessionMeta {
	return {
		name: row.name as string,
		site: row.site as string,
		max_concurrent: row.max_concurrent as number,
		allowed_boxes: JSON.parse((row.allowed_boxes as string) || '[]'),
		created_at: row.created_at as number,
		updated_at: row.updated_at as number,
		expires_at: (row.expires_at as number) ?? null,
		revoked_at: (row.revoked_at as number) ?? null,
	}
}

export async function getWebSessionMeta(env: Env, name: string): Promise<WebSessionMeta | null> {
	const row = await env.FERMI_DB.prepare(
		'SELECT name, site, max_concurrent, allowed_boxes, created_at, updated_at, expires_at, revoked_at FROM web_sessions WHERE name = ?1',
	)
		.bind(name)
		.first<Record<string, unknown>>()
	if (!row) return null
	const meta = rowToMeta(row)
	meta.active_leases = await countActiveLeases(env, name)
	return meta
}

/**
 * Decrypt-only state fetch for the TRUSTED broker executor (the Mac, behind
 * the admin bearer). Never exposed on any box-authenticated surface (#32) —
 * boxes drive sessions via /box/browser-rpc and never see cookies.
 */
export async function getWebSessionState(
	env: Env,
	name: string,
): Promise<{ ok: true; site: string; storage_state: string } | { ok: false; error: string }> {
	const row = await env.FERMI_DB.prepare('SELECT * FROM web_sessions WHERE name = ?1')
		.bind(name)
		.first<Record<string, unknown>>()
	if (!row) return { ok: false, error: 'not_found' }
	if (row.revoked_at) return { ok: false, error: 'revoked' }
	if (row.expires_at && (row.expires_at as number) < Date.now())
		return { ok: false, error: 'expired' }
	const state = await decryptSecret(
		{ encrypted_value: row.encrypted_state as ArrayBuffer, iv: row.iv as ArrayBuffer },
		env,
	)
	return { ok: true, site: row.site as string, storage_state: state }
}

export async function listWebSessions(env: Env): Promise<WebSessionMeta[]> {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT name, site, max_concurrent, allowed_boxes, created_at, updated_at, expires_at, revoked_at FROM web_sessions ORDER BY created_at DESC',
	).all<Record<string, unknown>>()
	const metas: WebSessionMeta[] = []
	for (const row of results) {
		const meta = rowToMeta(row)
		meta.active_leases = await countActiveLeases(env, meta.name)
		metas.push(meta)
	}
	return metas
}

export async function countActiveLeases(env: Env, name: string): Promise<number> {
	const row = await env.FERMI_DB.prepare(
		'SELECT COUNT(*) n FROM web_session_leases WHERE session_name = ?1 AND released_at IS NULL AND expires_at > ?2',
	)
		.bind(name, Date.now())
		.first<{ n: number }>()
	return row?.n ?? 0
}

export async function invalidateWebSession(env: Env, name: string): Promise<{ ok: boolean }> {
	const now = Date.now()
	const { meta } = await env.FERMI_DB.prepare(
		'UPDATE web_sessions SET revoked_at = ?1, updated_at = ?1 WHERE name = ?2 AND revoked_at IS NULL',
	)
		.bind(now, name)
		.run()
	// Cascade: release every active lease so boxes lose access immediately.
	await env.FERMI_DB.prepare(
		'UPDATE web_session_leases SET released_at = ?1 WHERE session_name = ?2 AND released_at IS NULL',
	)
		.bind(now, name)
		.run()
	return { ok: meta.changes > 0 }
}

export interface LeaseResult {
	ok: boolean
	error?: string
	lease_id?: string
	storage_state?: string
	site?: string
	expires_at?: number
}

/**
 * Lease a session to a box: enforces revoked/expired, allowed_boxes, and the
 * max_concurrent cap, then hands back the decrypted storageState. A box holding
 * a live lease can re-lease idempotently (returns the same lease).
 */
export async function leaseWebSession(
	env: Env,
	name: string,
	boxId: string,
	leaseSeconds = 3600,
): Promise<LeaseResult> {
	const now = Date.now()
	const row = await env.FERMI_DB.prepare('SELECT * FROM web_sessions WHERE name = ?1')
		.bind(name)
		.first<Record<string, unknown>>()
	if (!row) return { ok: false, error: 'not_found' }
	if (row.revoked_at) return { ok: false, error: 'revoked' }
	if (row.expires_at && (row.expires_at as number) < now) return { ok: false, error: 'expired' }
	const allowed: string[] = JSON.parse((row.allowed_boxes as string) || '[]')
	if (allowed.length > 0 && !allowed.includes(boxId)) return { ok: false, error: 'box_not_allowed' }

	// Reuse an existing live lease for this box (idempotent re-lease).
	const existing = await env.FERMI_DB.prepare(
		'SELECT id, expires_at FROM web_session_leases WHERE session_name = ?1 AND box_id = ?2 AND released_at IS NULL AND expires_at > ?3 LIMIT 1',
	)
		.bind(name, boxId, now)
		.first<{ id: string; expires_at: number }>()
	if (!existing) {
		const active = await countActiveLeases(env, name)
		if (active >= (row.max_concurrent as number)) {
			return { ok: false, error: 'concurrency_cap_reached', active_leases: active } as LeaseResult
		}
	}

	const leaseId = existing?.id ?? `lease_${crypto.randomUUID()}`
	const expiresAt = existing?.expires_at ?? now + leaseSeconds * 1000
	if (!existing) {
		// Atomic guarded insert: the row is created only if the live-lease count is
		// still below the cap, evaluated inside the same statement. No insert-then-
		// recheck race. meta.changes === 0 means the cap was full.
		const ins = await env.FERMI_DB.prepare(
			`INSERT INTO web_session_leases (id, session_name, box_id, leased_at, expires_at)
			 SELECT ?1, ?2, ?3, ?4, ?5
			 WHERE (
			   SELECT COUNT(*) FROM web_session_leases
			    WHERE session_name = ?2 AND released_at IS NULL AND expires_at > ?4
			 ) < ?6`,
		)
			.bind(leaseId, name, boxId, now, expiresAt, row.max_concurrent as number)
			.run()
		if (ins.meta.changes === 0) {
			return { ok: false, error: 'concurrency_cap_reached' } as LeaseResult
		}
	}

	const state = await decryptSecret(
		{ encrypted_value: row.encrypted_state as ArrayBuffer, iv: row.iv as ArrayBuffer },
		env,
	)
	return {
		ok: true,
		lease_id: leaseId,
		storage_state: state,
		site: row.site as string,
		expires_at: expiresAt,
	}
}

export async function releaseWebSession(env: Env, leaseId: string): Promise<{ ok: boolean }> {
	const { meta } = await env.FERMI_DB.prepare(
		'UPDATE web_session_leases SET released_at = ?1 WHERE id = ?2 AND released_at IS NULL',
	)
		.bind(Date.now(), leaseId)
		.run()
	return { ok: meta.changes > 0 }
}
