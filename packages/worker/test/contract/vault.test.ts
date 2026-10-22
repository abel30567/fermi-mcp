import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, type ToolResult, resultJson } from './mcp-client.ts'

// Contract cases for the vault tools: secrets, packages, connectors, retrievers,
// OAuth clients, web sessions and TOTP. These tables are not reset between tests,
// so every test uses unique names. High-risk tools go through the approval round trip.

async function session() {
	const client = new McpClient()
	await client.initialize()
	return client
}

const unique = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

/** Calls a high-risk tool, checks it asks for approval, then redeems the token. */
async function approved(
	client: McpClient,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const pending = resultJson<{ status: string; token: string; risk: string }>(
		await client.callTool(name, args),
	)
	expect(pending).toMatchObject({ status: 'pending_approval', risk: 'high' })
	return client.callTool(name, { ...args, approval_token: pending.token })
}

const READ_ONLY_SQL_ERROR = { error: 'retriever_sql_must_be_read_only_select' }

describeTool('secret_set', () => {
	it('stores metadata only after approval and never echoes the value', async () => {
		const client = await session()
		const name = unique('CONTRACT_SET')
		const args = { name, value: 'set-value-123', allowed_hosts: ['api.example.com'] }

		const pending = await client.callTool('secret_set', args)
		expect(resultJson(pending).status).toBe('pending_approval')
		const before = resultJson<{ secrets: Array<{ name: string }> }>(
			await client.callTool('secret_list', {}),
		)
		expect(before.secrets.map((s) => s.name)).not.toContain(name)

		const stored = await approved(client, 'secret_set', args)
		expect(resultJson(stored)).toMatchObject({
			status: 'stored',
			name,
			scope: 'app',
			allowed_hosts: ['api.example.com'],
		})
		expect(JSON.stringify(stored)).not.toContain('set-value-123')
	})
})

describeTool('secret_list', () => {
	it('lists metadata filtered by scope, without values', async () => {
		const client = await session()
		const name = unique('CONTRACT_LIST')
		await approved(client, 'secret_set', { name, value: 'list-value-123', scope: 'user' })

		const all = resultJson<{ secrets: Array<Record<string, unknown>>; total: number }>(
			await client.callTool('secret_list', {}),
		)
		const entry = all.secrets.find((s) => s.name === name)
		expect(entry).toMatchObject({ name, scope: 'user' })
		expect(entry).not.toHaveProperty('value')
		expect(all.total).toBe(all.secrets.length)

		const app = resultJson<{ secrets: Array<{ name: string }> }>(
			await client.callTool('secret_list', { scope: 'app' }),
		)
		expect(app.secrets.map((s) => s.name)).not.toContain(name)
	})
})

describeTool('secret_delete', () => {
	it('deletes after approval and reports a missing secret', async () => {
		const client = await session()
		const name = unique('CONTRACT_DEL')
		await approved(client, 'secret_set', { name, value: 'del-value-123' })

		expect(resultJson(await approved(client, 'secret_delete', { name }))).toEqual({
			name,
			scope: 'app',
			deleted: true,
		})
		const list = resultJson<{ secrets: Array<{ name: string }> }>(
			await client.callTool('secret_list', {}),
		)
		expect(list.secrets.map((s) => s.name)).not.toContain(name)
		expect(resultJson(await approved(client, 'secret_delete', { name }))).toMatchObject({
			deleted: false,
		})
	})
})

describeTool('secret_resolve', () => {
	it('resolves only opted-in secrets', async () => {
		const client = await session()
		const optedOut = unique('CONTRACT_NOOPT')
		await approved(client, 'secret_set', { name: optedOut, value: 'noopt-value-123' })

		const refused = resultJson(
			await client.callTool('secret_resolve', { name: optedOut, purpose: 'contract test' }),
		)
		expect(refused).toMatchObject({ error: 'not_opted_in', name: optedOut })
		expect(
			resultJson(
				await client.callTool('secret_resolve', { name: unique('MISSING'), purpose: 'contract' }),
			),
		).toMatchObject({ error: 'not_found' })

		const name = unique('CONTRACT_RESOLVE')
		await approved(client, 'secret_set', {
			name,
			value: 'resolve-value-123',
			allowed_capabilities: ['secret_resolve'],
		})
		expect(
			resultJson(await client.callTool('secret_resolve', { name, purpose: 'contract test' })),
		).toEqual({ name, value: 'resolve-value-123', scope: 'app' })
	})

	it('is rate-limited to 10 resolves per session per minute', async () => {
		const client = await session()
		const name = unique('CONTRACT_RATE')
		await approved(client, 'secret_set', {
			name,
			value: 'rate-value-123',
			allowed_capabilities: ['secret_resolve'],
		})

		for (let i = 0; i < 10; i++) {
			const ok = resultJson(await client.callTool('secret_resolve', { name, purpose: `call ${i}` }))
			expect(ok, `call ${i}`).toMatchObject({ value: 'rate-value-123' })
		}
		const limited = resultJson(
			await client.callTool('secret_resolve', { name, purpose: 'call 10' }),
		)
		expect(limited).toEqual({ error: 'rate_limited', limit: 10, window_s: 60 })

		// the limit is per session: a new session resolves again
		const other = await session()
		expect(
			resultJson(await other.callTool('secret_resolve', { name, purpose: 'other session' })),
		).toMatchObject({ value: 'rate-value-123' })
	})
})

describeTool('secret_approve_host', () => {
	it('adds a host after approval and reports a missing secret', async () => {
		const client = await session()
		const name = unique('CONTRACT_HOST')
		await approved(client, 'secret_set', {
			name,
			value: 'host-value-123',
			allowed_hosts: ['a.test'],
		})

		const added = resultJson(
			await approved(client, 'secret_approve_host', { name, host: 'b.test' }),
		)
		expect(added).toEqual({
			status: 'approved',
			name,
			scope: 'app',
			allowed_hosts: ['a.test', 'b.test'],
		})

		const missing = resultJson(
			await approved(client, 'secret_approve_host', { name: unique('MISSING'), host: 'b.test' }),
		)
		expect(missing).toMatchObject({ error: 'not_found', scope: 'app' })
	})
})

describe('secret values', () => {
	it('a value written with secret_set appears only in secret_resolve output, never in audit', async () => {
		const client = await session()
		const value = `sk-contract-${crypto.randomUUID()}`
		const name = unique('CONTRACT_LEAK')
		const responses: Array<{ tool: string; text: string }> = []
		const call = async (tool: string, args: Record<string, unknown>) => {
			const result = await client.callTool(tool, args)
			responses.push({ tool, text: JSON.stringify(result) })
			return result
		}
		const callApproved = async (tool: string, args: Record<string, unknown>) => {
			const pending = resultJson<{ token: string }>(await call(tool, args))
			return call(tool, { ...args, approval_token: pending.token })
		}

		await callApproved('secret_set', {
			name,
			value,
			allowed_hosts: ['api.example.com'],
			allowed_capabilities: ['secret_resolve'],
		})
		await call('secret_list', {})
		await call('secret_list', { scope: 'app' })
		await callApproved('secret_approve_host', { name, host: 'b.example.com' })
		await call('connector_set', {
			name: unique('leak_conn'),
			capability: 'http',
			secret_name: name,
			base_url: 'https://api.example.com',
		})
		await callApproved('oauth_register_client', {
			name: unique('leak_oauth'),
			client_id: 'client-id',
			client_secret_name: name,
			auth_url: 'https://auth.example.com/authorize',
			token_url: 'https://auth.example.com/token',
			result_secret_name: unique('LEAK_RESULT'),
		})
		await call('oauth_list_clients', {})
		await callApproved('retriever_set', { name: 'contract_leak', sql: 'SELECT * FROM secrets' })
		await call('retriever_run', { name: 'contract_leak' })
		await call('usage_stats', {})
		await call('meta_list_capabilities', {})
		const resolved = await call('secret_resolve', { name, purpose: 'leak check' })
		expect(resultJson(resolved)).toMatchObject({ value })
		await callApproved('secret_delete', { name })

		const leaks = responses.filter((r) => r.tool !== 'secret_resolve' && r.text.includes(value))
		expect(leaks.map((r) => r.tool)).toEqual([])

		const audit = await env.FERMI_DB.prepare('SELECT * FROM audit').all()
		expect(audit.results.length).toBeGreaterThan(0)
		expect(JSON.stringify(audit.results)).not.toContain(value)
	})
})

describeTool('package_set', () => {
	it('stores a package only after approval', async () => {
		const client = await session()
		const slug = `${unique('contract')}.js`
		const args = { slug, source: 'export const answer = 42', version: '1.2.3' }

		const pending = resultJson(await client.callTool('package_set', args))
		expect(pending.status).toBe('pending_approval')
		expect(resultJson(await client.callTool('package_get', { slug }))).toMatchObject({
			error: 'not_found',
		})

		expect(resultJson(await approved(client, 'package_set', args))).toMatchObject({
			status: 'stored',
			slug,
			version: '1.2.3',
			source_size: args.source.length,
		})
	})
})

describeTool('package_get', () => {
	it('returns the source of a stored package', async () => {
		const client = await session()
		const slug = `${unique('contract')}.js`
		await approved(client, 'package_set', { slug, source: 'export default 1' })
		expect(resultJson(await client.callTool('package_get', { slug }))).toEqual({
			slug,
			version: '0.0.0',
			description: null,
			source: 'export default 1',
			size: 16,
		})
		expect(resultJson(await client.callTool('package_get', { slug: 'missing.js' }))).toEqual({
			error: 'not_found',
			slug: 'missing.js',
		})
	})
})

describeTool('package_list', () => {
	it('lists package metadata without source', async () => {
		const client = await session()
		const slug = `${unique('contract')}.js`
		const source = 'export const listed = "src-marker"'
		await approved(client, 'package_set', { slug, source })
		const result = await client.callTool('package_list', {})
		const list = resultJson<{ packages: Array<{ slug: string }>; total: number }>(result)
		expect(list.packages.find((p) => p.slug === slug)).toMatchObject({
			slug,
			source_size: source.length,
		})
		expect(list.total).toBe(list.packages.length)
		expect(JSON.stringify(result)).not.toContain('src-marker')
	})
})

describeTool('package_delete', () => {
	it('deletes a package only after approval', async () => {
		const client = await session()
		const slug = `${unique('contract')}.js`
		await approved(client, 'package_set', { slug, source: 'export default 1' })

		expect(resultJson(await client.callTool('package_delete', { slug })).status).toBe(
			'pending_approval',
		)
		expect(resultJson(await client.callTool('package_get', { slug }))).toMatchObject({ slug })

		expect(resultJson(await approved(client, 'package_delete', { slug }))).toEqual({
			slug,
			deleted: true,
		})
		expect(resultJson(await client.callTool('package_get', { slug }))).toMatchObject({
			error: 'not_found',
		})
	})
})

describeTool('connector_set', () => {
	it('stores a connector without approval (low risk)', async () => {
		const client = await session()
		const name = unique('conn')
		const stored = resultJson(
			await client.callTool('connector_set', {
				name,
				capability: 'http',
				secret_name: 'API_KEY',
				base_url: 'https://api.example.com',
				default_headers: { accept: 'application/json' },
			}),
		)
		expect(stored).toMatchObject({
			status: 'stored',
			name,
			capability: 'http',
			secret_name: 'API_KEY',
			base_url: 'https://api.example.com',
			default_headers: { accept: 'application/json' },
		})
	})

	it('rejects a base_url that is not a URL', async () => {
		const client = await session()
		const result = await client.callTool('connector_set', {
			name: unique('conn'),
			capability: 'http',
			base_url: 'not a url',
		})
		expect(result.isError).toBe(true)
	})
})

describeTool('connector_get', () => {
	it('returns a stored connector or not_found', async () => {
		const client = await session()
		const name = unique('conn')
		await client.callTool('connector_set', { name, capability: 'http', base_url: 'https://a.test' })
		expect(resultJson(await client.callTool('connector_get', { name }))).toMatchObject({
			name,
			capability: 'http',
			secret_name: null,
			base_url: 'https://a.test',
		})
		expect(resultJson(await client.callTool('connector_get', { name: 'missing' }))).toEqual({
			error: 'not_found',
			name: 'missing',
		})
	})
})

describeTool('connector_list', () => {
	it('lists stored connectors', async () => {
		const client = await session()
		const name = unique('conn')
		await client.callTool('connector_set', { name, capability: 'http', base_url: 'https://a.test' })
		const list = resultJson<{ connectors: Array<{ name: string }>; total: number }>(
			await client.callTool('connector_list', {}),
		)
		expect(list.connectors.map((c) => c.name)).toContain(name)
		expect(list.total).toBe(list.connectors.length)
	})
})

describeTool('connector_delete', () => {
	it('deletes a connector', async () => {
		const client = await session()
		const name = unique('conn')
		await client.callTool('connector_set', { name, capability: 'http', base_url: 'https://a.test' })
		expect(resultJson(await client.callTool('connector_delete', { name }))).toEqual({
			name,
			deleted: true,
		})
		expect(resultJson(await client.callTool('connector_delete', { name }))).toEqual({
			name,
			deleted: false,
		})
	})
})

describeTool('retriever_set', () => {
	it('stores a retriever only after approval', async () => {
		const client = await session()
		const args = { name: 'contract_set', sql: 'SELECT :n AS n', param_schema: { n: 'a number' } }
		expect(resultJson(await client.callTool('retriever_get', { name: 'contract_set' }))).toEqual({
			error: 'not_found',
			name: 'contract_set',
		})
		expect(resultJson(await approved(client, 'retriever_set', args))).toMatchObject({
			status: 'stored',
			...args,
		})
	})
})

describeTool('retriever_get', () => {
	it('returns a stored retriever', async () => {
		const client = await session()
		await approved(client, 'retriever_set', { name: 'contract_get', sql: 'SELECT 1 AS one' })
		expect(
			resultJson(await client.callTool('retriever_get', { name: 'contract_get' })),
		).toMatchObject({ name: 'contract_get', sql: 'SELECT 1 AS one', param_schema: {} })
	})
})

describeTool('retriever_list', () => {
	it('lists stored retrievers by name', async () => {
		const client = await session()
		await approved(client, 'retriever_set', { name: 'contract_b', sql: 'SELECT 1' })
		await approved(client, 'retriever_set', { name: 'contract_a', sql: 'SELECT 2' })
		const list = resultJson<{ retrievers: Array<{ name: string }>; total: number }>(
			await client.callTool('retriever_list', {}),
		)
		expect(list.retrievers.map((r) => r.name)).toEqual(['contract_a', 'contract_b'])
		expect(list.total).toBe(2)
	})
})

describeTool('retriever_run', () => {
	it('runs a SELECT with bound params', async () => {
		const client = await session()
		await approved(client, 'retriever_set', { name: 'contract_run', sql: 'SELECT :n AS n' })
		expect(
			resultJson(
				await client.callTool('retriever_run', { name: 'contract_run', params: { n: 7 } }),
			),
		).toEqual({ name: 'contract_run', rows: [{ n: 7 }], rows_count: 1 })
		expect(resultJson(await client.callTool('retriever_run', { name: 'missing' }))).toEqual({
			error: 'retriever_not_found: missing',
		})
	})

	it('refuses DELETE, WITH … DELETE and PRAGMA and leaves the data intact', async () => {
		const client = await session()
		const writes = {
			contract_delete: "DELETE FROM retrievers WHERE name = 'contract_keep'",
			contract_cte_delete:
				"WITH doomed AS (SELECT 1) DELETE FROM retrievers WHERE name = 'contract_keep'",
			contract_pragma: 'PRAGMA table_info(retrievers)',
		}
		await approved(client, 'retriever_set', { name: 'contract_keep', sql: 'SELECT 1' })
		for (const [name, sql] of Object.entries(writes)) {
			await approved(client, 'retriever_set', { name, sql })
			expect(resultJson(await client.callTool('retriever_run', { name })), name).toEqual(
				READ_ONLY_SQL_ERROR,
			)
		}
		const kept = await env.FERMI_DB.prepare('SELECT name FROM retrievers WHERE name = ?')
			.bind('contract_keep')
			.first()
		expect(kept).toEqual({ name: 'contract_keep' })

		// a keyword inside a string literal is not a write
		await approved(client, 'retriever_set', { name: 'contract_lit', sql: "SELECT 'delete' AS w" })
		expect(resultJson(await client.callTool('retriever_run', { name: 'contract_lit' }))).toEqual({
			name: 'contract_lit',
			rows: [{ w: 'delete' }],
			rows_count: 1,
		})
	})
})

describeTool('retriever_delete', () => {
	it('deletes a retriever only after approval', async () => {
		const client = await session()
		await approved(client, 'retriever_set', { name: 'contract_del', sql: 'SELECT 1' })
		expect(
			resultJson(await client.callTool('retriever_delete', { name: 'contract_del' })).status,
		).toBe('pending_approval')
		expect(
			resultJson(await approved(client, 'retriever_delete', { name: 'contract_del' })),
		).toEqual({ name: 'contract_del', deleted: true })
		expect(resultJson(await client.callTool('retriever_list', {}))).toEqual({
			retrievers: [],
			total: 0,
		})
	})
})

function oauthArgs(name: string) {
	return {
		name,
		client_id: 'contract-client',
		client_secret_name: 'CONTRACT_CLIENT_SECRET',
		auth_url: 'https://auth.example.com/authorize',
		token_url: 'https://auth.example.com/token',
		scopes: ['read', 'write'],
		result_secret_name: 'CONTRACT_ACCESS_TOKEN',
	}
}

describeTool('oauth_register_client', () => {
	it('registers a client only after approval', async () => {
		const client = await session()
		const name = unique('oauth')
		expect(resultJson(await client.callTool('oauth_register_client', oauthArgs(name))).status).toBe(
			'pending_approval',
		)
		expect(resultJson(await client.callTool('oauth_get_client', { name }))).toMatchObject({
			error: 'not_found',
		})
		expect(
			resultJson(await approved(client, 'oauth_register_client', oauthArgs(name))),
		).toMatchObject({ status: 'stored', ...oauthArgs(name) })
	})
})

describeTool('oauth_get_client', () => {
	it('returns a registered client or not_found', async () => {
		const client = await session()
		const name = unique('oauth')
		await approved(client, 'oauth_register_client', oauthArgs(name))
		expect(resultJson(await client.callTool('oauth_get_client', { name }))).toMatchObject(
			oauthArgs(name),
		)
		expect(resultJson(await client.callTool('oauth_get_client', { name: 'missing' }))).toEqual({
			error: 'not_found',
			name: 'missing',
		})
	})
})

describeTool('oauth_list_clients', () => {
	it('lists registered clients', async () => {
		const client = await session()
		const name = unique('oauth')
		await approved(client, 'oauth_register_client', oauthArgs(name))
		const list = resultJson<{ clients: Array<{ name: string }>; total: number }>(
			await client.callTool('oauth_list_clients', {}),
		)
		expect(list.clients.map((c) => c.name)).toContain(name)
		expect(list.total).toBe(list.clients.length)
	})
})

describeTool('oauth_delete_client', () => {
	it('deletes a client only after approval', async () => {
		const client = await session()
		const name = unique('oauth')
		await approved(client, 'oauth_register_client', oauthArgs(name))
		expect(resultJson(await approved(client, 'oauth_delete_client', { name }))).toEqual({
			name,
			deleted: true,
		})
		expect(resultJson(await client.callTool('oauth_get_client', { name }))).toMatchObject({
			error: 'not_found',
		})
	})
})

describeTool('oauth_authorize_url', () => {
	it('returns the /oauth/start URL on the public base', async () => {
		const client = await session()
		const name = unique('oauth')
		await approved(client, 'oauth_register_client', oauthArgs(name))
		expect(resultJson(await client.callTool('oauth_authorize_url', { name }))).toEqual({
			start_url: `http://localhost:8787/oauth/start?provider=${name}`,
			client: name,
			scopes: ['read', 'write'],
		})
		expect(resultJson(await client.callTool('oauth_authorize_url', { name: 'missing' }))).toEqual({
			error: 'not_found',
			name: 'missing',
		})
	})
})

const STORAGE_STATE = JSON.stringify({
	cookies: [{ name: 'sid', value: 'cookie-marker-123', domain: 'chat.example.com' }],
	origins: [],
})

describeTool('web_session_capture', () => {
	it('stores an encrypted session only after approval', async () => {
		const client = await session()
		const name = unique('web')
		const args = { name, site: 'https://chat.example.com', storage_state: STORAGE_STATE }
		expect(resultJson(await client.callTool('web_session_capture', args)).status).toBe(
			'pending_approval',
		)
		const result = await approved(client, 'web_session_capture', { ...args, max_concurrent: 2 })
		expect(resultJson(result)).toMatchObject({
			ok: true,
			session: { name, site: args.site, max_concurrent: 2, revoked_at: null, active_leases: 0 },
		})
		expect(JSON.stringify(result)).not.toContain('cookie-marker-123')
		const row = await env.FERMI_DB.prepare(
			'SELECT encrypted_state FROM web_sessions WHERE name = ?',
		)
			.bind(name)
			.first<{ encrypted_state: string }>()
		expect(row?.encrypted_state).not.toContain('cookie-marker-123')
	})
})

describeTool('web_session_get', () => {
	it('returns metadata without the stored state', async () => {
		const client = await session()
		const name = unique('web')
		await approved(client, 'web_session_capture', {
			name,
			site: 'https://chat.example.com',
			storage_state: STORAGE_STATE,
		})
		const result = await client.callTool('web_session_get', { name })
		expect(resultJson(result)).toMatchObject({ ok: true, session: { name } })
		expect(JSON.stringify(result)).not.toContain('cookie-marker-123')
		expect(resultJson(await client.callTool('web_session_get', { name: 'missing' }))).toEqual({
			ok: false,
			error: 'not_found',
		})
	})
})

describeTool('web_session_list', () => {
	it('lists sessions without the stored state', async () => {
		const client = await session()
		const name = unique('web')
		await approved(client, 'web_session_capture', {
			name,
			site: 'https://chat.example.com',
			storage_state: STORAGE_STATE,
		})
		const result = await client.callTool('web_session_list', {})
		const list = resultJson<{ sessions: Array<{ name: string }> }>(result)
		expect(list.sessions.find((s) => s.name === name)).toMatchObject({ name, active_leases: 0 })
		expect(JSON.stringify(result)).not.toContain('cookie-marker-123')
	})
})

describeTool('web_session_invalidate', () => {
	it('revokes a session only after approval', async () => {
		const client = await session()
		const name = unique('web')
		await approved(client, 'web_session_capture', {
			name,
			site: 'https://chat.example.com',
			storage_state: STORAGE_STATE,
		})
		expect(resultJson(await approved(client, 'web_session_invalidate', { name }))).toEqual({
			ok: true,
		})
		const meta = resultJson<{ session: { revoked_at: number | null } }>(
			await client.callTool('web_session_get', { name }),
		)
		expect(meta.session.revoked_at).toEqual(expect.any(Number))
		expect(resultJson(await approved(client, 'web_session_invalidate', { name }))).toEqual({
			ok: false,
		})
	})
})

describeTool('totp_setup', () => {
	it('enrolls once after approval and refuses to re-enroll', async () => {
		await env.FERMI_DB.prepare("DELETE FROM secrets WHERE name = 'FERMI_TOTP_SECRET'").run()
		const client = await session()

		const enrolled = resultJson<{ status: string; otpauth_uri: string }>(
			await approved(client, 'totp_setup', { label: 'contract' }),
		)
		expect(enrolled.status).toBe('configured')
		expect(enrolled.otpauth_uri).toMatch(/^otpauth:\/\/totp\/.*contract.*secret=[A-Z2-7]+/)
		const list = resultJson<{ secrets: Array<{ name: string }> }>(
			await client.callTool('secret_list', { scope: 'app' }),
		)
		expect(list.secrets.map((s) => s.name)).toContain('FERMI_TOTP_SECRET')

		expect(resultJson(await approved(client, 'totp_setup', { label: 'contract' }))).toMatchObject({
			status: 'already_configured',
		})
	})
})
