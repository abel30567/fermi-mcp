import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/channels/box-gateway.ts'
import worker from '../../src/index.ts'
import { registerBox } from '../../src/lib/fleet-store.ts'
import { KNOWLEDGE_ALLOWED_TOOLS } from '../../src/lib/knowledge-scope.ts'
import { McpClient, type ToolResult, parseRpcBody, resultJson } from './mcp-client.ts'
import { resetTables } from './tool-call.ts'

// Knowledge principal (ISSUE-88): /k/mcp with a namespace-bound token, six tools,
// and a data wall between the namespace and the owner's / box's stores.

const ADMIN = 'knowledge-admin-bearer'
const adminEnv = { ...env, FERMI_BEARER_TOKEN: ADMIN } as Env
const SIX = ['memory_recall', 'memory_write', 'search', 'skill_load', 'skill_search', 'skill_set']

async function send(path: string, init: RequestInit = {}, e: Env = adminEnv) {
	const ctx = createExecutionContext()
	const res = await worker.fetch(new Request(`http://fermi.test${path}`, init), e, ctx)
	await waitOnExecutionContext(ctx)
	return res
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const postJson = (body: unknown, headers: Record<string, string>): RequestInit => ({
	method: 'POST',
	headers: { ...headers, 'content-type': 'application/json' },
	body: JSON.stringify(body),
})

interface Minted {
	ok: boolean
	token: string
	token_id: string
	namespace: string
	label: string
	created_at: number
	expires_at: number | null
}

async function mint(namespace: string, extra: Record<string, unknown> = {}): Promise<Minted> {
	const res = await send(
		'/admin/knowledge/tokens',
		postJson({ namespace, label: `test ${namespace}`, ...extra }, bearer(ADMIN)),
	)
	expect(res.status).toBe(200)
	return res.json()
}

async function knowledge(token: string) {
	const client = new McpClient('/k/mcp', bearer(token))
	await client.initialize()
	return client
}

async function owner() {
	const client = new McpClient()
	await client.initialize()
	return client
}

async function box() {
	await registerBox(env.FERMI_DB, {
		boxId: 'box-knowledge',
		meta: { token_hash: await sha256Hex('box-secret') },
	})
	const client = new McpClient('/box/mcp', bearer('box-knowledge.box-secret'))
	await client.initialize()
	return client
}

/** An MCP initialize on `path`, returning only the HTTP status. */
async function initStatus(path: string, headers: Record<string, string>, e?: Env) {
	const init = postJson(
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'knowledge-test', version: '0' },
			},
		},
		{ ...headers, accept: 'application/json, text/event-stream' },
	)
	const res = e ? await send(path, init, e) : await SELF.fetch(`http://fermi.test${path}`, init)
	await res.body?.cancel()
	return res.status
}

async function expectUnknownTool(client: McpClient, name: string) {
	let result: ToolResult | undefined
	try {
		result = await client.callTool(name, {})
	} catch (err) {
		expect(String(err)).toContain(`Tool ${name} not found`)
		return
	}
	expect(result.isError).toBe(true)
	expect(result.content[0]?.text).toContain(`Tool ${name} not found`)
}

type Recall = { results: Array<{ id: number; body: string }>; total: number }
type Search = { matches: Array<{ type: string; id: string; name: string; snippet: string }> }
type SkillSearch = { results: Array<{ slug: string }>; total: number }

const recall = async (c: McpClient, query: string, limit = 10) =>
	resultJson<Recall>(await c.callTool('memory_recall', { query, limit }))
const search = async (c: McpClient, query: string, types?: string[]) =>
	resultJson<Search>(await c.callTool('search', { query, ...(types ? { types } : {}), limit: 50 }))
const skillSearch = async (c: McpClient, query: string) =>
	resultJson<SkillSearch>(await c.callTool('skill_search', { query, limit: 50 }))
const skillLoad = async (c: McpClient, slug: string) =>
	resultJson<Record<string, unknown>>(await c.callTool('skill_load', { slug }))

beforeEach(async () => {
	await resetTables('knowledge_tokens', 'knowledge_memory', 'knowledge_skills')
	await env.FERMI_DB.prepare("DELETE FROM memory WHERE body LIKE '%kn88%'").run()
	await env.FERMI_DB.prepare("DELETE FROM skills WHERE slug LIKE 'kn88-%'").run()
})

describe('knowledge MCP: endpoint', () => {
	it('speaks plain JSON-RPC over POST with protocol 2025-06-18 and Mcp-Session-Id', async () => {
		const { token } = await mint('a/one')
		const headers = {
			...bearer(token),
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		}
		const post = (body: unknown, sid?: string) =>
			SELF.fetch('http://fermi.test/k/mcp', {
				method: 'POST',
				headers: sid ? { ...headers, 'mcp-session-id': sid } : headers,
				body: JSON.stringify(body),
			})
		const init = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'gw', version: '1' },
			},
		})
		expect(init.status).toBe(200)
		expect(init.headers.get('content-type')).toMatch(/application\/json|text\/event-stream/)
		const sid = init.headers.get('mcp-session-id') ?? ''
		expect(sid).toBeTruthy()
		const [initReply] = await parseRpcBody(init)
		expect(initReply?.result).toMatchObject({ protocolVersion: '2025-06-18' })
		const ack = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
		expect(ack.status).toBe(202)
		const call = await post(
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'memory_write', arguments: { kind: 'fact', body: 'kn88 gateway' } },
			},
			sid,
		)
		expect(call.status).toBe(200)
		const reply = (await parseRpcBody(call)).find((m) => m.id === 2)
		const text = (reply?.result as ToolResult).content[0]?.text ?? ''
		expect(JSON.parse(text)).toMatchObject({ kind: 'fact', pinned: false })
	})
})

describe('knowledge MCP: criterion 1, allowlist', () => {
	it('lists exactly the six tools and refuses any other as unknown', async () => {
		const { token } = await mint('a/one')
		const client = await knowledge(token)
		const names = (await client.listTools()).map((t) => t.name).sort()
		expect(names).toEqual(SIX)
		expect([...KNOWLEDGE_ALLOWED_TOOLS].sort()).toEqual(SIX)
		for (const name of ['secret_resolve', 'execute', 'mac_shell', 'memory_delete', 'fs_read']) {
			await expectUnknownTool(client, name)
		}
	})
})

describe('knowledge MCP: criterion 2, authentication', () => {
	it('answers 401 without a live token of its own on /k/mcp', async () => {
		const live = await mint('a/one')
		const revoked = await mint('a/one')
		await send('/admin/knowledge/revoke', postJson({ token_id: revoked.token_id }, bearer(ADMIN)))
		const expired = await mint('a/one', { expires_at: Date.now() - 1000 })
		await registerBox(env.FERMI_DB, {
			boxId: 'box-knowledge',
			meta: { token_hash: await sha256Hex('box-secret') },
		})
		const cases: Array<[string, Record<string, unknown>]> = [
			['no token', {}],
			['not bearer', { authorization: live.token }],
			['no dot', bearer(live.token.replace('.', ''))],
			['empty id', bearer(`.${live.token.split('.')[1]}`)],
			['empty secret', bearer(`${live.token_id}.`)],
			['wrong secret', bearer(`${live.token_id}.${'0'.repeat(64)}`)],
			['unknown id', bearer(`kt_0000000000000000.${live.token.split('.')[1]}`)],
			['revoked', bearer(revoked.token)],
			['expired', bearer(expired.token)],
			['box token', bearer('box-knowledge.box-secret')],
			['admin bearer', bearer(ADMIN)],
		]
		for (const [label, headers] of cases) {
			expect([
				label,
				await initStatus('/k/mcp', headers as Record<string, string>, adminEnv),
			]).toEqual([label, 401])
		}
		expect(await initStatus('/k/mcp', bearer(live.token))).toBe(200)
	})

	it('a knowledge token gets 401 on /mcp, /box/mcp and every /admin/* route', async () => {
		const { token } = await mint('a/one')
		const k = bearer(token)
		// /mcp: OAuth in front, as in production, and with the local bypass plus auth enabled.
		const prod = { ...adminEnv, FERMI_LOCAL_DEV: undefined } as unknown as Env
		expect(await initStatus('/mcp', k, prod)).toBe(401)
		const both = { ...adminEnv, FERMI_LOCAL_DEV: 'true', FERMI_AUTH_ENABLED: 'true' } as Env
		expect(await initStatus('/mcp', k, both)).toBe(401)
		expect(await initStatus('/box/mcp', k, adminEnv)).toBe(401)

		const admin: Array<[string, string]> = [
			['POST', '/admin/seed-skills'],
			['POST', '/admin/tg/set-webhook'],
			['POST', '/admin/narrate'],
			['POST', '/admin/fleet/launch'],
			['POST', '/admin/session/capture'],
			['GET', '/admin/fleet/artifact?key=artifacts/x'],
			['GET', '/admin/fleet/reservations'],
			['POST', '/admin/fleet/release'],
			['POST', '/admin/fleet/pin-runner'],
			['PUT', '/admin/fleet/harness?name=x.tar.gz'],
			['POST', '/admin/fleet/pin-harness'],
			['GET', '/admin/fleet/config'],
			['POST', '/admin/fleet/config'],
			['GET', '/admin/fleet/status'],
			['GET', '/admin/knowledge/tokens'],
			['POST', '/admin/knowledge/tokens'],
			['POST', '/admin/knowledge/revoke'],
			['GET', '/admin/tasks/pending'],
			['POST', '/admin/broker/claim'],
			['POST', '/admin/broker/complete'],
			['GET', '/admin/session/state?name=x'],
		]
		for (const [method, path] of admin) {
			const res = await send(path, {
				method,
				headers: { ...k, 'content-type': 'application/json' },
				...(method === 'GET' ? {} : { body: JSON.stringify({ namespace: 'x', token_id: 'x' }) }),
			})
			await res.body?.cancel()
			expect([method, path, res.status]).toEqual([method, path, 401])
		}
	})

	it('refuses a session id opened by another token or by the owner', async () => {
		const a = await mint('a/one')
		const b = await mint('b/two')
		const clientA = await knowledge(a.token)
		await clientA.callTool('memory_write', { kind: 'fact', body: 'kn88 only-a' })

		const hijack = new McpClient('/k/mcp', bearer(b.token))
		hijack.sessionId = clientA.sessionId
		await expect(hijack.callTool('memory_recall', { query: 'kn88' })).rejects.toThrow('HTTP 401')

		const ownerClient = await owner()
		const reuse = new McpClient('/k/mcp', bearer(a.token))
		reuse.sessionId = ownerClient.sessionId
		await expect(reuse.listTools()).rejects.toThrow('HTTP 401')
	})
})

describe('knowledge MCP: criterion 3, namespaces are walled from each other', () => {
	it('a memory and a skill of one namespace are invisible to another', async () => {
		const a = await knowledge((await mint('a/one')).token)
		const b = await knowledge((await mint('b/two')).token)
		await a.callTool('memory_write', { kind: 'fact', body: 'kn88 secret of a' })
		const set = resultJson(
			await a.callTool('skill_set', {
				slug: 'kn88-a-skill',
				body: '# Procedure\nkn88 step',
				metadata: { name: 'kn88 a skill', description: 'kn88 how-to' },
			}),
		)
		expect(set).toEqual({ slug: 'kn88-a-skill', version: 1, created: true, r2_key: null })

		expect((await recall(a, 'kn88')).results.map((r) => r.body)).toEqual(['kn88 secret of a'])
		const aSearch = await search(a, 'kn88', ['memory', 'skill'])
		expect(aSearch.matches.map((m) => m.type).sort()).toEqual(['memory', 'skill'])
		expect((await skillSearch(a, 'kn88')).results.map((s) => s.slug)).toEqual(['kn88-a-skill'])
		expect(await skillLoad(a, 'kn88-a-skill')).toMatchObject({
			skill: { slug: 'kn88-a-skill', name: 'kn88 a skill' },
			body: expect.stringContaining('kn88 step'),
			resources: [],
		})

		expect(await recall(b, 'kn88')).toMatchObject({ results: [], total: 0 })
		expect((await search(b, 'kn88', ['memory', 'skill'])).matches).toEqual([])
		expect((await search(b, 'kn88')).matches).toEqual([])
		expect((await skillSearch(b, 'kn88')).results).toEqual([])
		expect(await skillLoad(b, 'kn88-a-skill')).toEqual({
			error: 'skill_not_found',
			slug: 'kn88-a-skill',
		})
		const memId = (await recall(a, 'kn88')).results[0]?.id
		const entity = resultJson<Search>(await b.callTool('search', { entity: `${memId}:memory` }))
		expect(entity.matches).toEqual([])
	})

	it('search serves only memory and skill types', async () => {
		const a = await knowledge((await mint('a/one')).token)
		await a.callTool('memory_write', { kind: 'fact', body: 'kn88 memory' })
		expect(
			(await search(a, 'memory', ['capability', 'secret', 'connector', 'package'])).matches,
		).toEqual([])
		// 'memory' names owner capabilities (memory_recall, ...); none surfaces here.
		const all = await search(a, 'memory')
		expect(all.matches.every((m) => m.type === 'memory' || m.type === 'skill')).toBe(true)
		expect(all.matches.map((m) => m.snippet)).toEqual(['kn88 memory'])
	})
})

describe('knowledge MCP: criterion 4, owner and box never see namespaced rows', () => {
	it('owner recall/search/skill_search/skill_load and box skill tools miss knowledge rows', async () => {
		const a = await knowledge((await mint('a/one')).token)
		await a.callTool('memory_write', { kind: 'fact', body: 'kn88 production text' })
		await a.callTool('skill_set', {
			slug: 'kn88-prod-skill',
			body: 'kn88 production procedure',
			metadata: { name: 'kn88 prod', description: 'kn88 production' },
		})

		const o = await owner()
		expect((await recall(o, 'kn88')).results).toEqual([])
		const oSearch = await search(o, 'kn88', ['memory', 'skill'])
		expect(oSearch.matches.filter((m) => m.type === 'memory' || m.type === 'skill')).toEqual([])
		expect((await skillSearch(o, 'kn88')).results).toEqual([])
		expect(await skillLoad(o, 'kn88-prod-skill')).toEqual({
			error: 'skill_not_found',
			slug: 'kn88-prod-skill',
		})

		const bx = await box()
		expect((await skillSearch(bx, 'kn88')).results).toEqual([])
		expect(await skillLoad(bx, 'kn88-prod-skill')).toEqual({
			error: 'skill_not_found',
			slug: 'kn88-prod-skill',
		})
	})
})

describe('knowledge MCP: criterion 5, the owner side is out of reach', () => {
	it('cannot read an owner memory or skill, nor overwrite an owner skill', async () => {
		const o = await owner()
		await o.callTool('memory_write', { kind: 'fact', body: 'kn88 owner private' })
		await o.callTool('skill_set', {
			slug: 'kn88-owner-skill',
			body: 'kn88 owner procedure',
			metadata: { name: 'kn88 owner', description: 'kn88 owner how-to' },
		})
		const before = await env.FERMI_DB.prepare('SELECT * FROM skills WHERE slug = ?')
			.bind('kn88-owner-skill')
			.first()
		const bodyBefore = await (
			await env.FERMI_BUCKET.get('skills/kn88-owner-skill/SKILL.md')
		)?.text()
		expect(bodyBefore).toContain('kn88 owner procedure')

		const a = await knowledge((await mint('a/one')).token)
		expect((await recall(a, 'kn88')).results).toEqual([])
		expect((await search(a, 'kn88')).matches).toEqual([])
		expect((await skillSearch(a, 'kn88')).results).toEqual([])
		expect(await skillLoad(a, 'kn88-owner-skill')).toEqual({
			error: 'skill_not_found',
			slug: 'kn88-owner-skill',
		})

		const refused = await a.callTool('skill_set', {
			slug: 'kn88-owner-skill',
			body: 'kn88 hijacked',
			metadata: { name: 'hijacked', description: 'hijacked' },
		})
		expect(refused.isError).toBe(true)
		expect(refused.content[0]?.text).toContain('skill_slug_reserved')
		expect(
			await env.FERMI_DB.prepare('SELECT * FROM skills WHERE slug = ?')
				.bind('kn88-owner-skill')
				.first(),
		).toEqual(before)
		expect(await (await env.FERMI_BUCKET.get('skills/kn88-owner-skill/SKILL.md'))?.text()).toBe(
			bodyBefore,
		)
		expect(await skillLoad(a, 'kn88-owner-skill')).toMatchObject({ error: 'skill_not_found' })
		expect(await skillLoad(o, 'kn88-owner-skill')).toMatchObject({
			body: bodyBefore,
			skill: { name: 'kn88 owner' },
		})
	})
})

describe('knowledge MCP: criterion 6, limits apply after the namespace filter', () => {
	it('returns the 3 namespace memories under 60 newer owner matches', async () => {
		const a = await knowledge((await mint('a/one')).token)
		for (let i = 0; i < 3; i++) {
			await a.callTool('memory_write', { kind: 'fact', body: `kn88 needle ns ${i}` })
		}
		const later = Date.now() + 60_000
		await env.FERMI_DB.batch(
			Array.from({ length: 60 }, (_, i) =>
				env.FERMI_DB.prepare(
					'INSERT INTO memory (kind, body, created_at, pinned) VALUES (?1, ?2, ?3, 1)',
				).bind('fact', `kn88 needle owner ${i}`, later + i),
			),
		)
		const got = await recall(a, 'kn88 needle', 5)
		expect(got.results.map((r) => r.body).sort()).toEqual([
			'kn88 needle ns 0',
			'kn88 needle ns 1',
			'kn88 needle ns 2',
		])
		expect(got.total).toBe(3)
	})
})

describe('knowledge MCP: criterion 7, one call, no approval round', () => {
	it('all six tools answer in one call', async () => {
		const a = await knowledge((await mint('a/one')).token)
		const calls: Array<[string, Record<string, unknown>]> = [
			['memory_write', { kind: 'fact', body: 'kn88 one call', pinned: true }],
			['skill_set', { slug: 'kn88-one', body: 'kn88 body', metadata: { name: 'kn88 one' } }],
			['memory_recall', { query: 'kn88', limit: 5, sort_by: 'created_at' }],
			['skill_search', { query: 'kn88', limit: 5 }],
			['skill_load', { slug: 'kn88-one' }],
			['search', { query: 'kn88', types: ['memory', 'skill'], limit: 5 }],
		]
		const out: Record<string, Record<string, unknown>> = {}
		for (const [name, args] of calls) {
			const res = await a.callTool(name, args)
			expect(res.isError).toBeFalsy()
			expect(res.content[0]?.text).not.toContain('pending_approval')
			out[name] = resultJson(res)
		}
		expect(out.memory_write).toMatchObject({ kind: 'fact', pinned: true })
		expect(out.skill_set).toMatchObject({ slug: 'kn88-one', version: 1, created: true })
		expect(out.memory_recall).toMatchObject({ query: 'kn88', sort_by: 'created_at', total: 1 })
		expect(out.skill_search).toMatchObject({ query: 'kn88', total: 1 })
		expect(out.skill_load).toMatchObject({ skill: { slug: 'kn88-one' }, resources: [] })
		expect((out.search as Search).matches.length).toBe(2)
	})
})

describe('knowledge MCP: criterion 8, admin routes', () => {
	it('mint, list and revoke need FERMI_BEARER_TOKEN', async () => {
		for (const [method, path] of [
			['POST', '/admin/knowledge/tokens'],
			['GET', '/admin/knowledge/tokens'],
			['POST', '/admin/knowledge/revoke'],
		]) {
			for (const headers of [{}, bearer('wrong')]) {
				const res = await send(path, {
					method,
					headers,
					...(method === 'POST' ? { body: '{"namespace":"a/one","label":"x"}' } : {}),
				})
				expect([path, res.status]).toEqual([path, 401])
			}
			const noAdmin = { ...env, FERMI_BEARER_TOKEN: undefined } as unknown as Env
			expect((await send(path, { method, headers: bearer('') }, noAdmin)).status).toBe(401)
		}
		expect(
			await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM knowledge_tokens').first(),
		).toEqual({ n: 0 })
	})

	it('validates the namespace and label', async () => {
		for (const body of [
			{ namespace: 'Owner/Name', label: 'x' },
			{ namespace: '/lead', label: 'x' },
			{ namespace: 'a'.repeat(65), label: 'x' },
			{ namespace: 'a/one' },
			{ namespace: 'a/one', label: 'x', expires_at: 'soon' },
		]) {
			const res = await send('/admin/knowledge/tokens', postJson(body, bearer(ADMIN)))
			expect([body, res.status]).toEqual([body, 400])
		}
	})

	it('stores only a hash, lists no secret, and revocation closes an open session', async () => {
		const minted = await mint('owner/name')
		expect(minted).toMatchObject({ ok: true, namespace: 'owner/name', expires_at: null })
		const [id, secret] = minted.token.split('.') as [string, string]
		expect(id).toBe(minted.token_id)
		const hash = await sha256Hex(secret)

		const row = await env.FERMI_DB.prepare('SELECT * FROM knowledge_tokens WHERE token_id = ?')
			.bind(id)
			.first<Record<string, unknown>>()
		expect(row?.secret_hash).toBe(hash)
		expect(JSON.stringify(row)).not.toContain(secret)

		const listRes = await send('/admin/knowledge/tokens', { headers: bearer(ADMIN) })
		const listText = await listRes.text()
		expect(listText).not.toContain(secret)
		expect(listText).not.toContain(hash)
		expect(JSON.parse(listText).tokens).toEqual([
			{
				token_id: id,
				namespace: 'owner/name',
				label: 'test owner/name',
				created_at: minted.created_at,
				expires_at: null,
				revoked_at: null,
			},
		])

		const client = await knowledge(minted.token)
		await client.callTool('memory_recall', { query: 'kn88' })
		const revoke = await send('/admin/knowledge/revoke', postJson({ token_id: id }, bearer(ADMIN)))
		expect(await revoke.json()).toEqual({ ok: true, token_id: id, revoked: true })
		await expect(client.callTool('memory_recall', { query: 'kn88' })).rejects.toThrow('HTTP 401')
		const listed = (await (
			await send('/admin/knowledge/tokens', { headers: bearer(ADMIN) })
		).json()) as {
			tokens: Array<{ revoked_at: number | null }>
		}
		expect(listed.tokens[0]?.revoked_at).toBeGreaterThan(0)
		const unknown = await send(
			'/admin/knowledge/revoke',
			postJson({ token_id: 'kt_missing' }, bearer(ADMIN)),
		)
		expect(unknown.status).toBe(404)
	})
})

describe('knowledge MCP: criterion 9, audit', () => {
	it('writes an audit row per call naming principal, token and namespace', async () => {
		const minted = await mint('a/one')
		const a = await knowledge(minted.token)
		await a.callTool('memory_write', { kind: 'fact', body: 'kn88 audited' })
		await a.callTool('memory_recall', { query: 'kn88' })
		await a.callTool('skill_set', { slug: 'kn88-audit', body: 'b' })
		await a.callTool('skill_search', { query: 'kn88' })
		await a.callTool('skill_load', { slug: 'kn88-audit' })
		await a.callTool('search', { query: 'kn88' })
		const { results } = await env.FERMI_DB.prepare(
			'SELECT tool, outcome, principal, token_id, namespace FROM audit WHERE token_id = ? ORDER BY id',
		)
			.bind(minted.token_id)
			.all()
		expect(results).toEqual(
			['memory_write', 'memory_recall', 'skill_set', 'skill_search', 'skill_load', 'search'].map(
				(tool) => ({
					tool,
					outcome: 'ok',
					principal: 'knowledge',
					token_id: minted.token_id,
					namespace: 'a/one',
				}),
			),
		)
	})
})
