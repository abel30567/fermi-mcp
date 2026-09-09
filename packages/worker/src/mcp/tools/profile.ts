import { z } from 'zod'
import { updateProfileDoc } from '../../lib/profile-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerProfileTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'profile_update',
		description:
			"Edit the bounded profile docs. target 'user' = who the user is (identity, preferences, communication style); target 'agent' = environment facts, conventions, lessons learned. Docs have hard char budgets — an over_budget error means consolidate existing lines (replace/remove) in this same turn and retry. The docs are injected via context_bootstrap; there is no read tool.",
		schema: {
			target: z.enum(['agent', 'user']).describe('Which doc to edit'),
			action: z.enum(['add', 'replace', 'remove']).describe('Edit operation'),
			content: z.string().optional().describe('New line (add) or replacement text (replace)'),
			match: z
				.string()
				.optional()
				.describe('Substring identifying the text to replace, or the line(s) to remove'),
		},
		scope: ['write:memory'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const result = await updateProfileDoc(env.FERMI_DB, args)
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})
}
