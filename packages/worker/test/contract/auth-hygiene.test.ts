import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleAppsLoginPost, handleAppsLogout } from '../../src/lib/apps-login.ts'
import { authenticateAppsRequest, issueSession, revokeSession } from '../../src/lib/apps-session.ts'

// MCP-32: atomic login throttle, constant-time owner-secret compare, hashed session keys.
// Runs in the contract project because the throttle lives in the FleetDO binding.

const SECRET = 'pässwörd-🔐-ключ'
const ownerEnv = { ...env, FERMI_OWNER_SECRET: SECRET } as Env
let ipSeq = 0

function login(ip: string, ownerSecret: string): Promise<Response> {
	return handleAppsLoginPost(
		new Request('https://fermi.example.workers.dev/apps/_login', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json',
				'cf-connecting-ip': ip,
			},
			body: JSON.stringify({ owner_secret: ownerSecret }),
		}),
		ownerEnv,
	)
}

const appsRequest = (headers: Record<string, string>) =>
	new Request('https://fermi.example.workers.dev/apps/x/index.html', { headers })

async function sessionKeys(): Promise<string[]> {
	return (await env.FERMI_KV.list({ prefix: 'apps_session:' })).keys.map((k) => k.name)
}

beforeEach(async () => {
	ipSeq++
	// The contract D1 is shared; vault.test.ts leaves a TOTP secret behind.
	await env.FERMI_DB.prepare("DELETE FROM secrets WHERE name = 'FERMI_TOTP_SECRET'").run()
	await Promise.all((await sessionKeys()).map((k) => env.FERMI_KV.delete(k)))
})

describe('login throttle', () => {
	it('lets at most limit+1 of 20 concurrent logins through and store a session', async () => {
		const ip = `203.0.113.${ipSeq}`
		const responses = await Promise.all(Array.from({ length: 20 }, () => login(ip, SECRET)))
		const passed = responses.filter((r) => r.status !== 429)
		expect(passed.length).toBeLessThanOrEqual(6)
		expect(passed.length).toBeGreaterThan(0)
		expect((await sessionKeys()).length).toBeLessThanOrEqual(6)
	})

	it('counts per IP', async () => {
		for (let i = 0; i < 5; i++) await login(`198.51.100.${ipSeq}`, 'wrong')
		expect((await login(`198.51.100.${ipSeq}`, 'wrong')).status).toBe(429)
		expect((await login(`192.0.2.${ipSeq}`, 'wrong')).status).toBe(403)
	})
})

describe('owner secret compare', () => {
	it('accepts the exact unicode secret', async () => {
		expect((await login(`203.0.113.${ipSeq + 100}`, SECRET)).status).toBe(200)
	})

	it('rejects a same-length string whose UTF-8 bytes differ, without throwing', async () => {
		// 'a' vs 'ä': equal UTF-16 length, different byte length.
		const lookalike = SECRET.replace('ä', 'a')
		expect(lookalike.length).toBe(SECRET.length)
		expect((await login(`203.0.113.${ipSeq + 100}`, lookalike)).status).toBe(403)
	})

	it('rejects an empty secret', async () => {
		expect((await login(`203.0.113.${ipSeq + 100}`, '')).status).toBe(403)
	})
})

describe('apps sessions', () => {
	it('stores only the SHA-256 of the token in KV', async () => {
		const { token } = await issueSession(env)
		const keys = await sessionKeys()
		expect(keys).toHaveLength(1)
		expect(keys[0]).not.toContain(token)
		expect(keys[0]).toMatch(/^apps_session:[0-9a-f]{64}$/)
		expect(await env.FERMI_KV.get(`apps_session:${token}`)).toBeNull()
		expect(
			await authenticateAppsRequest(appsRequest({ authorization: `Bearer ${token}` }), env),
		).toBe(true)
	})

	it('rejects an empty token', async () => {
		await issueSession(env)
		expect(await authenticateAppsRequest(appsRequest({ authorization: 'Bearer ' }), env)).toBe(
			false,
		)
		expect(await authenticateAppsRequest(appsRequest({ cookie: 'fermi_apps_session=' }), env)).toBe(
			false,
		)
	})

	it('rejects the old token after rotation mid-session', async () => {
		const old = await issueSession(env)
		const cookie = { cookie: `fermi_apps_session=${old.token}` }
		expect(await authenticateAppsRequest(appsRequest(cookie), env)).toBe(true)

		const fresh = await issueSession(env)
		await handleAppsLogout(appsRequest(cookie), env)

		expect(await authenticateAppsRequest(appsRequest(cookie), env)).toBe(false)
		expect(
			await authenticateAppsRequest(
				appsRequest({ cookie: `fermi_apps_session=${fresh.token}` }),
				env,
			),
		).toBe(true)
		await revokeSession(fresh.token, env)
		expect(await sessionKeys()).toEqual([])
	})
})
