import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { registerAllCapabilities } from '../../src/capabilities/index.ts'
import { sha256Hex } from '../../src/channels/box-gateway.ts'
import { BOX_ALLOWED_TOOLS } from '../../src/lib/box-scope.ts'
import { registerBox } from '../../src/lib/fleet-store.ts'
import type { FermiMCP } from '../../src/mcp/index.ts'
import { registerTools } from '../../src/mcp/register-tools.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// The registry: every tool registerTools() hands to the MCP server for an owner.
async function registeredToolNames(): Promise<string[]> {
	const names: string[] = []
	const agent = {
		principal: 'owner',
		bindings: env,
		state: {},
		server: { tool: (name: string) => names.push(name) },
	} as unknown as FermiMCP
	registerAllCapabilities()
	await registerTools(agent)
	return names.sort()
}

async function session(path = '/mcp', headers: Record<string, string> = {}) {
	const client = new McpClient(path, headers)
	await client.initialize()
	return client
}

async function auditRows(tool?: string) {
	const stmt = tool
		? env.FERMI_DB.prepare('SELECT * FROM audit WHERE tool = ? ORDER BY id').bind(tool)
		: env.FERMI_DB.prepare('SELECT * FROM audit ORDER BY id')
	return (await stmt.all<{ tool: string; outcome: string }>()).results
}

describe('MCP contract: tool surface', () => {
	it('boots the real worker and lists every registered tool', async () => {
		const client = await session()
		const listed = (await client.listTools()).map((t) => t.name).sort()
		const registry = await registeredToolNames()
		expect(registry.length).toBeGreaterThan(0)
		console.log(`contract: listTools()=${listed.length} registry=${registry.length}`)
		expect(listed).toHaveLength(registry.length)
		expect(listed).toEqual(registry)
	})

	it('a box principal lists exactly the box allowlist', async () => {
		await registerBox(env.FERMI_DB, {
			boxId: 'box-contract',
			meta: { token_hash: await sha256Hex('box-secret') },
		})
		const client = await session('/box/mcp', { authorization: 'Bearer box-contract.box-secret' })
		const listed = (await client.listTools()).map((t) => t.name).sort()
		expect(listed).toEqual([...BOX_ALLOWED_TOOLS].sort())
	})
})

describe('MCP contract: harness', () => {
	it('never touches the network: mac.test is mocked, other hosts are refused', async () => {
		expect(env.MACOS_MCP_URL).toBe('http://mac.test')
		expect((await fetch('http://mac.test/mcp', { method: 'POST' })).status).toBe(503)
		await expect(fetch('https://example.com/')).rejects.toThrow()
	})
})

describe('MCP contract: defineTool guardrails', () => {
	it('plan mode blocks a mutating tool and allows a read tool', async () => {
		const client = await session()
		await client.callTool('session_set_mode', { mode: 'plan' })

		const blocked = resultJson(
			await client.callTool('hooks_register', { event: 'tool:before', trust_level: 'allow' }),
		)
		expect(blocked.error).toBe('plan_mode_restricted')
		const hooks = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM hooks').first<{
			n: number
		}>()
		expect(hooks?.n).toBe(0)

		const read = resultJson(await client.callTool('hooks_list', {}))
		expect(read).toEqual({ hooks: [], total: 0 })
	})

	it('a high-risk tool returns pending_approval and redeems once with its token', async () => {
		const client = await session()
		const args = { name: 'contract_r1', sql: 'SELECT 1' }

		const pending = resultJson<{ status: string; token: string }>(
			await client.callTool('retriever_set', args),
		)
		expect(pending.status).toBe('pending_approval')
		expect(pending.token).toMatch(/^[0-9a-f-]{36}$/)
		expect(await env.FERMI_DB.prepare('SELECT * FROM retrievers').all()).toMatchObject({
			results: [],
		})

		const redeemed = resultJson(
			await client.callTool('retriever_set', { ...args, approval_token: pending.token }),
		)
		expect(redeemed).toMatchObject({ status: 'stored', name: 'contract_r1' })

		// single use: the same token does not redeem twice
		const replay = resultJson(
			await client.callTool('retriever_set', { ...args, approval_token: pending.token }),
		)
		expect(replay).toEqual({ status: 'denied', reason: 'Invalid or expired approval token' })
	})

	it('a high-risk tool rejects a wrong token', async () => {
		const client = await session()
		const wrong = resultJson(
			await client.callTool('retriever_set', {
				name: 'contract_r2',
				sql: 'SELECT 1',
				approval_token: crypto.randomUUID(),
			}),
		)
		expect(wrong).toEqual({ status: 'denied', reason: 'Invalid or expired approval token' })
		const rows = await env.FERMI_DB.prepare('SELECT * FROM retrievers').all()
		expect(rows.results).toEqual([])
	})

	it('an approval token redeems only for the tool and args it was minted for', async () => {
		const client = await session()
		// retriever_delete and oauth_delete_client share the schema { name }, so the
		// cross-tool redeem below presents an identical args_hash and isolates the tool check.
		const argsA = { name: 'contract_r4' }
		const denied = { status: 'denied', reason: 'Invalid or expired approval token' }

		const pending = resultJson<{ status: string; token: string }>(
			await client.callTool('retriever_delete', argsA),
		)
		expect(pending.status).toBe('pending_approval')
		const approval_token = pending.token

		const otherArgs = resultJson(
			await client.callTool('retriever_delete', { name: 'contract_other', approval_token }),
		)
		expect(otherArgs).toEqual(denied)

		const otherTool = resultJson(
			await client.callTool('oauth_delete_client', { ...argsA, approval_token }),
		)
		expect(otherTool).toEqual(denied)

		// the mismatched attempts did not consume the token: the minted call still redeems
		const redeemed = resultJson(
			await client.callTool('retriever_delete', { ...argsA, approval_token }),
		)
		expect(redeemed).toEqual({ name: 'contract_r4', deleted: false })

		const replay = resultJson(
			await client.callTool('retriever_delete', { ...argsA, approval_token }),
		)
		expect(replay).toEqual(denied)

		expect((await auditRows('retriever_delete')).map((r) => r.outcome)).toEqual([
			'pending',
			'denied',
			'ok',
			'denied',
		])
		expect((await auditRows('oauth_delete_client')).map((r) => r.outcome)).toEqual(['denied'])
	})

	it('a tool:before hook with trust deny blocks the call', async () => {
		const client = await session()
		const hook = resultJson<{ status: string }>(
			await client.callTool('hooks_register', {
				event: 'tool:before',
				matcher: 'retriever_list',
				trust_level: 'deny',
			}),
		)
		expect(hook.status).toBe('registered')

		const blocked = resultJson<{ status: string; reason: string }>(
			await client.callTool('retriever_list', {}),
		)
		expect(blocked).toMatchObject({ status: 'denied', reason: 'Blocked by hook' })

		// the matcher scopes the hook: other tools still run
		expect(resultJson(await client.callTool('hooks_list', {}))).toMatchObject({ total: 1 })
	})

	it('every call writes one audit row', async () => {
		const client = await session()
		const expectOneRow = async (
			name: string,
			args: Record<string, unknown>,
			outcome: string,
		): Promise<void> => {
			const before = (await auditRows()).length
			const result = await client.callTool(name, args)
			const rows = await auditRows()
			expect(rows.length - before, `${name} → ${JSON.stringify(result)}`).toBe(1)
			expect(rows.at(-1)).toMatchObject({ tool: name, outcome })
		}

		await expectOneRow('retriever_list', {}, 'ok')
		await expectOneRow('retriever_set', { name: 'contract_r3', sql: 'SELECT 1' }, 'pending')
		await expectOneRow(
			'retriever_set',
			{ name: 'contract_r3', sql: 'SELECT 1', approval_token: 'nope' },
			'denied',
		)
		await expectOneRow(
			'hooks_register',
			{ event: 'tool:before', matcher: 'retriever_get', trust_level: 'deny' },
			'ok',
		)
		await expectOneRow('retriever_get', { name: 'contract_r3' }, 'denied')
	})

	it('a plan-mode denial writes one denied audit row', async () => {
		const client = await session()
		await client.callTool('session_set_mode', { mode: 'plan' })
		const before = (await auditRows('hooks_register')).length
		const blocked = resultJson(
			await client.callTool('hooks_register', { event: 'tool:before', trust_level: 'allow' }),
		)
		expect(blocked.error).toBe('plan_mode_restricted')
		const rows = await auditRows('hooks_register')
		expect(rows).toHaveLength(before + 1)
		expect(rows.at(-1)).toMatchObject({ tool: 'hooks_register', outcome: 'denied' })
	})
})
