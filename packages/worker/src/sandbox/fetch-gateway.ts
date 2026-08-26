import { WorkerEntrypoint } from 'cloudflare:workers'
import { writeAudit } from '../lib/audit.ts'
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

async function expandRequest(req: Request, env: Env): Promise<Request> {
	const ctx: SubstitutionContext = {
		host: new URL(req.url).host,
		env,
		hits: new Map(),
	}

	const newUrl = await substituteString(req.url, ctx)

	const headers = new Headers()
	for (const [k, v] of req.headers.entries()) {
		const expanded = await substituteString(v, ctx)
		headers.set(k, expanded)
	}

	let body: BodyInit | undefined
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
		} else {
			body = await req.arrayBuffer()
		}
	}

	return new Request(newUrl, {
		method: req.method,
		headers,
		body,
		redirect: req.redirect,
	})
}

export class CodemodeFetchGateway extends WorkerEntrypoint<Env> {
	override async fetch(req: Request): Promise<Response> {
		const startedAt = Date.now()
		const env = this.env
		try {
			const expanded = await expandRequest(req, env)
			const upstream = await fetch(expanded)
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
			if (err instanceof SecretMissingError) {
				return Response.json(err.errorBody, { status: 400 })
			}
			return Response.json(
				{ error: 'gateway_failure', reason, durationMs: Date.now() - startedAt },
				{ status: 502 },
			)
		}
	}
}
