import { authenticateAppsRequest } from './apps-session.ts'
import { getMimeType } from './mime-types.ts'

const RESERVED_PATHS = new Set(['_login', '_logout'])

const CSP_HEADER = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"img-src 'self' data: https:",
	"font-src 'self' data: https://fonts.gstatic.com",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
].join('; ')

function isInvalidPath(path: string): boolean {
	if (!path) return true
	if (path.startsWith('/')) return true
	if (path.includes('\0')) return true
	for (const segment of path.split('/')) {
		if (segment === '..' || segment === '.') return true
	}
	return false
}

function isPublicPath(path: string): boolean {
	return path.startsWith('public/')
}

export async function handleAppsRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method Not Allowed', {
			status: 405,
			headers: { Allow: 'GET, HEAD' },
		})
	}

	const rawPath = url.pathname.slice('/apps/'.length)
	const path = decodeURIComponent(rawPath)

	if (isInvalidPath(path)) {
		return new Response('Bad Request', { status: 400 })
	}

	const firstSegment = path.split('/')[0]
	if (RESERVED_PATHS.has(firstSegment)) {
		return new Response('Not Found', { status: 404 })
	}

	if (path.endsWith('/')) {
		return new Response('Not Found', { status: 404 })
	}

	const isPublic = isPublicPath(path)

	if (!isPublic) {
		const authEnabled = env.FERMI_AUTH_ENABLED === 'true'
		if (authEnabled) {
			const authed = await authenticateAppsRequest(request, env)
			if (!authed) {
				const next = url.pathname + url.search
				const loginUrl = `/apps/_login?next=${encodeURIComponent(next)}`
				return new Response(null, {
					status: 302,
					headers: { Location: loginUrl, 'Cache-Control': 'no-store' },
				})
			}
		}
	}

	const obj = await env.FERMI_BUCKET.get(`apps/${path}`)
	if (!obj) return new Response('Not Found', { status: 404 })

	const cacheControl = isPublic ? 'public, max-age=3600' : 'private, no-store'

	const headers = new Headers({
		'Content-Type': getMimeType(path),
		'Content-Security-Policy': CSP_HEADER,
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'no-referrer',
		'Cache-Control': cacheControl,
	})
	headers.set('Content-Length', String(obj.size))
	if (obj.httpEtag) headers.set('ETag', obj.httpEtag)

	const body = request.method === 'HEAD' ? null : obj.body
	return new Response(body, { status: 200, headers })
}
