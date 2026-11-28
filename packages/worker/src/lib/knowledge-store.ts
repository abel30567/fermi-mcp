// Knowledge principal (ISSUE-88): long-lived tokens bound to one namespace, and
// the namespaced memory/skill stores their sessions read and write. Namespaced
// rows live in knowledge_memory / knowledge_skills, never in memory / skills,
// so owner and box readers cannot reach them.
import { sha256Hex } from '../channels/box-gateway.ts'
import type { FermiMCP } from '../mcp/index.ts'
import { timingSafeEqual } from './crypto.ts'
import type { MemoryKind, MemoryRow, RecallSort } from './memory-store.ts'
import { type LoadedSkill, type SkillMeta, normalizeSkillDocument } from './skills-store.ts'

export const NAMESPACE_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/

export interface KnowledgeToken {
	token_id: string
	namespace: string
	label: string
	created_at: number
	expires_at: number | null
	revoked_at: number | null
}

const TOKEN_COLUMNS = 'token_id, namespace, label, created_at, expires_at, revoked_at'

function randomHex(bytes: number): string {
	return [...crypto.getRandomValues(new Uint8Array(bytes))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

export async function mintKnowledgeToken(
	db: D1Database,
	input: { namespace: string; label: string; expires_at?: number | null },
): Promise<KnowledgeToken & { token: string }> {
	const tokenId = `kt_${randomHex(8)}`
	const secret = randomHex(32)
	const row: KnowledgeToken = {
		token_id: tokenId,
		namespace: input.namespace,
		label: input.label,
		created_at: Date.now(),
		expires_at: input.expires_at ?? null,
		revoked_at: null,
	}
	await db
		.prepare(
			'INSERT INTO knowledge_tokens (token_id, secret_hash, namespace, label, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
		)
		.bind(
			tokenId,
			await sha256Hex(secret),
			row.namespace,
			row.label,
			row.created_at,
			row.expires_at,
		)
		.run()
	return { ...row, token: `${tokenId}.${secret}` }
}

export async function listKnowledgeTokens(db: D1Database): Promise<KnowledgeToken[]> {
	const { results } = await db
		.prepare(`SELECT ${TOKEN_COLUMNS} FROM knowledge_tokens ORDER BY created_at DESC`)
		.all<KnowledgeToken>()
	return results
}

/** Revoke a token; null when no such token exists. */
export async function revokeKnowledgeToken(
	db: D1Database,
	tokenId: string,
): Promise<{ revoked: boolean } | null> {
	const res = await db
		.prepare(
			'UPDATE knowledge_tokens SET revoked_at = ?1 WHERE token_id = ?2 AND revoked_at IS NULL',
		)
		.bind(Date.now(), tokenId)
		.run()
	if ((res.meta.changes ?? 0) > 0) return { revoked: true }
	const exists = await db
		.prepare('SELECT 1 AS n FROM knowledge_tokens WHERE token_id = ?1')
		.bind(tokenId)
		.first()
	return exists ? { revoked: false } : null
}

/** The live (not revoked, not expired) token for `Authorization: Bearer <token_id>.<secret>`. */
export async function authKnowledge(request: Request, env: Env): Promise<KnowledgeToken | null> {
	const auth = request.headers.get('authorization') ?? ''
	if (!auth.startsWith('Bearer ')) return null
	const token = auth.slice(7)
	const dot = token.indexOf('.')
	if (dot <= 0 || dot === token.length - 1) return null
	const row = await env.FERMI_DB.prepare(
		`SELECT ${TOKEN_COLUMNS}, secret_hash FROM knowledge_tokens WHERE token_id = ?1`,
	)
		.bind(token.slice(0, dot))
		.first<KnowledgeToken & { secret_hash: string }>()
	if (!row || row.revoked_at !== null) return null
	if (row.expires_at !== null && row.expires_at <= Date.now()) return null
	if (!timingSafeEqual(row.secret_hash, await sha256Hex(token.slice(dot + 1)))) return null
	const { secret_hash: _, ...rest } = row
	return rest
}

/**
 * True when the request opens a new session, or names a session that was opened
 * for `host` (`k:<token_id>`). The session's Durable Object keeps the props it
 * was opened with, so a session id of another token or principal is refused.
 */
export async function knowledgeSessionMatches(
	request: Request,
	env: Env,
	host: string,
): Promise<boolean> {
	const sessionId = request.headers.get('mcp-session-id')
	if (!sessionId) return true
	const ns = env.MCP_OBJECT as unknown as DurableObjectNamespace<FermiMCP>
	const stub = ns.get(ns.idFromName(`streamable-http:${sessionId}`))
	return (await stub.sessionHost()) === host
}

function badRequest(error: string): Response {
	return Response.json({ ok: false, error }, { status: 400 })
}

/** /admin/knowledge/* — the caller has already presented FERMI_BEARER_TOKEN. */
export async function handleKnowledgeAdmin(
	request: Request,
	env: Env,
	path: string,
): Promise<Response> {
	if (path === '/admin/knowledge/tokens' && request.method === 'GET') {
		return Response.json({ ok: true, tokens: await listKnowledgeTokens(env.FERMI_DB) })
	}
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
	if (path === '/admin/knowledge/tokens' && request.method === 'POST') {
		const { namespace, label, expires_at } = body ?? {}
		if (typeof namespace !== 'string' || !NAMESPACE_RE.test(namespace))
			return badRequest('namespace must match [a-z0-9][a-z0-9._/-]{0,63}')
		if (typeof label !== 'string' || !label.trim() || label.length > 200)
			return badRequest('label must be a non-empty string of at most 200 characters')
		if (expires_at != null && !(Number.isSafeInteger(expires_at) && (expires_at as number) > 0))
			return badRequest('expires_at must be an epoch-milliseconds integer')
		const minted = await mintKnowledgeToken(env.FERMI_DB, {
			namespace,
			label,
			expires_at: (expires_at as number | null | undefined) ?? null,
		})
		return Response.json({ ok: true, ...minted })
	}
	if (path === '/admin/knowledge/revoke' && request.method === 'POST') {
		if (typeof body?.token_id !== 'string') return badRequest('token_id required')
		const res = await revokeKnowledgeToken(env.FERMI_DB, body.token_id)
		if (!res) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
		return Response.json({ ok: true, token_id: body.token_id, ...res })
	}
	return new Response('Method Not Allowed', { status: 405 })
}

// ---- memory ----

export async function recallKnowledgeMemories(
	namespace: string,
	query: string,
	limit: number,
	env: Env,
	sortBy: RecallSort = 'relevance',
): Promise<MemoryRow[]> {
	const orderBy = sortBy === 'created_at' ? 'created_at DESC' : 'pinned DESC, created_at DESC'
	const { results } = await env.FERMI_DB.prepare(
		`SELECT id, kind, body, pinned, created_at
		   FROM knowledge_memory
		  WHERE namespace = ?1 AND body LIKE '%' || ?2 || '%'
		  ORDER BY ${orderBy}
		  LIMIT ?3`,
	)
		.bind(namespace, query, limit)
		.all<MemoryRow>()
	return results
}

export async function getKnowledgeMemory(
	namespace: string,
	id: number,
	env: Env,
): Promise<MemoryRow | null> {
	return env.FERMI_DB.prepare(
		'SELECT id, kind, body, pinned, created_at FROM knowledge_memory WHERE namespace = ?1 AND id = ?2',
	)
		.bind(namespace, id)
		.first<MemoryRow>()
}

export async function writeKnowledgeMemory(
	namespace: string,
	input: { kind: MemoryKind; body: string; pinned?: boolean },
	env: Env,
) {
	const now = Date.now()
	const res = await env.FERMI_DB.prepare(
		'INSERT INTO knowledge_memory (namespace, kind, body, pinned, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
	)
		.bind(namespace, input.kind, input.body, input.pinned ? 1 : 0, now)
		.run()
	return {
		id: res.meta.last_row_id as number,
		kind: input.kind,
		body: input.body,
		pinned: !!input.pinned,
		created_at: now,
	}
}

// ---- skills ----

interface KnowledgeSkillRow extends Omit<SkillMeta, 'keywords' | 'allowed_tools'> {
	keywords: string
	allowed_tools: string
}

const SKILL_COLUMNS = `slug, name, description, keywords, allowed_tools, version, source,
	origin_memory_id, usage_count, last_used_at, created_at, updated_at`

function parseList(value: string): string[] {
	try {
		const parsed = JSON.parse(value)
		if (Array.isArray(parsed)) return parsed.map(String)
	} catch {
		// malformed column value - treat as empty
	}
	return []
}

function toMeta(row: KnowledgeSkillRow): SkillMeta {
	return { ...row, keywords: parseList(row.keywords), allowed_tools: parseList(row.allowed_tools) }
}

export async function searchKnowledgeSkills(
	namespace: string,
	query: string,
	limit: number,
	env: Env,
): Promise<(SkillMeta & { score: number })[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT ${SKILL_COLUMNS} FROM knowledge_skills
		  WHERE namespace = ?1
		    AND (name LIKE '%' || ?2 || '%'
		         OR description LIKE '%' || ?2 || '%'
		         OR keywords LIKE '%' || ?2 || '%')
		  ORDER BY usage_count DESC, updated_at DESC
		  LIMIT ?3`,
	)
		.bind(namespace, query, limit)
		.all<KnowledgeSkillRow>()
	const q = query.toLowerCase()
	return results.map((row) => ({
		...toMeta(row),
		score: row.name.toLowerCase().includes(q) ? 1 : 0.7,
	}))
}

export async function getKnowledgeSkill(
	namespace: string,
	slug: string,
	env: Env,
): Promise<SkillMeta | null> {
	const row = await env.FERMI_DB.prepare(
		`SELECT ${SKILL_COLUMNS} FROM knowledge_skills WHERE namespace = ?1 AND slug = ?2`,
	)
		.bind(namespace, slug)
		.first<KnowledgeSkillRow>()
	return row ? toMeta(row) : null
}

export async function loadKnowledgeSkill(
	namespace: string,
	slug: string,
	env: Env,
): Promise<LoadedSkill | null> {
	const now = Date.now()
	const row = await env.FERMI_DB.prepare(
		`UPDATE knowledge_skills SET usage_count = usage_count + 1, last_used_at = ?3
		  WHERE namespace = ?1 AND slug = ?2
		  RETURNING ${SKILL_COLUMNS}, body`,
	)
		.bind(namespace, slug, now)
		.first<KnowledgeSkillRow & { body: string }>()
	if (!row) return null
	const { body, ...meta } = row
	return { skill: toMeta(meta), body, resources: [] }
}

/**
 * Create or update a skill of the namespace. A slug that belongs to the owner's
 * skills (active or decayed) is refused, so a namespace can never overwrite or
 * shadow it.
 */
export async function upsertKnowledgeSkill(
	namespace: string,
	input: {
		slug: string
		body: string
		metadata?: {
			name?: string
			description?: string
			keywords?: string[]
			allowed_tools?: string[]
		}
		origin_memory_id?: number
	},
	env: Env,
): Promise<{ slug: string; version: number; created: boolean; r2_key: null }> {
	const owned = await env.FERMI_DB.prepare('SELECT 1 AS n FROM skills WHERE slug = ?1')
		.bind(input.slug)
		.first()
	if (owned) throw new Error(`skill_slug_reserved: "${input.slug}" exists outside this namespace`)

	const { meta, document } = normalizeSkillDocument(input)
	const source = input.origin_memory_id != null ? 'promoted_from_memory' : 'manual'
	const now = Date.now()
	const row = await env.FERMI_DB.prepare(
		`INSERT INTO knowledge_skills (namespace, slug, name, description, keywords, allowed_tools,
		                               body, version, source, origin_memory_id, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?10)
		 ON CONFLICT(namespace, slug) DO UPDATE SET
		   name = excluded.name,
		   description = excluded.description,
		   keywords = excluded.keywords,
		   allowed_tools = excluded.allowed_tools,
		   body = excluded.body,
		   version = knowledge_skills.version + 1,
		   source = excluded.source,
		   origin_memory_id = COALESCE(excluded.origin_memory_id, knowledge_skills.origin_memory_id),
		   updated_at = excluded.updated_at
		 RETURNING version`,
	)
		.bind(
			namespace,
			input.slug,
			meta.name,
			meta.description ?? null,
			JSON.stringify(meta.keywords),
			JSON.stringify(meta.allowed_tools),
			document,
			source,
			input.origin_memory_id ?? null,
			now,
		)
		.first<{ version: number }>()
	const version = row?.version ?? 1
	return { slug: input.slug, version, created: version === 1, r2_key: null }
}
