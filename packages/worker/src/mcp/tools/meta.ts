import { z } from 'zod'
import { registerAllCapabilities } from '../../capabilities/index.ts'
import { getCapabilityRegistry } from '../../lib/capability.ts'
import { defineTool } from '../../lib/tool.ts'
import { getUsageStats } from '../../lib/usage-store.ts'
import type { FermiMCP } from '../index.ts'

export function registerMetaTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'meta_list_capabilities',
		description:
			'List all capabilities available to the sandbox `execute` tool. Each entry includes the JSON Schema for invocation.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async () => {
			registerAllCapabilities()
			const items = getCapabilityRegistry().map((c) => {
				const shape = c.inputSchema.shape as Record<string, { _def?: { description?: string } }>
				const fields: Record<string, string> = {}
				for (const [k, v] of Object.entries(shape)) {
					fields[k] = v?._def?.description ?? ''
				}
				return {
					name: c.name,
					domain: c.domain,
					description: c.description,
					scope: c.scope,
					risk: c.risk,
					readOnly: c.readOnly ?? false,
					idempotent: c.idempotent ?? false,
					destructive: c.destructive ?? false,
					keywords: c.keywords ?? [],
					tags: c.tags ?? [],
					fields,
				}
			})
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ count: items.length, capabilities: items }, null, 2),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'usage_stats',
		description:
			'Aggregate tool-call usage from the audit log: call counts, success/denied breakdown, result payload sizes, estimated token consumption, and durations. Use to find heavily-used or expensive tools worth optimizing or removing.',
		schema: {
			since: z
				.string()
				.optional()
				.describe("Window start: relative like '7d'/'24h' or epoch ms. Default '30d'."),
			group_by: z
				.enum(['tool', 'day', 'risk', 'outcome'])
				.optional()
				.default('tool')
				.describe('Aggregation dimension'),
			tool: z.string().optional().describe('Restrict stats to a single tool name'),
			sort: z
				.enum(['calls', 'est_tokens'])
				.optional()
				.default('calls')
				.describe('Row ordering: most-called or most token-hungry first'),
			limit: z.number().optional().default(25).describe('Maximum number of rows (1-100)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const stats = await getUsageStats(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
			}
		},
	})
}
