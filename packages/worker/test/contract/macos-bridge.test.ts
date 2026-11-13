import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import type { RiskLevel } from '../../src/lib/tool.ts'
import { callApproved } from './approval.ts'
import { describeTool } from './describe-tool.ts'
import { type MacRequest, setMacBridge } from './fake-mac.ts'
import { McpClient, resultJson } from './mcp-client.ts'
import { registeredTools } from './registry.ts'

// Every mac_* tool proxies to the local Mac's MCP server at MACOS_MCP_URL/mcp.
// The fake bridge below answers the JSON-RPC handshake and echoes tools/call,
// so each case asserts the exact request the worker sent.

const SESSION = 'mac-session-1'
const TOKEN = 'mac-contract-token' // MACOS_MCP_TOKEN in wrangler.test.jsonc

let client: McpClient
let risk: Map<string, RiskLevel>
let toolCalls: MacRequest[]

beforeAll(async () => {
	risk = new Map((await registeredTools()).map((d) => [d.name, d.risk]))
})

beforeEach(async () => {
	toolCalls = []
	setMacBridge((req) => {
		const rpc = req.body as { id?: number; method: string }
		if (rpc.method === 'initialize') {
			return {
				statusCode: 200,
				data: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { capabilities: {} } }),
				responseOptions: { headers: { 'mcp-session-id': SESSION } },
			}
		}
		if (rpc.method === 'notifications/initialized') return { statusCode: 202 }
		toolCalls.push(req)
		const text = JSON.stringify({ echoed: (req.body as { params: { name: string } }).params.name })
		return {
			statusCode: 200,
			data: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text }] } })}\n\n`,
			responseOptions: { headers: { 'content-type': 'text/event-stream' } },
		}
	})
	client = new McpClient()
	await client.initialize()
})

afterEach(() => setMacBridge(undefined))

async function call(name: string, args: Record<string, unknown>) {
	return risk.get(name) === 'high' ? callApproved(client, name, args) : client.callTool(name, args)
}

/** The tool sends one authenticated tools/call for itself with the args unchanged. */
function proxies(name: string, args: Record<string, unknown>) {
	it('sends tools/call to MACOS_MCP_URL/mcp with the args unchanged', async () => {
		expect(resultJson(await call(name, args))).toEqual({ echoed: name })
		expect(toolCalls).toHaveLength(1)
		const [req] = toolCalls
		expect(req.method).toBe('POST')
		expect(req.path).toBe('/mcp')
		expect(req.headers).toMatchObject({
			authorization: `Bearer ${TOKEN}`,
			'mcp-session-id': SESSION,
		})
		expect(req.body).toEqual({
			jsonrpc: '2.0',
			id: expect.any(Number),
			method: 'tools/call',
			params: { name, arguments: args },
		})
	})

	it('returns agent_offline when the bridge is down', async () => {
		setMacBridge(undefined)
		expect(resultJson(await call(name, args))).toMatchObject({ error: 'agent_offline' })
	})
}

describeTool('mac_shell', () => proxies('mac_shell', { command: 'echo hi', cwd: '/tmp' }))
describeTool('mac_applescript', () =>
	proxies('mac_applescript', { script: 'return 1', timeout_ms: 500 }),
)
describeTool('mac_jxa', () => proxies('mac_jxa', { script: 'Application("Finder").name()' }))
describeTool('mac_file_read', () =>
	proxies('mac_file_read', { path: '/tmp/a.txt', encoding: 'base64' }),
)
describeTool('mac_file_write', () =>
	proxies('mac_file_write', { path: '/tmp/a.txt', content: 'x', append: true }),
)
describeTool('mac_file_list', () => proxies('mac_file_list', { path: '/tmp', recursive: false }))
describeTool('mac_file_search', () => proxies('mac_file_search', { query: 'notes', path: '/tmp' }))
describeTool('mac_file_move', () =>
	proxies('mac_file_move', { source: '/tmp/a.txt', destination: '/tmp/b.txt' }),
)
describeTool('mac_file_delete', () => proxies('mac_file_delete', { path: '/tmp/b.txt' }))
describeTool('mac_file_info', () => proxies('mac_file_info', { path: '/tmp' }))
describeTool('mac_system_info', () => proxies('mac_system_info', {}))
describeTool('mac_browser_launch', () =>
	proxies('mac_browser_launch', { label: 'shop', headless: true }),
)
describeTool('mac_browser_action', () =>
	proxies('mac_browser_action', {
		session_id: 's1',
		actions: [{ type: 'goto', url: 'https://example.com' }],
	}),
)
describeTool('mac_browser_close', () => proxies('mac_browser_close', { session_id: 's1' }))
describeTool('mac_browser_list', () => proxies('mac_browser_list', {}))
describeTool('mac_screenshot', () => proxies('mac_screenshot', { region: '0,0,100,100' }))
describeTool('mac_screen_ocr', () => proxies('mac_screen_ocr', { region: '0,0,100,100' }))
describeTool('mac_clipboard_get', () => proxies('mac_clipboard_get', { format: 'text' }))
describeTool('mac_clipboard_set', () => proxies('mac_clipboard_set', { text: 'copied' }))
describeTool('mac_notification', () =>
	proxies('mac_notification', { title: 'Fermi', message: 'done', sound: false }),
)
describeTool('mac_open', () =>
	proxies('mac_open', { target: 'https://example.com', app: 'Safari' }),
)
describeTool('mac_chrome_open', () =>
	proxies('mac_chrome_open', { label: 'shop', url: 'https://example.com' }),
)
describeTool('mac_keystroke', () =>
	proxies('mac_keystroke', { keys: 'return', modifiers: ['command'], human: true }),
)
describeTool('mac_click', () =>
	proxies('mac_click', { x: 10, y: 20, button: 'left', double: true }),
)
describeTool('mac_app_list', () => proxies('mac_app_list', {}))
describeTool('mac_app_activate', () => proxies('mac_app_activate', { name: 'Finder' }))
