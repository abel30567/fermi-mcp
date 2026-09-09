import { z } from 'zod'
import { getConversationHistory } from '../../lib/conversation.ts'
import { getProfileDocs } from '../../lib/profile-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerConversationTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'context_bootstrap',
		description:
			'One-call context snapshot for a channel chat: profile docs (agent notes + user model), prior session summary, recent transcript, and pinned memories. Call this FIRST when handling a queued task.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc']).describe('Channel of the chat'),
			chat_id: z.string().describe('Channel-specific chat id (from the task row)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const [profile, history, pinned] = await Promise.all([
				getProfileDocs(env.FERMI_DB),
				getConversationHistory(env.FERMI_DB, args.channel, args.chat_id, 20),
				env.FERMI_DB.prepare(
					'SELECT kind, body FROM memory WHERE pinned = 1 AND decayed_at IS NULL ORDER BY created_at DESC LIMIT 5',
				).all<{ kind: string; body: string }>(),
			])
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							agent_doc: profile.agent,
							user_doc: profile.user,
							prior_summary: history.prior_summary,
							history: history.messages,
							pinned_memories: pinned.results,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'conversation_history',
		description:
			'Recent transcript for a channel chat (user + assistant turns), oldest first. Use for deeper lookups beyond the context_bootstrap window.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc']).describe('Channel of the chat'),
			chat_id: z.string().describe('Channel-specific chat id'),
			limit: z.number().int().min(1).max(50).optional().default(20).describe('Turns to return'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const history = await getConversationHistory(
				env.FERMI_DB,
				args.channel,
				args.chat_id,
				args.limit,
			)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ ...history, total: history.messages.length }),
					},
				],
			}
		},
	})
}
