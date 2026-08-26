import {
	buildClearCookie,
	buildSessionCookie,
	getCookieToken,
	issueSession,
	revokeSession,
} from './apps-session.ts'
import { writeAudit } from './audit.ts'
import { getSecret } from './secrets-store.ts'
import { validateTotp } from './totp.ts'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_S = 60

async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
	const key = `ratelimit:apps:login:${ip}`
	const current = await env.FERMI_KV.get(key)
	const count = current ? Number.parseInt(current, 10) : 0
	if (count >= RATE_LIMIT_MAX) return false
	await env.FERMI_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_S })
	return true
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function sanitizeNext(raw: string | null): string {
	if (!raw) return '/apps/'
	if (!raw.startsWith('/apps/')) return '/apps/'
	if (raw.includes('\n') || raw.includes('\r')) return '/apps/'
	return raw
}

function renderLoginPage(next: string, error?: string): string {
	const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : ''
	const encodedNext = escapeHtml(next)
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Fermi - Apps Login</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:2rem;width:100%;max-width:400px}h1{font-size:1.5rem;margin-bottom:.5rem;color:#c9a84c}p{font-size:.875rem;color:#888;margin-bottom:1.5rem}label{display:block;font-size:.875rem;margin-bottom:.25rem;color:#aaa}input{width:100%;padding:.75rem;border:1px solid #333;border-radius:8px;background:#111;color:#e0e0e0;font-size:1rem;margin-bottom:1rem}input:focus{outline:none;border-color:#c9a84c}button{width:100%;padding:.75rem;background:#c9a84c;color:#0a0a0a;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}button:hover{background:#d4b85c}.error{background:#3a1a1a;border:1px solid #5a2a2a;color:#ff6b6b;padding:.75rem;border-radius:8px;margin-bottom:1rem;font-size:.875rem}.info{font-size:.75rem;color:#666;margin-top:1rem;text-align:center}</style></head><body><div class="card"><h1>Fermi</h1><p>Sign in to access apps</p>${errorHtml}<form method="POST" action="/apps/_login"><input type="hidden" name="next" value="${encodedNext}"><label for="secret">Owner Secret</label><input type="password" id="secret" name="owner_secret" placeholder="Enter your passphrase" required autocomplete="current-password"><label for="totp">Authenticator Code</label><input type="text" id="totp" name="totp_code" placeholder="6-digit code" required autocomplete="one-time-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}"><button type="submit">Sign in</button></form><div class="info">Two-factor authentication required</div></div></body></html>`
}

export async function handleAppsLoginGet(request: Request): Promise<Response> {
	const url = new URL(request.url)
	const next = sanitizeNext(url.searchParams.get('next'))
	return new Response(renderLoginPage(next), {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	})
}

export async function handleAppsLoginPost(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
	const allowed = await checkRateLimit(ip, env)
	if (!allowed) return new Response('Too Many Requests', { status: 429 })

	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json')

	let ownerSecret = ''
	let totpCode = ''
	let next = '/apps/'
	const contentType = request.headers.get('content-type') ?? ''
	if (contentType.includes('application/json')) {
		try {
			const body = (await request.json()) as {
				owner_secret?: string
				totp_code?: string
				next?: string
			}
			ownerSecret = body.owner_secret ?? ''
			totpCode = body.totp_code ?? ''
			next = sanitizeNext(body.next ?? null)
		} catch {
			return new Response(JSON.stringify({ error: 'invalid_json' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			})
		}
	} else {
		const form = await request.formData()
		ownerSecret = (form.get('owner_secret') as string | null) ?? ''
		totpCode = (form.get('totp_code') as string | null) ?? ''
		next = sanitizeNext((form.get('next') as string | null) ?? null)
	}

	if (!env.FERMI_OWNER_SECRET || ownerSecret !== env.FERMI_OWNER_SECRET) {
		await writeAudit(env.FERMI_DB, {
			tool: 'apps_login',
			args_hash: ip,
			outcome: 'denied',
			risk: 'high',
		})
		if (wantsJson) {
			return new Response(JSON.stringify({ error: 'invalid_owner_secret' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		return new Response(renderLoginPage(next, 'Invalid owner secret'), {
			status: 403,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		})
	}

	const totpSecret = await getSecret('FERMI_TOTP_SECRET', 'app', '', env)
	if (totpSecret) {
		const totpValid = await validateTotp(totpSecret.value, totpCode)
		if (!totpValid) {
			await writeAudit(env.FERMI_DB, {
				tool: 'apps_login_totp',
				args_hash: ip,
				outcome: 'denied',
				risk: 'high',
			})
			if (wantsJson) {
				return new Response(JSON.stringify({ error: 'invalid_totp' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				})
			}
			return new Response(renderLoginPage(next, 'Invalid authenticator code'), {
				status: 403,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			})
		}
	}

	const session = await issueSession(env)
	await writeAudit(env.FERMI_DB, {
		tool: 'apps_login',
		args_hash: ip,
		outcome: 'ok',
		risk: 'high',
	})

	if (wantsJson) {
		return new Response(JSON.stringify({ token: session.token, expires_at: session.expiresAt }), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		})
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: next,
			'Set-Cookie': buildSessionCookie(session.token),
			'Cache-Control': 'no-store',
		},
	})
}

export async function handleAppsLogout(request: Request, env: Env): Promise<Response> {
	const token = getCookieToken(request)
	if (token) await revokeSession(token, env)
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/apps/_login',
			'Set-Cookie': buildClearCookie(),
			'Cache-Control': 'no-store',
		},
	})
}
