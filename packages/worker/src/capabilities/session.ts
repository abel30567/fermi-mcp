import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import { searchMessages, setSessionMode } from '../lib/session-store.ts'

export function registerSessionCapabilities() {
	defineCapability({
		name: 'session_search',
		domain: 'session',
		description: 'Full-text search across session messages.',
		inputSchema: z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(20),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['session', 'search', 'messages', 'fts'],
		handler: async (args, env) => {
			const results = await searchMessages(args.query, args.limit, env)
			return { results, total: results.length }
		},
	})

	defineCapability({
		name: 'session_set_mode',
		domain: 'session',
		description:
			'Switch session mode at the DB layer. Note: in-memory agent state will refresh on next MCP request.',
		inputSchema: z.object({ mode: z.enum(['chat', 'plan', 'execute']) }),
		scope: ['read'],
		risk: 'low',
		readOnly: false,
		keywords: ['session', 'mode', 'plan', 'chat', 'execute'],
		handler: async (args, env) => {
			// Capability has no agent reference; uses no session id. DB-only update of caller's
			// session is unreachable here, so this capability returns guidance instead.
			return {
				note: 'session_set_mode is MCP-only; capability cannot resolve caller session.',
				requested_mode: args.mode,
			}
		},
	})
}
