import { z } from 'zod'
import { searchMessages } from '../../lib/session-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerSessionSearchTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'session_search',
		description:
			'Full-text search across all session messages. Returns matching messages ranked by relevance.',
		schema: {
			query: z.string().describe('FTS5 search query (supports AND, OR, NOT, phrase "quotes")'),
			limit: z.number().optional().default(20).describe('Maximum number of results'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const results = await searchMessages(args.query, args.limit, env)
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
}
