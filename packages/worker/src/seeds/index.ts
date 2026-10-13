import awsCdkDiscipline from '../../seeds/skills/aws-cdk-discipline/SKILL.md'
import browserAuthSpa from '../../seeds/skills/browser-auth-spa/SKILL.md'
import githubApi from '../../seeds/skills/github-api/SKILL.md'
import grokBotHandoff from '../../seeds/skills/grok-bot-handoff/SKILL.md'
import grokBotInbox from '../../seeds/skills/grok-bot-inbox/SKILL.md'
import museHandoff from '../../seeds/skills/muse-handoff/SKILL.md'
import museInbox from '../../seeds/skills/muse-inbox/SKILL.md'
import shopifyAdmin from '../../seeds/skills/shopify-admin/SKILL.md'
import totpOauth from '../../seeds/skills/totp-oauth/SKILL.md'
import { normalizeSkillDocument, skillR2Key, upsertSkill } from '../lib/skills-store.ts'

const SEED_SKILLS: Array<{ slug: string; body: string }> = [
	{ slug: 'github-api', body: githubApi },
	{ slug: 'totp-oauth', body: totpOauth },
	{ slug: 'browser-auth-spa', body: browserAuthSpa },
	{ slug: 'aws-cdk-discipline', body: awsCdkDiscipline },
	{ slug: 'shopify-admin', body: shopifyAdmin },
	{ slug: 'grok-bot-handoff', body: grokBotHandoff },
	{ slug: 'grok-bot-inbox', body: grokBotInbox },
	{ slug: 'muse-handoff', body: museHandoff },
	{ slug: 'muse-inbox', body: museInbox },
]

export interface SeedSkillsResult {
	seeded: Array<{ slug: string; version: number; created: boolean }>
	skipped: string[]
}

/**
 * Idempotently load the committed seed skills into R2 + D1. Skips any skill
 * whose stored SKILL.md already matches the committed body, so re-running the
 * endpoint never churns versions.
 */
export async function seedSkills(env: Env): Promise<SeedSkillsResult> {
	const result: SeedSkillsResult = { seeded: [], skipped: [] }
	for (const seed of SEED_SKILLS) {
		const existing = await env.FERMI_BUCKET.get(skillR2Key(seed.slug))
		const { document } = normalizeSkillDocument(seed)
		if (existing && (await existing.text()) === document) {
			result.skipped.push(seed.slug)
			continue
		}
		const { slug, version, created } = await upsertSkill(seed, env)
		result.seeded.push({ slug, version, created })
	}
	return result
}
