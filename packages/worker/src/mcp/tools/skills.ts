import { z } from 'zod'
import { decaySkill, loadSkill, searchSkillsRanked, upsertSkill } from '../../lib/skills-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerSkillTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'skill_search',
		description:
			'Search loadable skills (procedures, runbooks, workflows) by name, description, and keywords. Call this BEFORE memory_recall for any procedural or how-to query; fall back to memory only when no skill matches.',
		schema: {
			query: z.string().describe('Search term, e.g. "github", "oauth", "browser auth"'),
			limit: z.number().optional().default(5).describe('Maximum number of results (1-50)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const results = await searchSkillsRanked(args.query, args.limit, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ query: args.query, results, total: results.length }, null, 2),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'skill_load',
		description:
			'Load a skill by slug: returns the SKILL.md body (the procedure to follow), allowed_tools, and resource listing.',
		schema: {
			slug: z.string().describe('Skill slug, e.g. "github-api"'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const loaded = await loadSkill(args.slug, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(loaded ?? { error: 'skill_not_found', slug: args.slug }, null, 2),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'skill_set',
		description:
			'Create or update a skill. Writes SKILL.md to R2 and metadata to D1; bumps version on update. Pass origin_memory_id when promoting a procedure from memory.',
		schema: {
			slug: z.string().describe('Lowercase slug with dashes, e.g. "github-api"'),
			body: z.string().describe('SKILL.md content; may include ----fenced frontmatter'),
			metadata: z
				.object({
					name: z.string().optional(),
					description: z.string().optional(),
					keywords: z.array(z.string()).optional(),
					allowed_tools: z.array(z.string()).optional(),
				})
				.optional()
				.describe('Overrides for frontmatter name/description/keywords/allowed_tools'),
			origin_memory_id: z
				.number()
				.optional()
				.describe('Memory id this skill was promoted from (sets source=promoted_from_memory)'),
		},
		scope: ['write:skills'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const res = await upsertSkill(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(res) }],
			}
		},
	})

	defineTool(agent, {
		name: 'skill_delete',
		description: 'Soft-delete a skill by marking it as decayed; excluded from search thereafter.',
		schema: {
			slug: z.string().describe('Skill slug to soft-delete'),
		},
		scope: ['write:skills'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const res = await decaySkill(args.slug, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ slug: args.slug, deleted: res.deleted }),
					},
				],
			}
		},
	})
}
