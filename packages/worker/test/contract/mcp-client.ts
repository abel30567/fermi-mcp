import { SELF } from 'cloudflare:test'

// Minimal streamable-HTTP MCP client over SELF.fetch: just enough JSON-RPC to
// initialize a session, list tools and call one. Parses JSON and SSE bodies.

export interface Tool {
	name: string
	description?: string
	inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
}

export interface ToolResult {
	content: Array<{ type: string; text?: string }>
	isError?: boolean
}

interface JsonRpcResponse {
	jsonrpc: '2.0'
	id?: number | string | null
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

const ORIGIN = 'http://fermi.test'

export async function parseRpcBody(res: Response): Promise<JsonRpcResponse[]> {
	const text = await res.text()
	if (!text) return []
	if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
		const messages: JsonRpcResponse[] = []
		for (const event of text.split(/\r?\n\r?\n/)) {
			const data = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n')
			if (data) messages.push(JSON.parse(data))
		}
		return messages
	}
	const parsed = JSON.parse(text)
	return Array.isArray(parsed) ? parsed : [parsed]
}

export class McpClient {
	sessionId?: string
	private nextId = 1

	constructor(
		private readonly path = '/mcp',
		private readonly headers: Record<string, string> = {},
	) {}

	private async post(message: Record<string, unknown>): Promise<Response> {
		return SELF.fetch(`${ORIGIN}${this.path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
				...this.headers,
			},
			body: JSON.stringify(message),
		})
	}

	async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.nextId++
		const res = await this.post({ jsonrpc: '2.0', id, method, params })
		if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${await res.text()}`)
		const reply = (await parseRpcBody(res)).find((m) => m.id === id)
		if (!reply) throw new Error(`${method}: no response for id ${id}`)
		if (reply.error) throw new Error(`${method}: ${reply.error.code} ${reply.error.message}`)
		return reply.result as T
	}

	async initialize(): Promise<{ serverInfo: { name: string } }> {
		const id = this.nextId++
		const res = await this.post({
			jsonrpc: '2.0',
			id,
			method: 'initialize',
			params: {
				protocolVersion: '2025-03-26',
				capabilities: {},
				clientInfo: { name: 'fermi-contract-test', version: '0.0.0' },
			},
		})
		if (!res.ok) throw new Error(`initialize: HTTP ${res.status} ${await res.text()}`)
		this.sessionId = res.headers.get('mcp-session-id') ?? undefined
		if (!this.sessionId) throw new Error('initialize: no mcp-session-id header')
		const reply = (await parseRpcBody(res)).find((m) => m.id === id)
		if (!reply?.result) throw new Error(`initialize: ${JSON.stringify(reply?.error)}`)
		const ack = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
		await ack.body?.cancel()
		return reply.result as { serverInfo: { name: string } }
	}

	async listTools(): Promise<Tool[]> {
		const tools: Tool[] = []
		let cursor: string | undefined
		do {
			const page = await this.request<{ tools: Tool[]; nextCursor?: string }>(
				'tools/list',
				cursor ? { cursor } : {},
			)
			tools.push(...page.tools)
			cursor = page.nextCursor
		} while (cursor)
		return tools
	}

	callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
		return this.request<ToolResult>('tools/call', { name, arguments: args })
	}
}

/** JSON body of the first text content block of a tool result. */
export function resultJson<T = Record<string, unknown>>(result: ToolResult): T {
	const text = result.content.find((c) => c.type === 'text')?.text
	if (text === undefined) throw new Error(`no text content: ${JSON.stringify(result)}`)
	return JSON.parse(text) as T
}
