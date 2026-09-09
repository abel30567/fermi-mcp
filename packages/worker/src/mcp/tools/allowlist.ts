import { z } from 'zod'
import { addToAllowlist, listAllowlist, removeFromAllowlist } from '../../lib/allowlist-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerAllowlistTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'allowlist_add',
		description:
			'Allow a sender to use a channel (tg/wa/dc) without pairing. Idempotent — re-adding refreshes the entry. See allowlist_list for usage stats.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc']).describe('Channel the sender belongs to'),
			sender_id: z.string().describe('Channel-specific sender id'),
			note: z.string().optional().describe('Optional label, e.g. "guest" or a name'),
		},
		scope: ['write:channels'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const result = await addToAllowlist(env.FERMI_DB, {
				channel: args.channel,
				senderId: args.sender_id,
				note: args.note,
				addedBy: 'mcp',
			})
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})

	defineTool(agent, {
		name: 'allowlist_remove',
		description:
			'Remove a sender from a channel allowlist. Returns not_found when the sender was not allowlisted.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc']).describe('Channel the sender belongs to'),
			sender_id: z.string().describe('Channel-specific sender id'),
		},
		scope: ['write:channels'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const result = await removeFromAllowlist(env.FERMI_DB, args.channel, args.sender_id)
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})

	defineTool(agent, {
		name: 'allowlist_list',
		description:
			'List every allowlisted sender with usage stats (tasks_total, tasks_7d, last_used_at) — shows who uses the bot most, ordered by total tasks.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const entries = await listAllowlist(env.FERMI_DB)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ entries, total: entries.length }) },
				],
			}
		},
	})
}
