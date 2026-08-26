import { z } from 'zod'
import {
	deleteRetriever,
	getRetriever,
	listRetrievers,
	putRetriever,
	runRetriever,
} from '../../lib/retrievers-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerRetrieverTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'retriever_set',
		description:
			'Define a named D1 query. Use :paramName placeholders that bindParams replaces with positional values. risk:high — arbitrary SQL.',
		schema: {
			name: z.string().min(1).max(64),
			sql: z.string().min(1),
			description: z.string().optional(),
			param_schema: z
				.record(z.string())
				.optional()
				.describe('Map of param name → human-readable description'),
		},
		scope: ['write:retrievers'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const r = await putRetriever(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ status: 'stored', ...r }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'retriever_list',
		description: 'List defined retrievers.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const items = await listRetrievers(env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ retrievers: items, total: items.length }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'retriever_get',
		description: 'Look up a retriever by name.',
		schema: { name: z.string().min(1) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const r = await getRetriever(args.name, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: r ? JSON.stringify(r) : JSON.stringify({ error: 'not_found', name: args.name }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'retriever_run',
		description: 'Run a stored retriever and return its rows.',
		schema: {
			name: z.string().min(1),
			params: z.record(z.unknown()).optional(),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			try {
				const out = await runRetriever(args.name, args.params ?? {}, env)
				return {
					content: [{ type: 'text' as const, text: JSON.stringify({ name: args.name, ...out }) }],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: err instanceof Error ? err.message : 'retriever_failed',
							}),
						},
					],
				}
			}
		},
	})

	defineTool(agent, {
		name: 'retriever_delete',
		description: 'Delete a retriever by name.',
		schema: { name: z.string().min(1) },
		scope: ['write:retrievers'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const ok = await deleteRetriever(args.name, env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ name: args.name, deleted: ok }) },
				],
			}
		},
	})
}
