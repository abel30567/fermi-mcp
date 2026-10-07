import { z } from 'zod'
import { searchMessages } from '../../lib/session-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerSessionSearchTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'session_search',
		description:
			'Full-text search across all session messages, ranked by relevance. Each hit carries session_id, created_at, and the originating channel + chat_id, so you can tell which chat said it. Pass channel + chat_id to search one chat across all of its sessions — do this before claiming something was never said in a chat.',
		schema: {
			query: z.string().describe('FTS5 search query (supports AND, OR, NOT, phrase "quotes")'),
			limit: z.number().optional().default(20).describe('Maximum number of results'),
			channel: z
				.enum(['tg', 'wa', 'dc', 'sl'])
				.optional()
				.describe('With chat_id: only this chat (all of its sessions)'),
			chat_id: z.string().optional().describe('Channel-specific chat id; requires channel'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			if ((args.channel && !args.chat_id) || (!args.channel && args.chat_id)) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'channel and chat_id must be given together' }),
						},
					],
				}
			}
			const filter =
				args.channel && args.chat_id ? { channel: args.channel, chatId: args.chat_id } : undefined
			const results = await searchMessages(args.query, args.limit, env, filter)
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
