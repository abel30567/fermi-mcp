import { WorkerEntrypoint } from 'cloudflare:workers'
import { writeAudit } from '../lib/audit.ts'
import { isPrivateAddress, resolvesToPrivate } from '../lib/host-guard.ts'
import { type SecretScope, getSecret } from '../lib/secrets-store.ts'

const SECRET_PATTERN = /\{\{secret:([a-zA-Z0-9._-]+)(?:\|scope=(session|app|user))?\}\}/g

interface SubstitutionContext {
	host: string
	env: Env
	hits: Map<string, string>
}

class HostNotApprovedError extends Error {
	readonly errorBody: { error: string; secret: string; host: string; approval_url: string }
	constructor(secret: string, host: string) {
		super(`secret "${secret}" not approved for host "${host}"`)
		this.errorBody = {
			error: 'host_not_approved',
			secret,
			host,
			approval_url: `/secrets/approve?secret=${encodeURIComponent(secret)}&host=${encodeURIComponent(host)}`,
		}
	}
}

class SecretMissingError extends Error {
	readonly errorBody: { error: string; secret: string; scope: SecretScope }
	constructor(secret: string, scope: SecretScope) {
		super(`secret "${secret}" not found (scope=${scope})`)
		this.errorBody = { error: 'secret_not_found', secret, scope }
	}
}

async function substituteString(value: string, ctx: SubstitutionContext): Promise<string> {
	if (!value.includes('{{secret:')) return value
	const matches = Array.from(value.matchAll(SECRET_PATTERN))
	if (matches.length === 0) return value

	let out = value
	for (const m of matches) {
		const secretName = m[1]
		const scope: SecretScope = (m[2] as SecretScope | undefined) ?? 'app'
		// session scope requires session_id; not threadable via globalOutbound today.
		// Reject session-scope secrets in the gateway with a clear error.
		if (scope === 'session') {
			throw new SecretMissingError(secretName, 'session')
		}
		const cacheKey = `${secretName}:${scope}`
		let plain = ctx.hits.get(cacheKey)
		if (!plain) {
			const rec = await getSecret(secretName, scope, '', ctx.env)
			if (!rec) throw new SecretMissingError(secretName, scope)
			if (!rec.metadata.allowed_hosts.includes(ctx.host)) {
				throw new HostNotApprovedError(secretName, ctx.host)
			}
			plain = rec.value
			ctx.hits.set(cacheKey, plain)
		}
		out = out.replaceAll(m[0], plain)
	}
	return out
}

interface ExpandedRequest {
	url: string
	method: string
	headers: Headers
	body: string | ArrayBuffer | undefined
	/** Header names whose value carried a secret placeholder. */
	secretHeaders: Set<string>
	bodyHasSecret: boolean
	hasSecrets: boolean
}

async function expandRequest(req: Request, env: Env): Promise<ExpandedRequest> {
	const ctx: SubstitutionContext = {
		host: new URL(req.url).host,
		env,
		hits: new Map(),
	}

	const newUrl = await substituteString(req.url, ctx)

	const headers = new Headers()
	const secretHeaders = new Set<string>()
	for (const [k, v] of req.headers.entries()) {
		const expanded = await substituteString(v, ctx)
		if (expanded !== v) secretHeaders.add(k)
		headers.set(k, expanded)
	}

	let body: string | ArrayBuffer | undefined
	let bodyHasSecret = false
	const contentType = req.headers.get('content-type') ?? ''
	const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
	if (hasBody) {
		const isText =
			contentType.startsWith('text/') ||
			contentType.includes('json') ||
			contentType.includes('xml') ||
			contentType.includes('x-www-form-urlencoded')
		if (isText) {
			const raw = await req.text()
			body = await substituteString(raw, ctx)
			bodyHasSecret = body !== raw
		} else {
			body = await req.arrayBuffer()
		}
	}

	return {
		url: newUrl,
		method: req.method,
		headers,
		body,
		secretHeaders,
		bodyHasSecret,
		hasSecrets: ctx.hits.size > 0,
	}
}

class DestinationBlockedError extends Error {
	readonly errorBody: { error: string; host: string; reason: string }
	constructor(host: string, reason: string) {
		super(`destination "${host}" blocked: ${reason}`)
		this.errorBody = { error: 'destination_blocked', host, reason }
	}
}

const MAX_REDIRECTS = 10
// Never forwarded across origins, whether or not they carried a placeholder.
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie']

async function assertDestination(url: URL, carriesSecrets: boolean): Promise<void> {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new DestinationBlockedError(url.host, `unsupported scheme ${url.protocol}`)
	}
	if (isPrivateAddress(url.hostname)) {
		throw new DestinationBlockedError(url.host, 'private or loopback address')
	}
	if (carriesSecrets && (await resolvesToPrivate(url.hostname))) {
		throw new DestinationBlockedError(url.host, 'resolves to a private address')
	}
}

/**
 * Sends the expanded request and follows redirects by hand so every hop is
 * re-validated. Secrets never follow a redirect to another origin: credential
 * and secret-bearing headers are stripped, and a 307/308 that would replay a
 * secret-bearing body cross-origin is refused.
 */
async function sendWithRedirects(
	exp: ExpandedRequest,
	redirectMode: Request['redirect'],
): Promise<Response> {
	let url = new URL(exp.url)
	let { method, body } = exp
	const headers = new Headers(exp.headers)
	let secretHeaders = exp.secretHeaders
	let bodyHasSecret = exp.bodyHasSecret

	for (let hop = 0; ; hop++) {
		const carriesSecrets = hop === 0 ? exp.hasSecrets : secretHeaders.size > 0 || bodyHasSecret
		await assertDestination(url, carriesSecrets)
		const res = await fetch(url.toString(), { method, headers, body, redirect: 'manual' })
		const location = res.headers.get('location')
		if (res.status < 300 || res.status > 399 || !location || redirectMode === 'manual') return res
		if (redirectMode === 'error')
			throw new Error(`redirect to ${location} refused (redirect: error)`)
		if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (> ${MAX_REDIRECTS})`)

		const next = new URL(location, url)
		const preservesBody = res.status === 307 || res.status === 308
		if (!preservesBody && (res.status === 303 ? method !== 'HEAD' : method === 'POST')) {
			method = 'GET'
			body = undefined
			bodyHasSecret = false
			for (const h of ['content-type', 'content-length', 'content-encoding', 'content-language']) {
				headers.delete(h)
			}
		}
		if (next.origin !== url.origin) {
			if (bodyHasSecret) {
				throw new DestinationBlockedError(
					next.host,
					'cross-origin redirect would replay a secret body',
				)
			}
			for (const h of [...CREDENTIAL_HEADERS, ...secretHeaders]) headers.delete(h)
			secretHeaders = new Set()
		}
		url = next
	}
}

export async function handleGatewayRequest(req: Request, env: Env): Promise<Response> {
	const startedAt = Date.now()
	try {
		const expanded = await expandRequest(req, env)
		const upstream = await sendWithRedirects(expanded, req.redirect)
		await writeAudit(env.FERMI_DB, {
			tool: 'fetch_gateway',
			args_hash: new URL(req.url).host,
			outcome: 'ok',
			risk: 'med',
		})
		return upstream
	} catch (err) {
		const reason = err instanceof Error ? err.message : 'unknown'
		await writeAudit(env.FERMI_DB, {
			tool: 'fetch_gateway',
			args_hash: new URL(req.url).host,
			outcome: 'denied',
			risk: 'med',
		})
		if (err instanceof HostNotApprovedError) {
			return Response.json(err.errorBody, { status: 403 })
		}
		if (err instanceof DestinationBlockedError) {
			return Response.json(err.errorBody, { status: 403 })
		}
		if (err instanceof SecretMissingError) {
			return Response.json(err.errorBody, { status: 400 })
		}
		return Response.json(
			{ error: 'gateway_failure', reason, durationMs: Date.now() - startedAt },
			{ status: 502 },
		)
	}
}

export class CodemodeFetchGateway extends WorkerEntrypoint<Env> {
	override fetch(req: Request): Promise<Response> {
		return handleGatewayRequest(req, this.env)
	}
}
