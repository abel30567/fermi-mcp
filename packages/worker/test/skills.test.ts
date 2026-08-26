import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../src/lib/frontmatter.ts'
import {
	decaySkill,
	getSkill,
	loadSkill,
	searchSkills,
	searchSkillsRanked,
	skillR2Key,
	upsertSkill,
} from '../src/lib/skills-store.ts'
import { clearSkills, setupSkillsSchema } from './setup-d1.ts'

beforeAll(async () => {
	await setupSkillsSchema()
})

beforeEach(async () => {
	await clearSkills()
})

const SKILL_BODY = `---
name: github-api
description: Call the GitHub REST API with auth
keywords: ["github", "api"]
allowed_tools: ["fetch_url", "secret_resolve"]
---
## Procedure
1. Use {{secret:GITHUB_TOKEN}} via the secrets layer.
`

describe('frontmatter', () => {
	it('round-trips meta and body', () => {
		const { meta, body } = parseFrontmatter(SKILL_BODY)
		expect(meta.name).toBe('github-api')
		expect(meta.keywords).toEqual(['github', 'api'])
		expect(meta.allowed_tools).toEqual(['fetch_url', 'secret_resolve'])
		expect(body).toContain('## Procedure')
		const again = parseFrontmatter(serializeFrontmatter(meta, body))
		expect(again.meta).toEqual(meta)
		expect(again.body).toBe(body)
	})

	it('treats documents without frontmatter as pure body', () => {
		const { meta, body } = parseFrontmatter('# Just markdown')
		expect(meta).toEqual({})
		expect(body).toBe('# Just markdown')
	})

	it('parses comma-separated lists as fallback', () => {
		const { meta } = parseFrontmatter('---\nname: x\nkeywords: a, b, c\n---\nbody')
		expect(meta.keywords).toEqual(['a', 'b', 'c'])
	})
})

describe('upsertSkill', () => {
	it('round-trips R2 + D1 and bumps version on update', async () => {
		const first = await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		expect(first).toMatchObject({ slug: 'github-api', version: 1, created: true })

		const obj = await env.FERMI_BUCKET.get(skillR2Key('github-api'))
		expect(obj).not.toBeNull()
		expect(await obj?.text()).toContain('{{secret:GITHUB_TOKEN}}')

		const row = await getSkill('github-api', env)
		expect(row?.name).toBe('github-api')
		expect(row?.keywords).toEqual(['github', 'api'])
		expect(row?.allowed_tools).toEqual(['fetch_url', 'secret_resolve'])
		expect(row?.source).toBe('manual')

		const second = await upsertSkill({ slug: 'github-api', body: `${SKILL_BODY}\nMore.` }, env)
		expect(second).toMatchObject({ version: 2, created: false })
	})

	it('records promotion provenance from origin_memory_id', async () => {
		await upsertSkill({ slug: 'promoted', body: '# p', origin_memory_id: 400 }, env)
		const row = await getSkill('promoted', env)
		expect(row?.source).toBe('promoted_from_memory')
		expect(row?.origin_memory_id).toBe(400)
	})

	it('explicit metadata overrides frontmatter', async () => {
		await upsertSkill(
			{ slug: 'override', body: SKILL_BODY, metadata: { name: 'Custom Name' } },
			env,
		)
		const row = await getSkill('override', env)
		expect(row?.name).toBe('Custom Name')
	})
})

describe('loadSkill', () => {
	it('returns body + allowed_tools + resources and bumps usage_count', async () => {
		await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		await env.FERMI_BUCKET.put('skills/github-api/resources/example.json', '{}')

		const loaded = await loadSkill('github-api', env)
		expect(loaded?.body).toContain('## Procedure')
		expect(loaded?.skill.allowed_tools).toEqual(['fetch_url', 'secret_resolve'])
		expect(loaded?.resources).toEqual([
			{ key: 'skills/github-api/resources/example.json', size: 2 },
		])
		expect(loaded?.skill.usage_count).toBe(1)

		const row = await getSkill('github-api', env)
		expect(row?.usage_count).toBe(1)
		expect(row?.last_used_at).not.toBeNull()
	})

	it('returns null for unknown or decayed skills', async () => {
		expect(await loadSkill('nope', env)).toBeNull()
		await upsertSkill({ slug: 'gone', body: '# x' }, env)
		await decaySkill('gone', env)
		expect(await loadSkill('gone', env)).toBeNull()
	})
})

describe('search + decay', () => {
	it('finds skills by name, description, and keywords', async () => {
		await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		expect(await searchSkills('github', 10, env)).toHaveLength(1)
		expect(await searchSkills('REST API', 10, env)).toHaveLength(1)
		expect((await searchSkills('github', 10, env))[0].score).toBe(1)
	})

	it('excludes decayed skills and revives on re-upsert', async () => {
		await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		await decaySkill('github-api', env)
		expect(await searchSkills('github', 10, env)).toHaveLength(0)

		await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		const hits = await searchSkills('github', 10, env)
		expect(hits).toHaveLength(1)
		expect(hits[0].version).toBe(2)
	})

	it('ranked search works without Vectorize binding', async () => {
		await upsertSkill({ slug: 'github-api', body: SKILL_BODY }, env)
		const ranked = await searchSkillsRanked('github', 5, env)
		expect(ranked).toHaveLength(1)
		expect(ranked[0].slug).toBe('github-api')
		expect(ranked[0].score).toBeGreaterThan(0)
	})
})
