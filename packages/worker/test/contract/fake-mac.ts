// The macOS bridge (MACOS_MCP_URL = http://mac.test) as contract tests see it.
// setup.ts answers every mac.test request with macBridgeReply(): 503 (bridge
// offline) unless a test installs a handler with setMacBridge(). The handler
// lives on globalThis because setup.ts registers its interceptor once per test
// file, and the first one registered answers for every later file.

export interface MacRequest {
	path: string
	method: string
	headers: Record<string, string>
	body: unknown
}

export interface MacReply {
	statusCode: number
	data?: string
	responseOptions?: { headers?: Record<string, string> }
}

type Handler = (req: MacRequest) => MacReply

const slot = globalThis as { __fermiMacBridge?: Handler }

export function setMacBridge(handler: Handler | undefined): void {
	slot.__fermiMacBridge = handler
}

export function macBridgeReply(opts: {
	path: string
	method: string
	headers?: unknown
	body?: unknown
}): MacReply {
	const handler = slot.__fermiMacBridge
	if (!handler) {
		return {
			statusCode: 503,
			data: JSON.stringify({ error: 'mac bridge mocked offline in contract tests' }),
		}
	}
	return handler({
		path: opts.path,
		method: opts.method,
		headers: Object.fromEntries(
			Object.entries((opts.headers ?? {}) as Record<string, string>).map(([k, v]) => [
				k.toLowerCase(),
				v,
			]),
		),
		body: opts.body ? JSON.parse(String(opts.body)) : undefined,
	})
}
