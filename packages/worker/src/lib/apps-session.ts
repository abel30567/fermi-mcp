const COOKIE_NAME = 'fermi_apps_session'
const SESSION_TTL_S = 60 * 60 * 24
const KV_PREFIX = 'apps_session:'

function toBase64Url(bytes: Uint8Array): string {
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export interface IssuedSession {
	token: string
	expiresAt: number
}

export async function issueSession(env: Env): Promise<IssuedSession> {
	const random = crypto.getRandomValues(new Uint8Array(32))
	const token = toBase64Url(random)
	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S
	await env.FERMI_KV.put(`${KV_PREFIX}${token}`, String(expiresAt), {
		expirationTtl: SESSION_TTL_S,
	})
	return { token, expiresAt }
}

export async function validateSession(token: string, env: Env): Promise<boolean> {
	if (!token) return false
	const entry = await env.FERMI_KV.get(`${KV_PREFIX}${token}`)
	return entry !== null
}

export async function revokeSession(token: string, env: Env): Promise<void> {
	if (!token) return
	await env.FERMI_KV.delete(`${KV_PREFIX}${token}`)
}

export function buildSessionCookie(token: string): string {
	return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/apps; Max-Age=${SESSION_TTL_S}`
}

export function buildClearCookie(): string {
	return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/apps; Max-Age=0`
}

export function getCookieToken(request: Request): string | null {
	const header = request.headers.get('cookie')
	if (!header) return null
	for (const part of header.split(';')) {
		const [rawName, ...rest] = part.split('=')
		if (rawName?.trim() === COOKIE_NAME) {
			return rest.join('=').trim() || null
		}
	}
	return null
}

export function getBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization')
	if (!header) return null
	const match = header.match(/^Bearer\s+(.+)$/i)
	return match ? match[1].trim() : null
}

export async function authenticateAppsRequest(request: Request, env: Env): Promise<boolean> {
	const bearer = getBearerToken(request)
	if (bearer && (await validateSession(bearer, env))) return true
	const cookie = getCookieToken(request)
	if (cookie && (await validateSession(cookie, env))) return true
	return false
}
