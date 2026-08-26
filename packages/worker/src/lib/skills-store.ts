import { executeHooks } from '../orchestration/hooks.ts'
import { embedText } from './embeddings.ts'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts'
import { reciprocalRankFusion } from './rrf.ts'

export type SkillSource = 'manual' | 'promoted_from_memory' | 'hermes'

export const skillR2Key = (slug: string) => `skills/${slug}/SKILL.md`
const skillResourcesPrefix = (slug: string) => `skills/${slug}/resources/`
const skillVectorId = (slug: string) => `skill:${slug}`

export interface SkillMeta {
	slug: string
	name: string
	description: string | null
	keywords: string[]
	allowed_tools: string[]
	version: number
	source: SkillSource
	origin_memory_id: number | null
	usage_count: number
	last_used_at: number | null
	created_at: number
	updated_at: number
}

interface SkillRow {
	slug: string
	name: string
	description: string | null
	keywords: string
	allowed_tools: string
	version: number
	source: SkillSource
	origin_memory_id: number | null
	usage_count: number
	last_used_at: number | null
	created_at: number
	updated_at: number
}

const SKILL_COLUMNS = `slug, name, description, keywords, allowed_tools, version, source,
	origin_memory_id, usage_count, last_used_at, created_at, updated_at`

function parseJsonList(value: string): string[] {
	try {
		const parsed = JSON.parse(value)
		if (Array.isArray(parsed)) return parsed.map(String)
	} catch {
		// malformed column value - treat as empty
	}
	return []
}

function rowToMeta(row: SkillRow): SkillMeta {
	return {
		...row,
		keywords: parseJsonList(row.keywords),
		allowed_tools: parseJsonList(row.allowed_tools),
	}
}

export async function searchSkills(
	query: string,
	limit: number,
	env: Env,
): Promise<(SkillMeta & { score: number })[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT ${SKILL_COLUMNS} FROM skills
		  WHERE decayed_at IS NULL
		    AND (name LIKE '%' || ?1 || '%'
		         OR description LIKE '%' || ?1 || '%'
		         OR keywords LIKE '%' || ?1 || '%')
		  ORDER BY usage_count DESC, updated_at DESC
		  LIMIT ?2`,
	)
		.bind(query, limit)
		.all<SkillRow>()
	const q = query.toLowerCase()
	return results.map((row) => ({
		...rowToMeta(row),
		score: row.name.toLowerCase().includes(q) ? 1 : 0.7,
	}))
}

/**
 * Semantic skill search via Vectorize (`skill:{slug}` ids). Hits are
 * cross-checked against D1 so decayed or stale vectors never surface.
 */
export async function searchSkillsVectorize(
	query: string,
	limit: number,
	env: Env,
): Promise<(SkillMeta & { score: number })[]> {
	if (!env.FERMI_VECTORIZE) return []
	try {
		const { vector, offline, error } = await embedText(query, env)
		if (offline && error) return []
		const res = await env.FERMI_VECTORIZE.query(vector, {
			topK: limit,
			returnMetadata: 'all',
		})
		const hits: (SkillMeta & { score: number })[] = []
		for (const m of res.matches ?? []) {
			if (!m.id.startsWith('skill:')) continue
			const slug = m.id.slice('skill:'.length)
			const skill = await getSkill(slug, env)
			if (skill) hits.push({ ...skill, score: m.score ?? 0 })
		}
		return hits
	} catch {
		return []
	}
}

/**
 * Combined keyword + semantic skill search, fused with RRF. This is the
 * skill_search resolution path; memory_recall is the fallback on a miss.
 */
export async function searchSkillsRanked(
	query: string,
	limit: number,
	env: Env,
): Promise<(SkillMeta & { score: number })[]> {
	const [likeHits, vecHits] = await Promise.all([
		searchSkills(query, limit, env),
		searchSkillsVectorize(query, limit, env),
	])
	const bySlug = new Map(likeHits.map((s) => [s.slug, s]))
	for (const v of vecHits) if (!bySlug.has(v.slug)) bySlug.set(v.slug, v)
	const fused = reciprocalRankFusion([
		likeHits.map((s) => ({ id: s.slug })),
		vecHits.map((s) => ({ id: s.slug })),
	])
	const results: (SkillMeta & { score: number })[] = []
	for (const f of fused.slice(0, limit)) {
		const s = bySlug.get(f.id)
		if (s) results.push({ ...s, score: f.score })
	}
	return results
}

export async function getSkill(slug: string, env: Env): Promise<SkillMeta | null> {
	const row = await env.FERMI_DB.prepare(
		`SELECT ${SKILL_COLUMNS} FROM skills WHERE slug = ?1 AND decayed_at IS NULL`,
	)
		.bind(slug)
		.first<SkillRow>()
	return row ? rowToMeta(row) : null
}

export interface LoadedSkill {
	skill: SkillMeta
	body: string | null
	resources: Array<{ key: string; size: number }>
}

export async function loadSkill(slug: string, env: Env): Promise<LoadedSkill | null> {
	const skill = await getSkill(slug, env)
	if (!skill) return null

	const obj = await env.FERMI_BUCKET.get(skillR2Key(slug))
	const body = obj ? await obj.text() : null
	const listed = await env.FERMI_BUCKET.list({ prefix: skillResourcesPrefix(slug) })
	const resources = listed.objects.map((o) => ({ key: o.key, size: o.size }))

	const now = Date.now()
	await env.FERMI_DB.prepare(
		'UPDATE skills SET usage_count = usage_count + 1, last_used_at = ?1 WHERE slug = ?2',
	)
		.bind(now, slug)
		.run()
	executeHooks('skill:loaded', { tool: 'skill_load', args: { slug } }, env).catch(() => {})

	return {
		skill: { ...skill, usage_count: skill.usage_count + 1, last_used_at: now },
		body,
		resources,
	}
}

async function upsertSkillVector(skill: SkillMeta, body: string, env: Env): Promise<void> {
	if (!env.FERMI_VECTORIZE) return
	const text = [skill.name, skill.description ?? '', ...skill.keywords, body.slice(0, 500)]
		.filter(Boolean)
		.join(' ')
	const { vector } = await embedText(text, env)
	await env.FERMI_VECTORIZE.upsert([
		{
			id: skillVectorId(skill.slug),
			values: vector,
			metadata: {
				slug: skill.slug,
				name: skill.name,
				description: skill.description ?? '',
			},
		},
	])
}

export interface UpsertSkillInput {
	slug: string
	body: string
	metadata?: {
		name?: string
		description?: string
		keywords?: string[]
		allowed_tools?: string[]
	}
	source?: SkillSource
	origin_memory_id?: number
}

/**
 * Canonical form of a skill document: explicit metadata wins over frontmatter
 * parsed from the body, and the result is re-serialized so R2 contents are
 * byte-comparable across writes.
 */
export function normalizeSkillDocument(input: UpsertSkillInput): {
	meta: {
		name: string
		description?: string
		keywords: string[]
		allowed_tools: string[]
	}
	procedure: string
	document: string
} {
	const parsed = parseFrontmatter(input.body)
	const meta = {
		name: input.metadata?.name ?? parsed.meta.name ?? input.slug,
		description: input.metadata?.description ?? parsed.meta.description,
		keywords: input.metadata?.keywords ?? parsed.meta.keywords ?? [],
		allowed_tools: input.metadata?.allowed_tools ?? parsed.meta.allowed_tools ?? [],
	}
	return { meta, procedure: parsed.body, document: serializeFrontmatter(meta, parsed.body) }
}

export async function upsertSkill(
	input: UpsertSkillInput,
	env: Env,
): Promise<{ slug: string; version: number; created: boolean; r2_key: string }> {
	const { meta, procedure, document } = normalizeSkillDocument(input)
	const source =
		input.source ?? (input.origin_memory_id != null ? 'promoted_from_memory' : 'manual')

	const r2Key = skillR2Key(input.slug)
	await env.FERMI_BUCKET.put(r2Key, document)

	const now = Date.now()
	const existing = await env.FERMI_DB.prepare('SELECT version FROM skills WHERE slug = ?1')
		.bind(input.slug)
		.first<{ version: number }>()
	await env.FERMI_DB.prepare(
		`INSERT INTO skills (slug, name, description, keywords, allowed_tools, version, source,
		                     origin_memory_id, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?8)
		 ON CONFLICT(slug) DO UPDATE SET
		   name = excluded.name,
		   description = excluded.description,
		   keywords = excluded.keywords,
		   allowed_tools = excluded.allowed_tools,
		   version = skills.version + 1,
		   source = excluded.source,
		   origin_memory_id = COALESCE(excluded.origin_memory_id, skills.origin_memory_id),
		   updated_at = excluded.updated_at,
		   decayed_at = NULL`,
	)
		.bind(
			input.slug,
			meta.name,
			meta.description ?? null,
			JSON.stringify(meta.keywords),
			JSON.stringify(meta.allowed_tools),
			source,
			input.origin_memory_id ?? null,
			now,
		)
		.run()

	const version = existing ? existing.version + 1 : 1
	const skill = await getSkill(input.slug, env)
	if (skill) {
		try {
			await upsertSkillVector(skill, procedure, env)
		} catch {
			// Vectorize unavailable (local dev) - skill remains findable via LIKE search
		}
	}
	return { slug: input.slug, version, created: !existing, r2_key: r2Key }
}

export async function decaySkill(slug: string, env: Env): Promise<{ deleted: boolean }> {
	const res = await env.FERMI_DB.prepare(
		'UPDATE skills SET decayed_at = ?1 WHERE slug = ?2 AND decayed_at IS NULL',
	)
		.bind(Date.now(), slug)
		.run()
	try {
		await env.FERMI_VECTORIZE?.deleteByIds([skillVectorId(slug)])
	} catch {
		// stale vectors are filtered out at query time against D1
	}
	return { deleted: (res.meta.changes ?? 0) > 0 }
}

export async function listActiveSkills(env: Env): Promise<SkillMeta[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT ${SKILL_COLUMNS} FROM skills WHERE decayed_at IS NULL ORDER BY slug`,
	).all<SkillRow>()
	return results.map(rowToMeta)
}
