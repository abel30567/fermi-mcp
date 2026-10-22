import { env } from 'cloudflare:test'
import { afterEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Contract cases for the admin tools: hooks, session mode, plans, the capability
// catalogue and usage stats. All are low risk, so none needs an approval token.

async function session() {
	const client = new McpClient()
	await client.initialize()
	return client
}

// plans rows reference sessions; drop them so other files can reset sessions.
afterEach(() => env.FERMI_DB.prepare('DELETE FROM plans').run())

const text = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? ''

describeTool('hooks_register', () => {
	it('stores a hook with its defaults', async () => {
		const client = await session()
		const registered = resultJson<{ id: string; event: string; status: string }>(
			await client.callTool('hooks_register', { event: 'memory:write', command: 'note' }),
		)
		expect(registered).toMatchObject({ event: 'memory:write', status: 'registered' })
		const row = await env.FERMI_DB.prepare('SELECT * FROM hooks WHERE id = ?')
			.bind(registered.id)
			.first()
		expect(row).toMatchObject({
			event: 'memory:write',
			matcher: null,
			command: 'note',
			scope: 'session',
			trust_level: 'allow',
			is_async: 0,
			once: 0,
			enabled: 1,
		})
	})

	it('rejects an unknown event', async () => {
		const client = await session()
		const result = await client.callTool('hooks_register', { event: 'nope' })
		expect(result.isError).toBe(true)
		expect(await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM hooks').first()).toEqual({ n: 0 })
	})
})

describeTool('hooks_list', () => {
	it('lists enabled hooks, optionally filtered by event', async () => {
		const client = await session()
		await client.callTool('hooks_register', { event: 'tool:after', matcher: 'x_*' })
		await client.callTool('hooks_register', { event: 'session:start' })

		expect(resultJson(await client.callTool('hooks_list', {}))).toMatchObject({ total: 2 })
		const filtered = resultJson<{ hooks: Array<{ event: string }>; total: number }>(
			await client.callTool('hooks_list', { event: 'tool:after' }),
		)
		expect(filtered.total).toBe(1)
		expect(filtered.hooks[0]).toMatchObject({ event: 'tool:after', matcher: 'x_*' })
	})
})

describeTool('hooks_test', () => {
	it('reports which hooks fire and the resulting decision', async () => {
		const client = await session()
		await client.callTool('hooks_register', {
			event: 'tool:before',
			matcher: 'memory_*',
			trust_level: 'ask',
		})

		const matched = resultJson<{ decision: string; hooks_fired: string[] }>(
			await client.callTool('hooks_test', { event: 'tool:before', tool_name: 'memory_write' }),
		)
		expect(matched).toMatchObject({ event: 'tool:before', tool: 'memory_write', decision: 'ask' })
		expect(matched.hooks_fired).toHaveLength(1)

		expect(
			resultJson(
				await client.callTool('hooks_test', { event: 'tool:before', tool_name: 'skill_load' }),
			),
		).toMatchObject({ decision: 'allow', hooks_fired: [] })
	})
})

describeTool('session_set_mode', () => {
	it('switches between plan and chat mode', async () => {
		const client = await session()
		expect(text(await client.callTool('session_set_mode', { mode: 'plan' }))).toMatch(
			/^Mode set to plan\./,
		)
		expect(
			resultJson(await client.callTool('hooks_register', { event: 'session:end' })),
		).toMatchObject({ error: 'plan_mode_restricted' })

		expect(text(await client.callTool('session_set_mode', { mode: 'chat' }))).toMatch(
			/^Mode set to chat\./,
		)
		expect(
			resultJson(await client.callTool('hooks_register', { event: 'session:end' })),
		).toMatchObject({ status: 'registered' })
	})
})

describeTool('plan_draft', () => {
	it('stores a draft plan in plan mode and appends a verify step for high-risk steps', async () => {
		const client = await session()
		await client.callTool('session_set_mode', { mode: 'plan' })
		const draft = resultJson<{ plan_id: string; steps: unknown[]; status: string }>(
			await client.callTool('plan_draft', {
				steps: [{ description: 'look' }, { description: 'delete', tool: 'fs_write', risk: 'high' }],
			}),
		)
		expect(draft.status).toBe('draft')
		expect(draft.steps).toEqual([
			{ description: 'look', risk: 'low' },
			{ description: 'delete', tool: 'fs_write', risk: 'high' },
			{
				description: 'Verify all high-risk steps completed correctly',
				tool: 'team_spawn',
				risk: 'low',
			},
		])
		const row = await env.FERMI_DB.prepare('SELECT status FROM plans WHERE id = ?')
			.bind(draft.plan_id)
			.first()
		expect(row).toEqual({ status: 'draft' })
	})
})

describeTool('plan_approve', () => {
	it('approves a draft once and leaves plan mode', async () => {
		const client = await session()
		await client.callTool('session_set_mode', { mode: 'plan' })
		const { plan_id } = resultJson<{ plan_id: string }>(
			await client.callTool('plan_draft', { steps: [{ description: 'one' }] }),
		)

		expect(text(await client.callTool('plan_approve', { plan_id }))).toBe(
			`Plan ${plan_id} approved. Session in execute mode.`,
		)
		// execute mode lets mutating tools run again
		expect(
			resultJson(await client.callTool('hooks_register', { event: 'session:end' })),
		).toMatchObject({ status: 'registered' })

		expect(resultJson(await client.callTool('plan_approve', { plan_id }))).toEqual({
			error: 'Plan not found or not in draft status',
			plan_id,
		})
	})
})

describeTool('meta_list_capabilities', () => {
	it('lists sandbox capabilities with their metadata', async () => {
		const client = await session()
		const catalogue = resultJson<{
			count: number
			capabilities: Array<{ name: string; risk: string; fields: Record<string, string> }>
		}>(await client.callTool('meta_list_capabilities', {}))
		expect(catalogue.count).toBe(catalogue.capabilities.length)
		expect(catalogue.capabilities.find((c) => c.name === 'secret_set')).toMatchObject({
			domain: 'secrets',
			risk: 'high',
			readOnly: false,
			fields: expect.objectContaining({ name: '', value: '' }),
		})
	})
})

describeTool('usage_stats', () => {
	it('aggregates the audit log by tool and outcome', async () => {
		const client = await session()
		await client.callTool('hooks_list', {})
		await client.callTool('hooks_list', {})
		await client.callTool('retriever_set', { name: 'contract_usage', sql: 'SELECT 1' })

		const byTool = resultJson<{ rows: Array<{ key?: string; calls: number }>; totals: unknown }>(
			await client.callTool('usage_stats', { tool: 'hooks_list' }),
		)
		expect(byTool.rows).toHaveLength(1)
		expect(byTool.rows[0]).toMatchObject({ calls: 2 })

		const byOutcome = resultJson<{ group_by: string; rows: Array<Record<string, unknown>> }>(
			await client.callTool('usage_stats', { group_by: 'outcome' }),
		)
		expect(byOutcome.group_by).toBe('outcome')
		expect(JSON.stringify(byOutcome.rows)).toContain('pending')
	})
})
