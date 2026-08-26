import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import { decaySkill, loadSkill, searchSkillsRanked, upsertSkill } from '../lib/skills-store.ts'

const metadataSchema = z
	.object({
		name: z.string().optional(),
		description: z.string().optional(),
		keywords: z.array(z.string()).optional(),
		allowed_tools: z.array(z.string()).optional(),
	})
	.optional()

export function registerSkillCapabilities() {
	defineCapability({
		name: 'skill_search',
		domain: 'skills',
		description:
			'Search loadable skills (procedures, runbooks, workflows) by name, description, and keywords. Call this BEFORE memory_recall for any procedural or how-to query; fall back to memory only when no skill matches.',
		inputSchema: z.object({
			query: z.string().describe('Search term, e.g. "github", "oauth", "browser auth"'),
			limit: z.number().int().min(1).max(50).default(5),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['skill', 'procedure', 'runbook', 'workflow', 'how-to', 'search'],
		handler: async (args, env) => {
			const results = await searchSkillsRanked(args.query, args.limit, env)
			return { results, total: results.length }
		},
	})

	defineCapability({
		name: 'skill_load',
		domain: 'skills',
		description:
			'Load a skill by slug: returns the SKILL.md body, allowed_tools, and resource listing. Increments usage telemetry.',
		inputSchema: z.object({
			slug: z.string().describe('Skill slug, e.g. "github-api"'),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['skill', 'load', 'procedure', 'runbook', 'instructions'],
		handler: async (args, env) => {
			const loaded = await loadSkill(args.slug, env)
			if (!loaded) return { error: 'skill_not_found', slug: args.slug }
			return loaded
		},
	})

	defineCapability({
		name: 'skill_set',
		domain: 'skills',
		description:
			'Create or update a skill. Writes SKILL.md to R2 and metadata to D1; bumps version on update. Pass origin_memory_id when promoting a procedure from memory.',
		inputSchema: z.object({
			slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase slug with dashes'),
			body: z.string().min(1).describe('SKILL.md content; may include ----fenced frontmatter'),
			metadata: metadataSchema.describe(
				'Overrides for frontmatter name/description/keywords/allowed_tools',
			),
			origin_memory_id: z
				.number()
				.int()
				.optional()
				.describe('Memory id this skill was promoted from (sets source=promoted_from_memory)'),
		}),
		scope: ['write:skills'],
		risk: 'low',
		readOnly: false,
		keywords: ['skill', 'create', 'update', 'write', 'promote'],
		handler: async (args, env) =>
			upsertSkill(
				{
					slug: args.slug,
					body: args.body,
					metadata: args.metadata,
					origin_memory_id: args.origin_memory_id,
				},
				env,
			),
	})

	defineCapability({
		name: 'skill_delete',
		domain: 'skills',
		description: 'Soft-delete a skill by marking it as decayed; excluded from search thereafter.',
		inputSchema: z.object({ slug: z.string() }),
		scope: ['write:skills'],
		risk: 'med',
		readOnly: false,
		destructive: true,
		keywords: ['skill', 'delete', 'decay', 'remove'],
		handler: async (args, env) => decaySkill(args.slug, env),
	})
}
