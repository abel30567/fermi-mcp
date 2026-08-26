import { z } from 'zod'
import {
	deleteMemory,
	listRecentMemories,
	recallMemories,
	updateMemory,
	writeMemory,
} from '../../lib/memory-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerMemoryTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'memory_recall',
		description:
			'Query memories by keyword. Returns matching non-decayed memories, pinned first by default. For procedural how-to knowledge, call skill_search first and use this as the fallback.',
		schema: {
			query: z.string().describe('Search term to match against memory body'),
			limit: z.number().optional().default(10).describe('Maximum number of results to return'),
			sort_by: z
				.enum(['relevance', 'created_at'])
				.optional()
				.default('relevance')
				.describe(
					"Result ordering: 'relevance' (pinned-first then newest) or 'created_at' (pure recency)",
				),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const results = await recallMemories(args.query, args.limit, env, args.sort_by)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(
							{ query: args.query, sort_by: args.sort_by, results, total: results.length },
							null,
							2,
						),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'memory_list_recent',
		description: 'List the N most recently created non-decayed memories, newest first.',
		schema: {
			limit: z
				.number()
				.optional()
				.default(10)
				.describe('Maximum number of memories to return (1-100)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const results = await listRecentMemories(args.limit, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ results, total: results.length }, null, 2),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'memory_write',
		description: 'Store a new memory. Optionally pin it so it never decays.',
		schema: {
			kind: z.enum(['fact', 'preference', 'event']).describe('Category of memory'),
			body: z.string().describe('The memory content'),
			pinned: z
				.boolean()
				.optional()
				.default(false)
				.describe('Pin this memory to prevent automatic decay'),
		},
		scope: ['write:memory'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const written = await writeMemory(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(written) }],
			}
		},
	})

	defineTool(agent, {
		name: 'memory_update',
		description: 'Update an existing memory. Only provided fields are changed.',
		schema: {
			id: z.number().describe('The memory ID to update'),
			patch: z
				.object({
					kind: z.enum(['fact', 'preference', 'event']).optional(),
					body: z.string().optional(),
					pinned: z.boolean().optional(),
				})
				.describe('Fields to update'),
		},
		scope: ['write:memory'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const res = await updateMemory(args.id, args.patch, env)
			if (!res.updated && res.changes === 0 && Object.keys(args.patch).length === 0) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'No fields to update' }),
						},
					],
				}
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ id: args.id, updated: res.updated, changes: res.changes }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'memory_delete',
		description: 'Soft-delete a memory by marking it as decayed.',
		schema: {
			id: z.number().describe('The memory ID to soft-delete'),
		},
		scope: ['write:memory'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const res = await deleteMemory(args.id, env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ id: args.id, deleted: res.deleted }) },
				],
			}
		},
	})
}
