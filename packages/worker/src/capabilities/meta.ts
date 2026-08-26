import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import { getUsageStats } from '../lib/usage-store.ts'

export function registerMetaCapabilities() {
	defineCapability({
		name: 'usage_stats',
		domain: 'meta',
		description:
			'Aggregate tool-call usage from the audit log: call counts, success/denied breakdown, result payload sizes, estimated token consumption, and durations. Use to find heavily-used or expensive tools worth optimizing or removing.',
		inputSchema: z.object({
			since: z
				.string()
				.optional()
				.describe("Window start: relative like '7d'/'24h' or epoch ms. Default '30d'."),
			group_by: z.enum(['tool', 'day', 'risk', 'outcome']).default('tool'),
			tool: z.string().optional().describe('Restrict stats to a single tool name'),
			sort: z.enum(['calls', 'est_tokens']).default('calls'),
			limit: z.number().int().min(1).max(100).default(25),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['usage', 'analytics', 'stats', 'telemetry', 'tokens', 'audit', 'metrics'],
		handler: async (args, env) => getUsageStats(args, env),
	})
}
