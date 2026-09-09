import { z } from 'zod'
import { defineTool } from '../../lib/tool.ts'
import {
	captureWebSession,
	getWebSessionMeta,
	invalidateWebSession,
	listWebSessions,
} from '../../lib/web-session-store.ts'
import type { FermiMCP } from '../index.ts'

const json = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

export function registerWebSessionTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'web_session_capture',
		description:
			'Store a logged-in web session (Playwright storageState JSON) captured once on a residential-IP browser, so cloud boxes can lease it — MFA once, replay N times. Set max_concurrent and allowed_boxes to scope replay.',
		schema: {
			name: z.string().min(1).describe('Session name, e.g. chatgpt'),
			site: z.string().min(1).describe('Origin the session is for, e.g. https://chatgpt.com'),
			storage_state: z.string().min(2).describe('Playwright storageState JSON (cookies + origins)'),
			max_concurrent: z
				.number()
				.int()
				.min(1)
				.optional()
				.default(1)
				.describe('Max simultaneous box leases'),
			allowed_boxes: z
				.array(z.string())
				.optional()
				.describe('Restrict to these box ids (empty = any box)'),
			ttl_seconds: z.number().int().positive().optional().describe('Session lifetime'),
		},
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const meta = await captureWebSession(env, {
				name: args.name,
				site: args.site,
				storageState: args.storage_state,
				maxConcurrent: args.max_concurrent,
				allowedBoxes: args.allowed_boxes,
				ttlSeconds: args.ttl_seconds,
			})
			return json({ ok: true, session: { ...meta } })
		},
	})

	defineTool(agent, {
		name: 'web_session_list',
		description: 'List captured web sessions with their concurrency caps and active lease counts.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => json({ sessions: await listWebSessions(env) }),
	})

	defineTool(agent, {
		name: 'web_session_get',
		description: 'Get one web session (metadata only — never returns the stored state).',
		schema: { name: z.string() },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const meta = await getWebSessionMeta(env, args.name)
			return json(meta ? { ok: true, session: meta } : { ok: false, error: 'not_found' })
		},
	})

	defineTool(agent, {
		name: 'web_session_invalidate',
		description:
			'Revoke a web session and release all active leases immediately — every box loses access on its next lease/refresh.',
		schema: { name: z.string() },
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => json(await invalidateWebSession(env, args.name)),
	})
}
