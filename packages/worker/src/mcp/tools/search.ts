import { z } from 'zod'
import { registerAllCapabilities } from '../../capabilities/index.ts'
import {
	type CapabilitySearchHit,
	listCapabilities,
	searchCapabilitiesByName,
	searchCapabilitiesFts,
} from '../../lib/capability-fts.ts'
import { getCapability } from '../../lib/capability.ts'
import { getConnector, listConnectors } from '../../lib/connectors-store.ts'
import { embedText } from '../../lib/embeddings.ts'
import { loadRelevantMemoriesForTool } from '../../lib/memory-context.ts'
import { getPackage, listPackages } from '../../lib/packages-store.ts'
import { reciprocalRankFusion } from '../../lib/rrf.ts'
import { listSecrets } from '../../lib/secrets-store.ts'
import { getSkill, searchSkills, skillR2Key } from '../../lib/skills-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

type EntityType =
	| 'capability'
	| 'package'
	| 'value'
	| 'connector'
	| 'secret'
	| 'memory'
	| 'skill'
	| 'retriever'

// Post-fusion score multipliers: skills are the primary resolution path for
// procedural queries and must outrank memory hits (issue #22).
const TYPE_BOOST: Partial<Record<EntityType | 'message', number>> = { skill: 1.25 }

interface SearchMatch {
	id: string
	type: EntityType | 'message'
	name?: string
	title?: string
	snippet?: string
	score: number
	metadata?: Record<string, unknown>
}

function capHitToMatch(hit: CapabilitySearchHit, score: number): SearchMatch {
	return {
		id: hit.id,
		type: 'capability',
		name: hit.cap.name,
		title: hit.cap.name,
		snippet: hit.cap.description,
		score,
		metadata: {
			domain: hit.cap.domain,
			scope: hit.cap.scope,
			risk: hit.cap.risk,
			readOnly: hit.cap.readOnly ?? false,
		},
	}
}

async function entityDetail(entity: string, env: Env): Promise<SearchMatch | null> {
	const colon = entity.lastIndexOf(':')
	if (colon < 0) return null
	const id = entity.slice(0, colon)
	const type = entity.slice(colon + 1) as EntityType

	if (type === 'capability') {
		registerAllCapabilities()
		const cap = getCapability(id)
		if (!cap) return null
		const shape = cap.inputSchema.shape as Record<string, { _def?: { description?: string } }>
		const fields: Record<string, string> = {}
		for (const [k, v] of Object.entries(shape)) fields[k] = v?._def?.description ?? ''
		return {
			id: entity,
			type: 'capability',
			name: cap.name,
			title: cap.name,
			snippet: cap.description,
			score: 1,
			metadata: {
				domain: cap.domain,
				scope: cap.scope,
				risk: cap.risk,
				readOnly: cap.readOnly ?? false,
				idempotent: cap.idempotent ?? false,
				destructive: cap.destructive ?? false,
				keywords: cap.keywords ?? [],
				tags: cap.tags ?? [],
				fields,
			},
		}
	}
	if (type === 'memory') {
		const row = (await env.FERMI_DB.prepare(
			'SELECT id, kind, body, pinned, created_at FROM memory WHERE id = ?1 AND decayed_at IS NULL',
		)
			.bind(Number(id))
			.first()) as {
			id: number
			kind: string
			body: string
			pinned: number
			created_at: number
		} | null
		if (!row) return null
		return {
			id: entity,
			type: 'memory',
			name: `memory#${row.id}`,
			title: row.body.slice(0, 80),
			snippet: row.body,
			score: 1,
			metadata: { kind: row.kind, pinned: !!row.pinned, created_at: row.created_at },
		}
	}
	if (type === 'connector') {
		const c = await getConnector(id, env)
		if (!c) return null
		return {
			id: entity,
			type: 'connector',
			name: c.name,
			title: c.name,
			snippet: c.description ?? `${c.capability} → ${c.base_url}`,
			score: 1,
			metadata: {
				capability: c.capability,
				secret_name: c.secret_name,
				base_url: c.base_url,
				default_headers: c.default_headers,
			},
		}
	}
	if (type === 'package') {
		const p = await getPackage(id, env)
		if (!p) return null
		return {
			id: entity,
			type: 'package',
			name: p.slug,
			title: p.slug,
			snippet: p.description ?? `package ${p.slug}@${p.version}`,
			score: 1,
			metadata: {
				version: p.version,
				size: p.source.length,
				allowed_imports: JSON.parse(p.allowed_imports),
			},
		}
	}
	if (type === 'skill') {
		const skill = await getSkill(id, env)
		if (!skill) return null
		return {
			id: entity,
			type: 'skill',
			name: skill.slug,
			title: skill.name,
			snippet: skill.description ?? `skill ${skill.slug} v${skill.version}`,
			score: 1,
			metadata: {
				keywords: skill.keywords,
				allowed_tools: skill.allowed_tools,
				version: skill.version,
				source: skill.source,
				origin_memory_id: skill.origin_memory_id,
				usage_count: skill.usage_count,
				r2_key: skillR2Key(skill.slug),
			},
		}
	}
	if (type === 'secret') {
		const all = await listSecrets(null, env)
		const found = all.find((s) => s.name === id)
		if (!found) return null
		return {
			id: entity,
			type: 'secret',
			name: found.name,
			title: found.name,
			snippet: `secret stored in scope=${found.scope}`,
			score: 1,
			metadata: {
				scope: found.scope,
				allowed_hosts: found.allowed_hosts,
				allowed_capabilities: found.allowed_capabilities,
				allowed_packages: found.allowed_packages,
				updated_at: found.updated_at,
			},
		}
	}
	return null
}

async function searchMemoriesLike(query: string, limit: number, env: Env): Promise<SearchMatch[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT id, kind, body, pinned, created_at FROM memory
		 WHERE body LIKE '%' || ?1 || '%' AND decayed_at IS NULL
		 ORDER BY pinned DESC, created_at DESC
		 LIMIT ?2`,
	)
		.bind(query, limit)
		.all<{ id: number; kind: string; body: string; pinned: number; created_at: number }>()
	return results.map((r) => ({
		id: `${r.id}:memory`,
		type: 'memory' as const,
		name: `memory#${r.id}`,
		title: r.body.slice(0, 80),
		snippet: r.body,
		score: r.pinned ? 1 : 0.5,
		metadata: { kind: r.kind, pinned: !!r.pinned, created_at: r.created_at },
	}))
}

async function searchMessagesFts(query: string, limit: number, env: Env): Promise<SearchMatch[]> {
	try {
		const { results } = await env.FERMI_DB.prepare(
			`SELECT m.id, m.session_id, m.role, m.body, m.created_at
			   FROM messages_fts f JOIN messages m ON m.id = f.rowid
			  WHERE messages_fts MATCH ?1
			  ORDER BY rank
			  LIMIT ?2`,
		)
			.bind(query, limit)
			.all<{
				id: number
				session_id: string
				role: string
				body: string
				created_at: number
			}>()
		return results.map((r) => ({
			id: `${r.id}:message`,
			type: 'message' as const,
			name: `${r.session_id}/${r.role}`,
			title: r.body.slice(0, 80),
			snippet: r.body,
			score: 1,
			metadata: { session_id: r.session_id, role: r.role, created_at: r.created_at },
		}))
	} catch {
		return []
	}
}

async function searchVectorize(
	query: string,
	limit: number,
	env: Env,
): Promise<{
	capMatches: SearchMatch[]
	skillMatches: SearchMatch[]
	offline: boolean
	warning?: string
}> {
	if (!env.FERMI_VECTORIZE) {
		return { capMatches: [], skillMatches: [], offline: true, warning: 'vectorize_binding_missing' }
	}
	const { vector, offline, error } = await embedText(query, env)
	if (offline && error) {
		return { capMatches: [], skillMatches: [], offline: true, warning: `embed_${error}` }
	}
	try {
		const res = await env.FERMI_VECTORIZE.query(vector, {
			topK: limit,
			returnMetadata: 'all',
		})
		const capMatches: SearchMatch[] = []
		const skillMatches: SearchMatch[] = []
		for (const m of res.matches ?? []) {
			const meta = (m.metadata ?? {}) as Record<string, unknown>
			if (m.id.startsWith('capability:')) {
				const name = m.id.slice('capability:'.length)
				capMatches.push({
					id: `${name}:capability`,
					type: 'capability',
					name,
					title: name,
					snippet: typeof meta.description === 'string' ? meta.description : '',
					score: m.score ?? 0,
					metadata: { domain: meta.domain, risk: meta.risk, readOnly: meta.readOnly },
				})
			} else if (m.id.startsWith('skill:')) {
				const slug = m.id.slice('skill:'.length)
				// Cross-check against D1 so decayed/stale vectors never surface
				const skill = await getSkill(slug, env)
				if (!skill) continue
				skillMatches.push({
					id: `${slug}:skill`,
					type: 'skill',
					name: slug,
					title: skill.name,
					snippet: skill.description ?? '',
					score: m.score ?? 0,
					metadata: {
						version: skill.version,
						source: skill.source,
						usage_count: skill.usage_count,
						keywords: skill.keywords,
					},
				})
			}
		}
		return { capMatches, skillMatches, offline: false }
	} catch (err) {
		return {
			capMatches: [],
			skillMatches: [],
			offline: true,
			warning: err instanceof Error ? err.message : 'vectorize_query_failed',
		}
	}
}

async function searchSkillsLike(query: string, limit: number, env: Env): Promise<SearchMatch[]> {
	const hits = await searchSkills(query, limit, env)
	return hits.map((s) => ({
		id: `${s.slug}:skill`,
		type: 'skill' as const,
		name: s.slug,
		title: s.name,
		snippet: s.description ?? '',
		score: s.score,
		metadata: {
			version: s.version,
			source: s.source,
			usage_count: s.usage_count,
			keywords: s.keywords,
		},
	}))
}

async function searchConnectorsByName(query: string, env: Env): Promise<SearchMatch[]> {
	const all = await listConnectors(env)
	const q = query.toLowerCase()
	return all
		.filter(
			(c) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
		)
		.map((c) => ({
			id: `${c.name}:connector`,
			type: 'connector' as const,
			name: c.name,
			title: c.name,
			snippet: c.description ?? `${c.capability} → ${c.base_url}`,
			score: 1,
			metadata: {
				capability: c.capability,
				secret_name: c.secret_name,
				base_url: c.base_url,
			},
		}))
}

async function searchPackagesByName(query: string, env: Env): Promise<SearchMatch[]> {
	const all = await listPackages(env)
	const q = query.toLowerCase()
	return all
		.filter(
			(p) => p.slug.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
		)
		.map((p) => ({
			id: `${p.slug}:package`,
			type: 'package' as const,
			name: p.slug,
			title: p.slug,
			snippet: p.description ?? `package ${p.slug}@${p.version}`,
			score: 1,
			metadata: { version: p.version, size: p.source_size },
		}))
}

async function searchSecretsByName(query: string, env: Env): Promise<SearchMatch[]> {
	const all = await listSecrets(null, env)
	const q = query.toLowerCase()
	return all
		.filter((s) => s.name.toLowerCase().includes(q))
		.map((s) => ({
			id: `${s.name}:secret`,
			type: 'secret' as const,
			name: s.name,
			title: s.name,
			snippet: `secret stored in scope=${s.scope}`,
			score: 1,
			metadata: {
				scope: s.scope,
				allowed_hosts: s.allowed_hosts,
				updated_at: s.updated_at,
			},
		}))
}

const memoryContextSchema = z
	.object({
		task: z.string().optional(),
		query: z.string().optional(),
		entities: z.array(z.string()).optional(),
		constraints: z.array(z.string()).optional(),
	})
	.optional()

export function registerSearchTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'search',
		description:
			'Unified search over capabilities, skills, secrets, memories, and message history. Use entity="<id>:<type>" for exact lookup.',
		schema: {
			entity: z
				.string()
				.optional()
				.describe('Exact entity lookup, e.g. "memory_recall:capability" or "github-api:skill"'),
			query: z.string().optional().describe('Free-text query for ranked search'),
			types: z
				.array(
					z.enum([
						'capability',
						'package',
						'value',
						'connector',
						'secret',
						'memory',
						'skill',
						'retriever',
					]),
				)
				.optional()
				.describe('Restrict candidate sources'),
			limit: z.number().int().min(1).max(50).default(10),
			memoryContext: memoryContextSchema,
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const startedAt = Date.now()
			registerAllCapabilities()
			const warnings: string[] = []
			const guidance: string[] = []
			const candidateCounts: Record<string, number> = {}

			// Entity-detail mode
			if (args.entity) {
				const detail = await entityDetail(args.entity, env)
				const memories = args.memoryContext
					? await loadRelevantMemoriesForTool(args.memoryContext, env)
					: undefined
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								matches: detail ? [detail] : [],
								offline: false,
								warnings: detail ? warnings : ['entity_not_found'],
								guidance: [],
								telemetry: {
									durationMs: Date.now() - startedAt,
									candidateCounts: { entity: detail ? 1 : 0 },
								},
								memories,
							}),
						},
					],
				}
			}

			const allowedTypes = new Set(args.types ?? ['capability', 'memory', 'secret', 'skill'])
			const query = args.query?.trim() ?? ''
			const lim = args.limit

			// Empty-query fallback: enumerate
			if (!query) {
				const lists: SearchMatch[][] = []
				if (allowedTypes.has('capability')) {
					const caps = listCapabilities(lim).map((h) => capHitToMatch(h, 1))
					candidateCounts.capability_enumerate = caps.length
					lists.push(caps)
				}
				const flat = lists.flat().slice(0, lim)
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								matches: flat,
								offline: false,
								warnings,
								guidance: ['Provide query or entity for ranked search'],
								telemetry: { durationMs: Date.now() - startedAt, candidateCounts },
							}),
						},
					],
				}
			}

			// Ranked mode — parallel candidate builders
			const wantsCap = allowedTypes.has('capability')
			const wantsSkill = allowedTypes.has('skill')
			const [
				capName,
				capFts,
				vecRes,
				skillHits,
				memoryHits,
				messageHits,
				secretHits,
				connectorHits,
				packageHits,
			] = await Promise.all([
				wantsCap
					? Promise.resolve(searchCapabilitiesByName(query, lim).map((h) => capHitToMatch(h, 1)))
					: Promise.resolve([] as SearchMatch[]),
				wantsCap
					? Promise.resolve(searchCapabilitiesFts(query, lim).map((h) => capHitToMatch(h, h.score)))
					: Promise.resolve([] as SearchMatch[]),
				wantsCap || wantsSkill
					? searchVectorize(query, lim, env)
					: Promise.resolve({
							capMatches: [] as SearchMatch[],
							skillMatches: [] as SearchMatch[],
							offline: false,
							warning: undefined as string | undefined,
						}),
				wantsSkill ? searchSkillsLike(query, lim, env) : Promise.resolve([]),
				allowedTypes.has('memory') ? searchMemoriesLike(query, lim, env) : Promise.resolve([]),
				searchMessagesFts(query, lim, env),
				allowedTypes.has('secret') ? searchSecretsByName(query, env) : Promise.resolve([]),
				allowedTypes.has('connector') ? searchConnectorsByName(query, env) : Promise.resolve([]),
				allowedTypes.has('package') ? searchPackagesByName(query, env) : Promise.resolve([]),
			])

			const capVec = wantsCap ? vecRes.capMatches : []
			const skillVec = wantsSkill ? vecRes.skillMatches : []
			const offline = vecRes.offline
			if (vecRes.warning) warnings.push(vecRes.warning)

			candidateCounts.capability_name = capName.length
			candidateCounts.capability_fts = capFts.length
			candidateCounts.capability_vec = capVec.length
			candidateCounts.skill_like = skillHits.length
			candidateCounts.skill_vec = skillVec.length
			candidateCounts.memory = memoryHits.length
			candidateCounts.message = messageHits.length
			candidateCounts.secret = secretHits.length
			candidateCounts.connector = connectorHits.length
			candidateCounts.package = packageHits.length

			const allLists = [
				capName,
				capFts,
				capVec,
				skillHits,
				skillVec,
				memoryHits,
				messageHits,
				secretHits,
				connectorHits,
				packageHits,
			]
			const fused = reciprocalRankFusion(allLists)
			const byId = new Map<string, SearchMatch>()
			for (const list of allLists) {
				for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item)
			}
			const boosted = fused
				.map((f) => {
					const m = byId.get(f.id)
					return { m, score: f.score * (TYPE_BOOST[m?.type ?? 'capability'] ?? 1) }
				})
				.sort((a, b) => b.score - a.score)
			const matches: SearchMatch[] = []
			for (const b of boosted.slice(0, lim)) {
				if (b.m) matches.push({ ...b.m, score: b.score })
			}

			const memories = args.memoryContext
				? await loadRelevantMemoriesForTool(args.memoryContext, env)
				: undefined

			if (matches.length === 0) {
				guidance.push(
					`No matches for "${query}". Try a different keyword or list with empty query.`,
				)
			}

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							matches,
							offline,
							warnings,
							guidance,
							telemetry: { durationMs: Date.now() - startedAt, candidateCounts },
							memories,
						}),
					},
				],
			}
		},
	})
}
