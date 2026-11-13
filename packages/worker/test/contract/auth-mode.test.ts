import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../src/index.ts'

// The fetch handler's auth gate (MCP-26): OAuth is on unless FERMI_LOCAL_DEV is
// exactly 'true'. The contract project binds FERMI_LOCAL_DEV=true, so each case
// calls the real entry with its own vars instead of going through SELF.

type AuthVars = { FERMI_LOCAL_DEV?: string; FERMI_AUTH_ENABLED?: string }

async function send(vars: AuthVars, path = '/mcp', headers: Record<string, string> = {}) {
	const testEnv = { ...env, FERMI_LOCAL_DEV: undefined, FERMI_AUTH_ENABLED: undefined, ...vars }
	const init: RequestInit =
		path === '/mcp'
			? {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream',
						...headers,
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'initialize',
						params: {
							protocolVersion: '2025-03-26',
							capabilities: {},
							clientInfo: { name: 'auth-mode-test', version: '0' },
						},
					}),
				}
			: { headers }
	const ctx = createExecutionContext()
	const res = await worker.fetch(new Request(`http://fermi.test${path}`, init), testEnv as Env, ctx)
	await waitOnExecutionContext(ctx)
	return res
}

describe('auth gate on /mcp', () => {
	it('returns 401 when FERMI_AUTH_ENABLED and FERMI_LOCAL_DEV are both unset', async () => {
		expect((await send({})).status).toBe(401)
	})

	it('returns 401 with only FERMI_AUTH_ENABLED=true', async () => {
		expect((await send({ FERMI_AUTH_ENABLED: 'true' })).status).toBe(401)
	})

	it('serves with only FERMI_LOCAL_DEV=true', async () => {
		const res = await send({ FERMI_LOCAL_DEV: 'true' })
		expect(res.status).toBe(200)
		expect(res.headers.get('mcp-session-id')).toBeTruthy()
	})

	it('serves with both set when no Authorization header is sent', async () => {
		const res = await send({ FERMI_LOCAL_DEV: 'true', FERMI_AUTH_ENABLED: 'true' })
		expect(res.status).toBe(200)
	})

	it('validates a presented bearer token when both are set', async () => {
		const res = await send({ FERMI_LOCAL_DEV: 'true', FERMI_AUTH_ENABLED: 'true' }, '/mcp', {
			Authorization: 'Bearer not-a-real-token',
		})
		expect(res.status).toBe(401)
	})

	it('fails closed on FERMI_AUTH_ENABLED="TRUE"', async () => {
		expect((await send({ FERMI_AUTH_ENABLED: 'TRUE' })).status).toBe(401)
	})

	it('fails closed on FERMI_AUTH_ENABLED="1"', async () => {
		expect((await send({ FERMI_AUTH_ENABLED: '1' })).status).toBe(401)
	})

	it('fails closed on FERMI_AUTH_ENABLED="false"', async () => {
		expect((await send({ FERMI_AUTH_ENABLED: 'false' })).status).toBe(401)
	})

	it('fails closed on FERMI_LOCAL_DEV="TRUE"', async () => {
		expect((await send({ FERMI_LOCAL_DEV: 'TRUE' })).status).toBe(401)
	})

	it('fails closed on FERMI_LOCAL_DEV="1"', async () => {
		expect((await send({ FERMI_LOCAL_DEV: '1' })).status).toBe(401)
	})
})

describe('public endpoints with auth on', () => {
	it('keeps /health reachable', async () => {
		expect((await send({}, '/health')).status).toBe(200)
	})

	it('keeps OAuth discovery reachable', async () => {
		const res = await send({}, '/.well-known/oauth-authorization-server')
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			token_endpoint: expect.stringContaining('/oauth/token'),
		})
	})
})
