import { z } from 'zod'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

async function mcpRequest(
	env: Env,
	method: string,
	params: Record<string, unknown>,
	id: number,
	sessionId?: string,
): Promise<{ data: Record<string, unknown>; sessionId?: string }> {
	const url = env.MACOS_MCP_URL
	const token = env.MACOS_MCP_TOKEN
	if (!url || !token) {
		throw new Error('MACOS_MCP_URL and MACOS_MCP_TOKEN must be configured')
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
	}
	if (sessionId) headers['mcp-session-id'] = sessionId

	const res = await fetch(`${url}/mcp`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	})

	if (res.status === 401) throw new Error('MacOS MCP auth failed — check MACOS_MCP_TOKEN')
	if (!res.ok) throw new Error(`MacOS MCP returned ${res.status}`)

	const newSessionId = res.headers.get('mcp-session-id') ?? sessionId
	const raw = await res.text()
	const dataLine = raw.split('\n').find((l) => l.startsWith('data: '))
	if (!dataLine) {
		try {
			return { data: JSON.parse(raw), sessionId: newSessionId }
		} catch {
			throw new Error(`Unexpected response from MacOS MCP: ${raw.slice(0, 200)}`)
		}
	}

	return { data: JSON.parse(dataLine.slice(6)), sessionId: newSessionId }
}

let cachedSessionId: string | undefined

async function getSessionId(env: Env): Promise<string> {
	if (cachedSessionId) return cachedSessionId

	const { data, sessionId } = await mcpRequest(
		env,
		'initialize',
		{
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'fermi-worker', version: '1.0' },
		},
		1,
	)

	if (!sessionId) throw new Error('MacOS MCP did not return session ID')

	// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC dynamic response
	if (!(data as any).result?.capabilities) {
		throw new Error(`MacOS MCP initialize failed: ${JSON.stringify(data)}`)
	}

	await mcpRequest(env, 'notifications/initialized', {}, 0, sessionId).catch(() => {})

	cachedSessionId = sessionId
	return sessionId
}

async function callRemoteTool(
	env: Env,
	toolName: string,
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
	let sessionId: string
	try {
		sessionId = await getSessionId(env)
	} catch (err) {
		return {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify({
						error: 'agent_offline',
						message: err instanceof Error ? err.message : String(err),
					}),
				},
			],
		}
	}

	try {
		const { data } = await mcpRequest(
			env,
			'tools/call',
			{ name: toolName, arguments: args },
			Date.now(),
			sessionId,
		)

		// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC dynamic response
		const result = (data as any).result
		if (!result) {
			// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC error response
			const error = (data as any).error
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							error: 'remote_error',
							message: error?.message ?? JSON.stringify(data),
						}),
					},
				],
			}
		}

		const content = result.content.map(
			(c: { type: string; text?: string; data?: string; mimeType?: string }) => {
				if (c.type === 'image') {
					return {
						type: 'text' as const,
						text: JSON.stringify({
							image: true,
							mimeType: c.mimeType,
							data: c.data,
						}),
					}
				}
				return { type: 'text' as const, text: c.text ?? '' }
			},
		)

		return { content }
	} catch (err) {
		cachedSessionId = undefined
		return {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify({
						error: 'agent_offline',
						message: err instanceof Error ? err.message : String(err),
					}),
				},
			],
		}
	}
}

export function registerMacOSBridgeTools(agent: FermiMCP) {
	if (!agent.bindings.MACOS_MCP_URL) return

	defineTool(agent, {
		name: 'mac_shell',
		description:
			'[Local Mac] Execute a shell command via /bin/zsh on a local macOS machine. Returns stdout, stderr, and exit code.',
		schema: {
			command: z.string().describe('The shell command to execute'),
			cwd: z.string().optional().describe('Working directory'),
			timeout_ms: z.number().optional().describe('Timeout in ms (default: 30000)'),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_shell', args),
	})

	defineTool(agent, {
		name: 'mac_applescript',
		description: '[Local Mac] Execute AppleScript via osascript on a local macOS machine.',
		schema: {
			script: z.string().describe('AppleScript source code'),
			timeout_ms: z.number().optional().describe('Timeout in ms'),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_applescript', args),
	})

	defineTool(agent, {
		name: 'mac_jxa',
		description:
			'[Local Mac] Execute JavaScript for Automation (JXA) via osascript on a local macOS machine.',
		schema: {
			script: z.string().describe('JavaScript for Automation source code'),
			timeout_ms: z.number().optional().describe('Timeout in ms'),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_jxa', args),
	})

	defineTool(agent, {
		name: 'mac_file_read',
		description: '[Local Mac] Read a file from the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path to the file'),
			encoding: z.enum(['utf8', 'base64']).optional().describe('Encoding (default: utf8)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_read', args),
	})

	defineTool(agent, {
		name: 'mac_file_write',
		description: '[Local Mac] Write content to a file on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path'),
			content: z.string().describe('Content to write'),
			append: z.boolean().optional().describe('Append instead of overwrite'),
		},
		scope: ['write:filesystem'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_write', args),
	})

	defineTool(agent, {
		name: 'mac_file_list',
		description: '[Local Mac] List directory contents on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path to directory'),
			recursive: z.boolean().optional().describe('List recursively'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_list', args),
	})

	defineTool(agent, {
		name: 'mac_file_search',
		description: '[Local Mac] Search for files using macOS Spotlight (mdfind).',
		schema: {
			query: z.string().describe('Search query'),
			path: z.string().optional().describe('Limit search to this directory'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_search', args),
	})

	defineTool(agent, {
		name: 'mac_file_move',
		description: '[Local Mac] Move or rename a file on the macOS filesystem.',
		schema: {
			source: z.string().describe('Source path'),
			destination: z.string().describe('Destination path'),
		},
		scope: ['write:filesystem'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_move', args),
	})

	defineTool(agent, {
		name: 'mac_file_delete',
		description: '[Local Mac] Delete a file by moving it to the macOS Trash.',
		schema: {
			path: z.string().describe('Absolute path to delete'),
		},
		scope: ['write:filesystem'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_delete', args),
	})

	defineTool(agent, {
		name: 'mac_file_info',
		description: '[Local Mac] Get metadata about a file on the macOS filesystem.',
		schema: {
			path: z.string().describe('Absolute path'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_file_info', args),
	})

	defineTool(agent, {
		name: 'mac_system_info',
		description:
			'[Local Mac] Get system information: hostname, macOS version, CPU, memory, disk, uptime.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_system_info', args),
	})

	defineTool(agent, {
		name: 'mac_browser_launch',
		description:
			'[Local Mac] Launch a real Chrome browser session with Cloudflare Turnstile bypass on a local macOS machine. Returns session_id.',
		schema: {
			label: z.string().optional().describe('Session label for cookie persistence'),
			headless: z.boolean().optional().describe('Headless mode (default: false for stealth)'),
			proxy: z.string().optional().describe('Proxy URL'),
		},
		scope: ['browser:local'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_browser_launch', args),
	})

	defineTool(agent, {
		name: 'mac_browser_action',
		description:
			'[Local Mac] Execute actions in a browser session: goto, click, type, select, hover, scrollTo, waitFor, screenshot, extract, evaluate, getCookies, setCookies, wait.',
		schema: {
			session_id: z.string().describe('Browser session ID from mac_browser_launch'),
			actions: z
				.array(z.record(z.unknown()))
				.min(1)
				.describe('Array of actions to execute sequentially'),
		},
		scope: ['browser:local'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_browser_action', args),
	})

	defineTool(agent, {
		name: 'mac_browser_close',
		description: '[Local Mac] Close a browser session and clean up resources.',
		schema: {
			session_id: z.string().describe('Browser session ID to close'),
		},
		scope: ['browser:local'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_browser_close', args),
	})

	defineTool(agent, {
		name: 'mac_browser_list',
		description: '[Local Mac] List all active browser sessions on the local Mac.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_browser_list', args),
	})

	defineTool(agent, {
		name: 'mac_screenshot',
		description: '[Local Mac] Capture a screenshot. Returns base64 PNG, max 1568px wide.',
		schema: {
			region: z.string().optional().describe('Region as "x,y,width,height"'),
			app: z.string().optional().describe('App name to capture its window'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_screenshot', args),
	})

	defineTool(agent, {
		name: 'mac_screen_ocr',
		description: '[Local Mac] Capture screenshot and OCR via macOS Vision framework.',
		schema: {
			region: z.string().optional().describe('Region as "x,y,width,height"'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_screen_ocr', args),
	})

	defineTool(agent, {
		name: 'mac_clipboard_get',
		description: '[Local Mac] Read clipboard contents (text or image as base64).',
		schema: {
			format: z.enum(['text', 'image']).optional().describe('Format (default: text)'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_clipboard_get', args),
	})

	defineTool(agent, {
		name: 'mac_clipboard_set',
		description: '[Local Mac] Set clipboard text.',
		schema: {
			text: z.string().describe('Text to copy to clipboard'),
		},
		scope: ['write:clipboard'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_clipboard_set', args),
	})

	defineTool(agent, {
		name: 'mac_notification',
		description: '[Local Mac] Display a native macOS notification.',
		schema: {
			title: z.string().describe('Notification title'),
			message: z.string().describe('Notification message'),
			sound: z.boolean().optional().describe('Play sound'),
		},
		scope: ['write:notification'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_notification', args),
	})

	defineTool(agent, {
		name: 'mac_open',
		description: '[Local Mac] Open a file, URL, or application.',
		schema: {
			target: z.string().describe('File path, URL, or app name'),
			app: z.string().optional().describe('App to open with'),
		},
		scope: ['shell'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_open', args),
	})

	defineTool(agent, {
		name: 'mac_keystroke',
		description: '[Local Mac] Simulate keyboard input via AppleScript System Events.',
		schema: {
			keys: z.string().describe('Keys to type'),
			modifiers: z.array(z.string()).optional().describe('Modifier keys'),
			app: z.string().optional().describe('Target application'),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_keystroke', args),
	})

	defineTool(agent, {
		name: 'mac_click',
		description: '[Local Mac] Click at screen coordinates using cliclick.',
		schema: {
			x: z.number().describe('X coordinate'),
			y: z.number().describe('Y coordinate'),
			button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button'),
			double: z.boolean().optional().describe('Double click'),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => callRemoteTool(env, 'mac_click', args),
	})

	defineTool(agent, {
		name: 'mac_app_list',
		description: '[Local Mac] List currently running applications.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_app_list', args),
	})

	defineTool(agent, {
		name: 'mac_app_activate',
		description: '[Local Mac] Bring an application to the foreground.',
		schema: {
			name: z.string().describe('Application name'),
		},
		scope: ['shell'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => callRemoteTool(env, 'mac_app_activate', args),
	})
}
