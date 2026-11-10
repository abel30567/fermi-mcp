import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleCallback, handleOauthStart } from '../src/lib/oauth-flow.ts'
import { putOauthClient } from '../src/lib/oauth-store.ts'
import { getSecret, putSecret } from '../src/lib/secrets-store.ts'
import { applyMigrations } from './setup-d1.ts'

const BASE = 'https://fermi.test'
const PROVIDER = 'https://provider.test'
const RESULT_SECRET = 'GH_TOKEN'

function startReq(provider: string | null, auth?: string): Request {
	const qs = provider ? `?provider=${provider}` : ''
	return new Request(`${BASE}/oauth/start${qs}`, {
		headers: auth ? { authorization: auth } : {},
	})
}

const ownerAuth = () => `Bearer ${env.FERMI_BEARER_TOKEN}`

/** Runs /oauth/start as the owner and returns the minted state. */
async function startAsOwner(): Promise<string> {
	const res = await handleOauthStart(startReq('gh', ownerAuth()), env)
	expect(res.status).toBe(302)
	const state = new URL(res.headers.get('location') ?? '').searchParams.get('state')
	expect(state).toBeTruthy()
	return state as string
}

const callbackUrl = (state: string) => new URL(`${BASE}/oauth/callback?code=c1&state=${state}`)

let tokenExchanges = 0
function mockTokenEndpoint(times = 1) {
	fetchMock
		.get(PROVIDER)
		.intercept({ path: '/token', method: 'POST' })
		.reply(200, () => {
			tokenExchanges++
			return { access_token: `tok-${tokenExchanges}`, scope: 'repo' }
		})
		.times(times)
}

describe('connector OAuth: owner-bound, single-use state', () => {
	beforeAll(async () => {
		await applyMigrations()
	})
	beforeEach(async () => {
		tokenExchanges = 0
		fetchMock.activate()
		fetchMock.disableNetConnect()
		await env.FERMI_DB.prepare('DELETE FROM secrets').run()
		await putOauthClient(
			{
				name: 'gh',
				client_id: 'cid',
				client_secret_name: 'GH_CLIENT_SECRET',
				auth_url: `${PROVIDER}/authorize`,
				token_url: `${PROVIDER}/token`,
				result_secret_name: RESULT_SECRET,
			},
			env,
		)
		await putSecret({ name: 'GH_CLIENT_SECRET', value: 'csecret', scope: 'app' }, env)
	})
	afterEach(() => {
		fetchMock.deactivate()
	})

	it('anonymous /oauth/start is 401 and mints no state', async () => {
		const res = await handleOauthStart(startReq('gh'), env)
		expect(res.status).toBe(401)
		expect((await env.FERMI_KV.list({ prefix: 'oauth:state:' })).keys).toHaveLength(0)
	})

	it('a wrong bearer on /oauth/start is 401', async () => {
		const res = await handleOauthStart(startReq('gh', `${ownerAuth()}x`), env)
		expect(res.status).toBe(401)
	})

	it('start with the valid owner token redirects with an owner-bound state', async () => {
		const res = await handleOauthStart(startReq('gh', ownerAuth()), env)
		expect(res.status).toBe(302)
		const location = new URL(res.headers.get('location') ?? '')
		expect(`${location.origin}${location.pathname}`).toBe(`${PROVIDER}/authorize`)
		expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/oauth/callback`)
		const state = location.searchParams.get('state')
		const rec = JSON.parse((await env.FERMI_KV.get(`oauth:state:${state}`)) ?? '{}')
		expect(rec).toMatchObject({
			client: 'gh',
			owner: expect.stringMatching(/^owner:[0-9a-f]{16}$/),
		})
	})

	it('provider not configured: start is 400 oauth_client_not_found', async () => {
		const res = await handleOauthStart(startReq('nope', ownerAuth()), env)
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'oauth_client_not_found: nope' })
	})

	it('missing state on callback is rejected', async () => {
		await expect(
			handleCallback(new URL(`${BASE}/oauth/callback?code=c1`), env, BASE),
		).rejects.toThrow('missing_code_or_state')
		await expect(handleCallback(callbackUrl('unknown'), env, BASE)).rejects.toThrow(
			'invalid_or_expired_state',
		)
	})

	it('expired state is rejected without a token exchange', async () => {
		const state = await startAsOwner()
		const key = `oauth:state:${state}`
		const rec = JSON.parse((await env.FERMI_KV.get(key)) ?? '{}')
		await env.FERMI_KV.put(key, JSON.stringify({ ...rec, created_at: Date.now() - 601_000 }))
		await expect(handleCallback(callbackUrl(state), env, BASE)).rejects.toThrow(
			'invalid_or_expired_state',
		)
		expect(tokenExchanges).toBe(0)
	})

	it('replayed state is rejected even if the KV record is still visible', async () => {
		const state = await startAsOwner()
		const key = `oauth:state:${state}`
		const recJson = (await env.FERMI_KV.get(key)) as string
		mockTokenEndpoint()
		await expect(handleCallback(callbackUrl(state), env, BASE)).resolves.toMatchObject({
			client: 'gh',
			stored_secret: RESULT_SECRET,
		})
		// A plain replay finds nothing; a replay against a stale (eventually consistent)
		// KV replica that still has the record is stopped by the D1 claim.
		await expect(handleCallback(callbackUrl(state), env, BASE)).rejects.toThrow(
			'invalid_or_expired_state',
		)
		await env.FERMI_KV.put(key, recJson)
		await expect(handleCallback(callbackUrl(state), env, BASE)).rejects.toThrow(
			'state_already_used',
		)
		expect(tokenExchanges).toBe(1)
	})

	it('wrong-principal state is rejected', async () => {
		const state = await startAsOwner()
		// Same state, but the owner bearer has since been rotated.
		const rotated = { ...env, FERMI_BEARER_TOKEN: 'rotated-bearer' } as Env
		await expect(handleCallback(callbackUrl(state), rotated, BASE)).rejects.toThrow(
			'state_principal_mismatch',
		)
		// A state record minted without an owner (the pre-binding format) is refused too.
		await env.FERMI_KV.put(
			'oauth:state:legacy',
			JSON.stringify({ client: 'gh', created_at: Date.now() }),
		)
		await expect(handleCallback(callbackUrl('legacy'), env, BASE)).rejects.toThrow(
			'state_principal_mismatch',
		)
		expect(tokenExchanges).toBe(0)
	})

	it('two concurrent callbacks with the same state: exactly one stores the token', async () => {
		const state = await startAsOwner()
		mockTokenEndpoint(2)
		const results = await Promise.allSettled([
			handleCallback(callbackUrl(state), env, BASE),
			handleCallback(callbackUrl(state), env, BASE),
		])
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
		const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
		expect(rejected).toHaveLength(1)
		expect(String(rejected[0]?.reason)).toMatch(/state_already_used|invalid_or_expired_state/)
		expect(tokenExchanges).toBe(1)
		expect((await getSecret(RESULT_SECRET, 'app', '', env))?.value).toBe('tok-1')
	})
})
