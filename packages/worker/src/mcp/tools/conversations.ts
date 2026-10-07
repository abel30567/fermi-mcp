import { z } from 'zod'
import { getConversationHistory } from '../../lib/conversation.ts'
import { getProfileDocs } from '../../lib/profile-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerConversationTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'context_bootstrap',
		description:
			'One-call context snapshot for a channel chat: profile docs (agent notes + user model), prior session summary, recent transcript, and pinned memories. Call this FIRST when handling a queued task. The transcript is only the last 20 turns (history_truncated tells you older turns exist): before claiming something was or was not said in this chat, page back with conversation_history (before = oldest_at) or run session_search with this channel + chat_id.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc', 'sl']).describe('Channel of the chat'),
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
							history_truncated: history.has_more,
							oldest_at: history.oldest_at,
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
			"Transcript for a channel chat (user + assistant turns) across ALL its sessions, oldest first, newest window by default. Page back by passing before = the previous page's oldest_at until has_more is false. To find a specific past statement, session_search with channel + chat_id is faster.",
		schema: {
			channel: z.enum(['tg', 'wa', 'dc', 'sl']).describe('Channel of the chat'),
			chat_id: z.string().describe('Channel-specific chat id'),
			limit: z.number().int().min(1).max(50).optional().default(20).describe('Turns to return'),
			before: z
				.number()
				.int()
				.positive()
				.optional()
				.describe('Only turns older than this ms timestamp (use oldest_at from the previous page)'),
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
				args.before,
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
