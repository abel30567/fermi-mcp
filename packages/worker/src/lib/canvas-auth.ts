import type { LiveCanvasDO } from '../do/live-canvas.ts'

// Canvas share tokens: 128 random bits, handed out once at canvas creation. Only
// the SHA-256 hash is stored, in the canvas's own Durable Object, so a token is
// scoped to one canvas. The canvas UUID stays unguessable as a second layer.

export type CanvasScope = 'read' | 'write'

export const CANVAS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export function canvasStub(env: Env, canvasId: string): DurableObjectStub<LiveCanvasDO> {
	return env.CANVAS_DO.get(env.CANVAS_DO.idFromName(canvasId)) as DurableObjectStub<LiveCanvasDO>
}

export async function hashCanvasToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Mints a token for `scope` on the canvas and stores its hash with an expiry. */
export async function issueCanvasToken(
	env: Env,
	canvasId: string,
	scope: CanvasScope,
	ttlMs = CANVAS_TOKEN_TTL_MS,
): Promise<{ token: string; expires_at: string }> {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	const token = btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')
	const expiresAt = Date.now() + ttlMs
	await canvasStub(env, canvasId).issueToken(await hashCanvasToken(token), scope, expiresAt)
	return { token, expires_at: new Date(expiresAt).toISOString() }
}

/** Revokes one token, or every token of the canvas when `token` is omitted. */
export async function revokeCanvasTokens(
	env: Env,
	canvasId: string,
	token?: string,
): Promise<number> {
	const hash = token === undefined ? undefined : await hashCanvasToken(token)
	return canvasStub(env, canvasId).revokeTokens(hash)
}

function presentedToken(request: Request): string | null {
	const fromQuery = new URL(request.url).searchParams.get('token')
	if (fromQuery) return fromQuery
	const header = request.headers.get('Authorization') ?? ''
	const match = header.match(/^Bearer\s+(\S+)$/i)
	return match ? match[1] : null
}

/**
 * Gate for every public /canvas/<id> request. GET and the WebSocket upgrade need
 * a read (or write) token; any other method needs a write token. A WebSocket is
 * checked at upgrade only: once open it keeps receiving updates after its token
 * expires or is revoked, until it disconnects.
 * Returns the rejection response, or null when the request may proceed.
 */
export async function authorizeCanvasRequest(
	request: Request,
	env: Env,
	canvasId: string,
): Promise<Response | null> {
	const token = presentedToken(request)
	if (!token) {
		return new Response('Canvas token required', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Bearer realm="canvas"' },
		})
	}
	const scope = await canvasStub(env, canvasId).tokenScope(await hashCanvasToken(token))
	if (!scope) {
		return new Response('Invalid, expired or revoked canvas token', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Bearer realm="canvas", error="invalid_token"' },
		})
	}
	const needsWrite = request.method !== 'GET' && request.method !== 'HEAD'
	if (needsWrite && scope !== 'write') {
		return new Response('Canvas token does not allow writes', { status: 403 })
	}
	return null
}
