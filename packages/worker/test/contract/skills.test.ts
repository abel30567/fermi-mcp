import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../src/lib/frontmatter.ts'
import { seedSkills } from '../../src/seeds/index.ts'
import { describeTool } from './describe-tool.ts'
import { type McpClient, resultJson } from './mcp-client.ts'
import { expectSchemaRejection, resetTables, session } from './tool-call.ts'

interface SkillHit {
	slug: string
	name: string
	keywords: string[]
	version: number
	usage_count: number
}
interface Loaded {
	skill: SkillHit & { allowed_tools: string[]; source: string }
	body: string
	resources: unknown[]
}

beforeEach(() => resetTables('skills'))

const BODY = `---
name: contract-widget
description: Polish the contract widget before shipping
keywords: ["widget", "polish"]
allowed_tools: ["fs_read"]
---
## Procedure
1. Polish the widget.
`

async function search(client: McpClient, query: string): Promise<SkillHit[]> {
	return resultJson<{ results: SkillHit[] }>(await client.callTool('skill_search', { query }))
		.results
}

async function skillRow(slug: string) {
	return env.FERMI_DB.prepare(
		'SELECT name, description, keywords, allowed_tools, version, source, decayed_at FROM skills WHERE slug = ?1',
	)
		.bind(slug)
		.first()
}

describeTool('skill_set', () => {
	it('writes SKILL.md to R2 and metadata to D1, bumping version on update', async () => {
		const client = await session()
		expect(
			resultJson(await client.callTool('skill_set', { slug: 'contract-widget', body: BODY })),
		).toEqual({
			slug: 'contract-widget',
			version: 1,
			created: true,
			r2_key: 'skills/contract-widget/SKILL.md',
		})
		expect(await skillRow('contract-widget')).toEqual({
			name: 'contract-widget',
			description: 'Polish the contract widget before shipping',
			keywords: '["widget","polish"]',
			allowed_tools: '["fs_read"]',
			version: 1,
			source: 'manual',
			decayed_at: null,
		})
		const stored = await (await env.FERMI_BUCKET.get('skills/contract-widget/SKILL.md'))?.text()
		expect(stored).toContain('1. Polish the widget.')

		const updated = resultJson(
			await client.callTool('skill_set', {
				slug: 'contract-widget',
				body: BODY,
				metadata: { description: 'Overridden description' },
			}),
		)
		expect(updated).toMatchObject({ version: 2, created: false })
		expect(await skillRow('contract-widget')).toMatchObject({
			description: 'Overridden description',
			version: 2,
		})
	})

	it('round-trips through skill_load', async () => {
		const client = await session()
		await client.callTool('skill_set', { slug: 'contract-widget', body: BODY })
		const loaded = resultJson<Loaded>(
			await client.callTool('skill_load', { slug: 'contract-widget' }),
		)
		expect(loaded.skill).toMatchObject({
			slug: 'contract-widget',
			keywords: ['widget', 'polish'],
			allowed_tools: ['fs_read'],
			version: 1,
		})
		expect(parseFrontmatter(loaded.body).body).toBe(parseFrontmatter(BODY).body)
	})

	it('rejects a call without body and stores nothing', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('skill_set', { slug: 'contract-nobody' }),
			'skill_set',
			'body',
		)
		expect(await skillRow('contract-nobody')).toBeNull()
	})
})

describeTool('skill_load', () => {
	it('returns body and metadata and counts the load', async () => {
		const client = await session()
		await client.callTool('skill_set', { slug: 'contract-widget', body: BODY })
		const loaded = resultJson<Loaded>(
			await client.callTool('skill_load', { slug: 'contract-widget' }),
		)
		expect(loaded).toMatchObject({ skill: { usage_count: 1 }, resources: [] })
		expect(loaded.body).toContain('## Procedure')
		const row = await env.FERMI_DB.prepare('SELECT usage_count FROM skills WHERE slug = ?1')
			.bind('contract-widget')
			.first()
		expect(row).toEqual({ usage_count: 1 })
	})

	it('returns skill_not_found for an unknown slug', async () => {
		const client = await session()
		expect(resultJson(await client.callTool('skill_load', { slug: 'contract-missing' }))).toEqual({
			error: 'skill_not_found',
			slug: 'contract-missing',
		})
	})

	it('rejects a call without slug', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('skill_load', {}), 'skill_load', 'slug')
	})
})

describeTool('skill_search', () => {
	it('finds a skill by name, description and keyword', async () => {
		const client = await session()
		await client.callTool('skill_set', { slug: 'contract-widget', body: BODY })
		for (const query of ['contract-widget', 'before shipping', 'polish']) {
			expect((await search(client, query)).map((s) => s.slug)).toEqual(['contract-widget'])
		}
		const res = resultJson(await client.callTool('skill_search', { query: 'polish' }))
		expect(res).toMatchObject({ query: 'polish', total: 1 })
	})

	it('returns an empty result for no match', async () => {
		const client = await session()
		expect(
			resultJson(await client.callTool('skill_search', { query: 'contract-nothing' })),
		).toEqual({ query: 'contract-nothing', results: [], total: 0 })
	})

	it('rejects a call without query', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('skill_search', {}), 'skill_search', 'query')
	})
})

describeTool('skill_delete', () => {
	it('soft-deletes: excluded from search and load, row kept', async () => {
		const client = await session()
		await client.callTool('skill_set', { slug: 'contract-widget', body: BODY })
		expect(resultJson(await client.callTool('skill_delete', { slug: 'contract-widget' }))).toEqual({
			slug: 'contract-widget',
			deleted: true,
		})
		expect(await skillRow('contract-widget')).toMatchObject({ decayed_at: expect.any(Number) })
		expect(await search(client, 'polish')).toEqual([])
		expect(resultJson(await client.callTool('skill_load', { slug: 'contract-widget' }))).toEqual({
			error: 'skill_not_found',
			slug: 'contract-widget',
		})
	})

	it('reports deleted=false for an unknown slug', async () => {
		const client = await session()
		expect(resultJson(await client.callTool('skill_delete', { slug: 'contract-missing' }))).toEqual(
			{ slug: 'contract-missing', deleted: false },
		)
	})

	it('rejects a call without slug', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('skill_delete', {}), 'skill_delete', 'slug')
	})
})

// Every committed seed directory; .md files load as text (wrangler Text rule).
const SEED_FILES = import.meta.glob<string>('../../seeds/skills/*/SKILL.md', {
	import: 'default',
	eager: true,
})
const SEEDS = Object.entries(SEED_FILES).map(([path, body]) => ({
	slug: path.split('/').at(-2) as string,
	body,
	meta: parseFrontmatter(body).meta,
}))

// A frontmatter keyword of `slug` that no other seed's name, description or
// keywords contain: skill_search matches by substring, so only such a keyword
// can rank one seed first on its own.
function distinctiveKeyword(slug: string): string | undefined {
	const self = SEEDS.find((s) => s.slug === slug)
	const others = SEEDS.filter((s) => s.slug !== slug).map((s) =>
		[s.meta.name, s.meta.description, ...(s.meta.keywords ?? [])].join(' ').toLowerCase(),
	)
	return self?.meta.keywords?.find((k) => !others.some((o) => o.includes(k.toLowerCase())))
}

// seedSkills skips a seed whose R2 document already matches, so clear R2 too
// for a fresh D1 load.
async function freshSeed(): Promise<void> {
	await env.FERMI_BUCKET.delete(SEEDS.map((s) => `skills/${s.slug}/SKILL.md`))
	const { seeded } = await seedSkills(env)
	expect(seeded.map((s) => s.slug).sort()).toEqual(SEEDS.map((s) => s.slug).sort())
}

describe('seed skills', () => {
	it('every seed directory parses and seedSkills loads it', async () => {
		expect(SEEDS.length).toBeGreaterThan(0)
		for (const seed of SEEDS) {
			expect(seed.meta.name, seed.slug).toBe(seed.slug)
			expect(seed.meta.description, seed.slug).toBeTruthy()
			expect(seed.meta.keywords?.length, seed.slug).toBeGreaterThan(0)
		}
		await freshSeed()
		const client = await session()
		for (const seed of SEEDS) {
			const loaded = resultJson<Loaded>(await client.callTool('skill_load', { slug: seed.slug }))
			expect(loaded.skill, seed.slug).toMatchObject({
				slug: seed.slug,
				keywords: seed.meta.keywords,
				allowed_tools: seed.meta.allowed_tools ?? [],
			})
			expect(parseFrontmatter(loaded.body).body, seed.slug).toBe(parseFrontmatter(seed.body).body)
		}
	})

	it('each seed is the top skill_search hit for its slug and a distinctive keyword', async () => {
		await freshSeed()
		const client = await session()
		const noDistinctiveKeyword: string[] = []
		for (const seed of SEEDS) {
			expect((await search(client, seed.slug))[0]?.slug, `query ${seed.slug}`).toBe(seed.slug)
			const keyword = distinctiveKeyword(seed.slug)
			if (keyword) {
				expect((await search(client, keyword))[0]?.slug, `query ${keyword}`).toBe(seed.slug)
				continue
			}
			// Every keyword is shared with another seed: the query ties them and
			// usage_count, then updated_at, decides which ranks first.
			noDistinctiveKeyword.push(seed.slug)
			const shared = seed.meta.keywords?.[0] as string
			expect(
				(await search(client, shared)).map((s) => s.slug),
				`query ${shared}`,
			).toContain(seed.slug)
		}
		expect(noDistinctiveKeyword).toEqual(['grok-bot-handoff', 'muse-handoff', 'muse-inbox'])
	})
})
