import { z } from 'zod'
import {
	BrowserActionInput,
	BrowserActionSchema,
	runBrowserActions,
} from '../lib/browser-actions.ts'
import {
	deleteBrowserSession,
	listBrowserSessions,
	updateBrowserSessionStatus,
	upsertBrowserSession,
} from '../lib/browser-session-store.ts'
import { extractText, navigate, screenshot } from '../lib/browser-store.ts'
import { defineCapability } from '../lib/capability.ts'

export function registerBrowserCapabilities() {
	defineCapability({
		name: 'browser_navigate',
		domain: 'browser',
		description: 'Navigate a cloud browser to a URL and return title + status.',
		inputSchema: z.object({ url: z.string().url() }),
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		readOnly: true,
		idempotent: false,
		keywords: ['browser', 'navigate', 'web', 'page'],
		handler: async (args, env) => navigate(args.url, env),
	})

	defineCapability({
		name: 'browser_screenshot',
		domain: 'browser',
		description: 'Take a PNG screenshot of a URL.',
		inputSchema: z.object({ url: z.string().url() }),
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		readOnly: true,
		keywords: ['browser', 'screenshot', 'png', 'image'],
		handler: async (args, env) => screenshot(args.url, env),
	})

	defineCapability({
		name: 'browser_extract',
		domain: 'browser',
		description: 'Extract textContent from a CSS selector (default: body).',
		inputSchema: z.object({ url: z.string().url(), selector: z.string().optional() }),
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		readOnly: true,
		keywords: ['browser', 'extract', 'text', 'css'],
		handler: async (args, env) => extractText(args.url, args.selector, env),
	})

	defineCapability({
		name: 'browser_action',
		domain: 'browser',
		description:
			'Execute a sequence of browser actions (goto, type, click, waitFor, screenshot, extract, evaluate, getCookies, setCookies, select, hover, scrollTo, wait) within a single Puppeteer session. Supports secret placeholder resolution in type.text fields. All actions run sequentially; execution stops on first error.',
		inputSchema: BrowserActionInput,
		scope: ['network', 'browser:cloud'],
		risk: 'high',
		readOnly: false,
		idempotent: false,
		keywords: ['browser', 'action', 'automate', 'form', 'login', 'click', 'type', 'puppeteer'],
		handler: async (args, env) => runBrowserActions(args, env),
	})

	defineCapability({
		name: 'browser_session_launch',
		domain: 'browser',
		description: 'Launch a persistent Browser Run session. Returns session_id + live_view_url.',
		inputSchema: z.object({
			label: z.string().optional(),
			keep_alive_ms: z.number().min(10_000).max(600_000).default(120_000).optional(),
		}),
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		readOnly: false,
		keywords: ['browser', 'session', 'launch', 'persistent', 'live'],
		handler: async (args, env) => {
			const sessionId = crypto.randomUUID()
			const stub = env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(sessionId))
			const res = await stub.fetch('http://do/launch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: args.label, keep_alive_ms: args.keep_alive_ms }),
			})
			const result = (await res.json()) as Record<string, unknown>
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
			return { session_id: sessionId, ...result }
		},
	})

	defineCapability({
		name: 'browser_session_action',
		domain: 'browser',
		description:
			'Execute browser actions on an existing persistent session (retains cookies and auth state).',
		inputSchema: z.object({
			session_id: z.string().uuid(),
			actions: z.array(BrowserActionSchema).min(1).max(50),
			viewport: z
				.object({ width: z.number().default(1280), height: z.number().default(720) })
				.optional(),
		}),
		scope: ['network', 'browser:cloud'],
		risk: 'high',
		readOnly: false,
		keywords: ['browser', 'session', 'action', 'persistent', 'automate'],
		handler: async (args, env) => {
			const stub = env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(args.session_id))
			const res = await stub.fetch('http://do/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ actions: args.actions, viewport: args.viewport }),
			})
			const result = await res.json()
			await updateBrowserSessionStatus(args.session_id, 'active', env)
			return result
		},
	})

	defineCapability({
		name: 'browser_session_request_human',
		domain: 'browser',
		description: 'Pause a browser session and request human intervention. Returns live_view_url.',
		inputSchema: z.object({ session_id: z.string().uuid(), message: z.string().optional() }),
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		readOnly: false,
		keywords: ['browser', 'session', 'human', 'intervention', 'captcha', 'login'],
		handler: async (args, env) => {
			const stub = env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(args.session_id))
			const res = await stub.fetch('http://do/request_human', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: args.message }),
			})
			const result = await res.json()
			await updateBrowserSessionStatus(args.session_id, 'waiting_for_human', env)
			return result
		},
	})

	defineCapability({
		name: 'browser_session_resume',
		domain: 'browser',
		description: 'Resume a paused browser session after human intervention.',
		inputSchema: z.object({ session_id: z.string().uuid() }),
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		readOnly: false,
		keywords: ['browser', 'session', 'resume'],
		handler: async (args, env) => {
			const stub = env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(args.session_id))
			const res = await stub.fetch('http://do/resume', { method: 'POST' })
			const result = await res.json()
			await updateBrowserSessionStatus(args.session_id, 'active', env)
			return result
		},
	})

	defineCapability({
		name: 'browser_session_close',
		domain: 'browser',
		description: 'Close and destroy a persistent browser session.',
		inputSchema: z.object({ session_id: z.string().uuid() }),
		scope: ['network', 'browser:cloud'],
		risk: 'med',
		readOnly: false,
		keywords: ['browser', 'session', 'close', 'destroy'],
		handler: async (args, env) => {
			const stub = env.BROWSER_SESSION.get(env.BROWSER_SESSION.idFromName(args.session_id))
			const res = await stub.fetch('http://do/close', { method: 'POST' })
			const result = await res.json()
			await deleteBrowserSession(args.session_id, env)
			return result
		},
	})

	defineCapability({
		name: 'browser_session_list',
		domain: 'browser',
		description: 'List all active persistent browser sessions.',
		inputSchema: z.object({}),
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		readOnly: true,
		keywords: ['browser', 'session', 'list'],
		handler: async (_args, env) => ({ sessions: await listBrowserSessions(env) }),
	})
}
