import { z } from 'zod'
import { BrowserActionSchema } from '../../lib/browser-actions.ts'
import {
	deleteBrowserSession,
	listBrowserSessions,
	updateBrowserSessionStatus,
	upsertBrowserSession,
} from '../../lib/browser-session-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

function getSessionStub(sessionId: string, env: Env) {
	return env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(sessionId))
}

async function callDo(
	stub: DurableObjectStub,
	path: string,
	body?: unknown,
): Promise<Record<string, unknown>> {
	const res = await stub.fetch(`http://do${path}`, {
		method: body !== undefined ? 'POST' : 'GET',
		headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	})
	const json = (await res.json()) as Record<string, unknown>
	if (!res.ok) {
		throw new Error((json.error as string | undefined) ?? `DO returned ${res.status}`)
	}
	return json
}

export function registerBrowserSessionTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'browser_session_launch',
		description:
			'Launch a persistent Cloudflare Browser Run session. Returns a session_id for subsequent calls and a live_view_url you can share with the user so they can watch the browser in real time.',
		schema: {
			label: z.string().optional().describe('Human-readable label for this session'),
			keep_alive_ms: z
				.number()
				.min(10_000)
				.max(600_000)
				.default(120_000)
				.optional()
				.describe('How long (ms) to keep the browser alive between actions (default 120s)'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const sessionId = crypto.randomUUID()
			const stub = getSessionStub(sessionId, env)
			const result = await callDo(stub, '/launch', {
				label: args.label,
				keep_alive_ms: args.keep_alive_ms,
			})
			const now = Date.now()
			await upsertBrowserSession(
				{
					id: sessionId,
					label: (args.label as string | undefined) ?? null,
					live_view_url: (result.live_view_url as string | undefined) ?? null,
					status: 'active',
					created_at: now,
					last_activity: now,
					closed_at: null,
				},
				env,
			)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ session_id: sessionId, ...result }, null, 2),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'browser_session_action',
		description:
			'Execute a sequence of browser actions within an existing persistent session. The browser keeps its cookies, auth state, and page between calls. Same 13 action types as browser_action (goto, type, click, waitFor, screenshot, extract, evaluate, getCookies, setCookies, select, hover, scrollTo, wait).',
		schema: {
			session_id: z.string().uuid().describe('Session ID returned by browser_session_launch'),
			actions: z
				.array(BrowserActionSchema)
				.min(1)
				.max(50)
				.describe('Ordered list of browser actions to execute sequentially'),
			viewport: z
				.object({
					width: z.number().default(1280),
					height: z.number().default(720),
				})
				.optional()
				.describe('Optional viewport override'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const stub = getSessionStub(args.session_id, env)
			const result = await callDo(stub, '/action', {
				actions: args.actions,
				viewport: args.viewport,
			})
			await updateBrowserSessionStatus(args.session_id, 'active', env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			}
		},
	})

	defineTool(agent, {
		name: 'browser_session_request_human',
		description:
			'Pause automation and request human intervention (e.g. for login walls, CAPTCHAs, or 2FA). Returns the live_view_url — show it to the user so they can take control of the browser. Call browser_session_resume when the user signals they are done.',
		schema: {
			session_id: z.string().uuid().describe('Session ID returned by browser_session_launch'),
			message: z
				.string()
				.optional()
				.describe('Instructions for the human, e.g. "Please log into Shopify and click Confirm"'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const stub = getSessionStub(args.session_id, env)
			const result = await callDo(stub, '/request_human', { message: args.message })
			await updateBrowserSessionStatus(args.session_id, 'waiting_for_human', env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			}
		},
	})

	defineTool(agent, {
		name: 'browser_session_resume',
		description:
			'Resume a session that was paused for human intervention. Call this after the user signals they have finished (logged in, solved CAPTCHA, etc.).',
		schema: {
			session_id: z.string().uuid().describe('Session ID returned by browser_session_launch'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const stub = getSessionStub(args.session_id, env)
			const result = await callDo(stub, '/resume')
			await updateBrowserSessionStatus(args.session_id, 'active', env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			}
		},
	})

	defineTool(agent, {
		name: 'browser_session_close',
		description: 'Close a persistent browser session and free its resources.',
		schema: {
			session_id: z.string().uuid().describe('Session ID returned by browser_session_launch'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const stub = getSessionStub(args.session_id, env)
			const result = await callDo(stub, '/close')
			await deleteBrowserSession(args.session_id, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			}
		},
	})

	defineTool(agent, {
		name: 'browser_session_list',
		description: 'List all active persistent browser sessions.',
		schema: {},
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const sessions = await listBrowserSessions(env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ sessions }, null, 2) }],
			}
		},
	})
}
