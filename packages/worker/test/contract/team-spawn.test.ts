import { env, fetchMock } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// team_spawn runs one inference loop against the Anthropic Messages API, faked
// here with fetchMock (ANTHROPIC_API_KEY is a fake value in wrangler.test.jsonc).

interface MessagesRequest {
	apiKey: string
	body: {
		model: string
		messages: Array<{ role: string; content: string }>
		tools: Array<{ name: string }>
	}
}

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.prepare('DELETE FROM team_spawns').run()
	await env.FERMI_KV.delete('team:max_concurrent')
	client = new McpClient()
	await client.initialize()
})

/** Answer one Messages API call with a final text reply and record the request. */
function anthropic(reply: string): MessagesRequest[] {
	const seen: MessagesRequest[] = []
	fetchMock
		.get('https://api.anthropic.com')
		.intercept({ path: '/v1/messages', method: 'POST' })
		.reply((opts) => {
			seen.push({
				apiKey: new Headers(opts.headers as Record<string, string>).get('x-api-key') ?? '',
				body: JSON.parse(String(opts.body)),
			})
			return {
				statusCode: 200,
				data: JSON.stringify({
					id: 'msg_contract',
					type: 'message',
					role: 'assistant',
					model: 'claude-haiku-4-5-20251001',
					content: [{ type: 'text', text: reply }],
					stop_reason: 'end_turn',
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 5 },
				}),
				responseOptions: { headers: { 'content-type': 'application/json' } },
			}
		})
	return seen
}

describeTool('team_spawn', () => {
	it('runs the role prompt on the pinned model and returns its report', async () => {
		const seen = anthropic('Found three sources.')
		const result = resultJson<{ spawn_id: string; role: string; report: string }>(
			await client.callTool('team_spawn', { role: 'researcher', instructions: 'Survey X' }),
		)
		expect(result).toMatchObject({ role: 'researcher', report: 'Found three sources.' })
		expect(seen).toHaveLength(1)
		expect(seen[0].apiKey).toBe('sk-ant-contract-token')
		expect(seen[0].body.model).toBe('claude-haiku-4-5-20251001')
		expect(seen[0].body.messages).toHaveLength(1)
		expect(seen[0].body.messages[0].content).toMatch(/^You are a researcher\./)
		expect(seen[0].body.messages[0].content).toMatch(/Instructions: Survey X$/)

		const row = await env.FERMI_DB.prepare(
			'SELECT role, report, ended_at FROM team_spawns WHERE id = ?1',
		)
			.bind(result.spawn_id)
			.first<{ role: string; report: string; ended_at: number | null }>()
		expect(row).toMatchObject({ role: 'researcher', report: 'Found three sources.' })
		expect(row?.ended_at).toBeGreaterThan(0)
	})

	it('offers the full curated tool set when allowed_tools is omitted', async () => {
		const seen = anthropic('ok')
		await client.callTool('team_spawn', { role: 'writer', instructions: 'Draft a note' })
		expect(seen[0].body.tools.map((t) => t.name)).toEqual([
			'memory_recall',
			'memory_write',
			'search',
			'fs_read',
			'fs_list',
		])
	})

	it('restricts the subagent to the allowed_tools subset', async () => {
		const seen = anthropic('ok')
		await client.callTool('team_spawn', {
			role: 'writer',
			instructions: 'Draft a note',
			allowed_tools: ['memory_recall'],
		})
		expect(seen[0].body.tools.map((t) => t.name)).toEqual(['memory_recall'])
	})

	it('rejects an unknown allowed_tools name before spawning', async () => {
		const seen = anthropic('ok')
		const result = resultJson<{ error: string; unknown: string[]; available: string[] }>(
			await client.callTool('team_spawn', {
				role: 'writer',
				instructions: 'Draft a note',
				allowed_tools: ['memory_recall', 'shell_exec'],
			}),
		)
		expect(result.error).toBe('Unknown tool in allowed_tools')
		expect(result.unknown).toEqual(['shell_exec'])
		expect(result.available).toContain('memory_recall')
		expect(seen).toHaveLength(0)
		const spawns = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM team_spawns').first<{
			n: number
		}>()
		expect(spawns?.n).toBe(0)
	})

	it('refuses to spawn past team:max_concurrent and calls no model', async () => {
		await env.FERMI_KV.put('team:max_concurrent', '1')
		await env.FERMI_DB.prepare(
			"INSERT INTO team_spawns (id, role, started_at) VALUES ('busy', 'planner', 1)",
		).run()
		const result = resultJson(
			await client.callTool('team_spawn', { role: 'planner', instructions: 'Plan it' }),
		)
		expect(result).toEqual({ error: 'Max concurrent spawns reached', limit: 1 })
	})
})
