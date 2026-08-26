import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import { runRetriever } from '../lib/retrievers-store.ts'

export function registerRetrieverCapabilities() {
	defineCapability({
		name: 'retriever_run',
		domain: 'retrievers',
		description:
			'Run a stored named D1 query. Pass params as `{paramName: value}` matching :paramName placeholders.',
		inputSchema: z.object({
			name: z.string().min(1),
			params: z.record(z.unknown()).default({}),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['retriever', 'query', 'sql', 'd1'],
		handler: async (args, env) => runRetriever(args.name, args.params, env),
	})
}
