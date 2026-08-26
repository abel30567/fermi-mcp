import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import { writeAudit } from './audit.ts'
import { getSecret } from './secrets-store.ts'
import { validateTotp } from './totp.ts'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_S = 60

async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
	const key = `ratelimit:oauth:auth:${ip}`
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

function renderAuthorizePage(oauthReqInfoJson: string, error?: string): string {
	const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : ''
	const encodedReq = escapeHtml(oauthReqInfoJson)
	return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Fermi - Authorize</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:2rem;width:100%;max-width:400px}h1{font-size:1.5rem;margin-bottom:.5rem;color:#c9a84c}p{font-size:.875rem;color:#888;margin-bottom:1.5rem}label{display:block;font-size:.875rem;margin-bottom:.25rem;color:#aaa}input{width:100%;padding:.75rem;border:1px solid #333;border-radius:8px;background:#111;color:#e0e0e0;font-size:1rem;margin-bottom:1rem}input:focus{outline:none;border-color:#c9a84c}button{width:100%;padding:.75rem;background:#c9a84c;color:#0a0a0a;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}button:hover{background:#d4b85c}.error{background:#3a1a1a;border:1px solid #5a2a2a;color:#ff6b6b;padding:.75rem;border-radius:8px;margin-bottom:1rem;font-size:.875rem}.info{font-size:.75rem;color:#666;margin-top:1rem;text-align:center}</style></head><body><div class="card"><h1>Fermi</h1><p>Authorize MCP connection</p>${errorHtml}<form method="POST" action="/oauth/authorize"><input type="hidden" name="oauth_req" value="${encodedReq}"><label for="secret">Owner Secret</label><input type="password" id="secret" name="owner_secret" placeholder="Enter your passphrase" required autocomplete="current-password"><label for="totp">Authenticator Code</label><input type="text" id="totp" name="totp_code" placeholder="6-digit code" required autocomplete="one-time-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}"><button type="submit">Authorize</button></form><div class="info">Two-factor authentication required</div></div></body></html>`
}

export async function handleAuthorizeGet(request: Request, env: Env): Promise<Response> {
	const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request)
	return new Response(renderAuthorizePage(JSON.stringify(oauthReqInfo)), {
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	})
}

export async function handleAuthorizePost(request: Request, env: Env): Promise<Response> {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
	const allowed = await checkRateLimit(ip, env)
	if (!allowed) return new Response('Too Many Requests', { status: 429 })

	const form = await request.formData()
	const oauthReqRaw = form.get('oauth_req')
	if (typeof oauthReqRaw !== 'string') {
		return new Response('Missing oauth request', { status: 400 })
	}
	let oauthReqInfo: AuthRequest
	try {
		oauthReqInfo = JSON.parse(oauthReqRaw) as AuthRequest
	} catch {
		return new Response('Malformed oauth request', { status: 400 })
	}

	const ownerSecret = (form.get('owner_secret') as string | null) ?? ''
	const totpCode = (form.get('totp_code') as string | null) ?? ''

	if (!env.FERMI_OWNER_SECRET || ownerSecret !== env.FERMI_OWNER_SECRET) {
		await writeAudit(env.FERMI_DB, {
			tool: 'oauth_authorize',
			args_hash: ip,
			outcome: 'denied',
			risk: 'high',
		})
		return new Response(renderAuthorizePage(oauthReqRaw, 'Invalid owner secret'), {
			status: 403,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		})
	}

	const totpSecret = await getSecret('FERMI_TOTP_SECRET', 'app', '', env)
	if (totpSecret) {
		const totpValid = await validateTotp(totpSecret.value, totpCode)
		if (!totpValid) {
			await writeAudit(env.FERMI_DB, {
				tool: 'oauth_authorize_totp',
				args_hash: ip,
				outcome: 'denied',
				risk: 'high',
			})
			return new Response(renderAuthorizePage(oauthReqRaw, 'Invalid authenticator code'), {
				status: 403,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			})
		}
	}

	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: 'owner',
		metadata: { clientId: oauthReqInfo.clientId },
		scope: oauthReqInfo.scope,
		props: { owner: true },
	})
	await writeAudit(env.FERMI_DB, {
		tool: 'oauth_authorize',
		args_hash: ip,
		outcome: 'ok',
		risk: 'high',
	})
	return Response.redirect(redirectTo, 302)
}
