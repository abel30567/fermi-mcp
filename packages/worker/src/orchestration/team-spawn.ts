import { z } from 'zod'
import { runAgentTurn } from '../channels/inference.ts'
import { defineTool } from '../lib/tool.ts'
import type { FermiMCP } from '../mcp/index.ts'

const ROLE_PROMPTS: Record<string, string> = {
	researcher:
		'You are a researcher. Gather information using read-only tools. Synthesize findings into a clear report.',
	writer: 'You are a writer. Draft content based on the instructions provided.',
	verifier:
		'You are a verification specialist. Your job is to try to break the implementation, not confirm it works. Output VERDICT: PASS, FAIL, or PARTIAL.',
	planner: 'You are a planning specialist. Analyze the problem and produce a structured plan.',
	executor: 'You are an executor. Follow the plan steps precisely.',
}

export function registerTeamSpawnTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'team_spawn',
		description: 'Spawn an isolated subagent with a specific role. Returns the agent final report.',
		schema: {
			role: z.enum(['researcher', 'writer', 'verifier', 'planner', 'executor']),
			instructions: z.string(),
			allowed_tools: z
				.array(z.string())
				.optional()
				.describe('Optional list of tool names the subagent may use'),
		},
		scope: ['network'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const maxConcurrent = Number.parseInt((await env.FERMI_KV.get('team:max_concurrent')) || '3')
			const active = await env.FERMI_DB.prepare(
				'SELECT COUNT(*) as count FROM team_spawns WHERE ended_at IS NULL',
			).first<{ count: number }>()
			if (active && active.count >= maxConcurrent) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Max concurrent spawns reached',
								limit: maxConcurrent,
							}),
						},
					],
				}
			}

			const spawnId = crypto.randomUUID()
			const parentSession = agent.state?.sessionId ?? null
			await env.FERMI_DB.prepare(
				'INSERT INTO team_spawns (id, parent_session, role, started_at) VALUES (?, ?, ?, ?)',
			)
				.bind(spawnId, parentSession, args.role, Date.now())
				.run()

			const rolePrompt = ROLE_PROMPTS[args.role] ?? ''
			const prompt = `${rolePrompt}\n\nInstructions: ${args.instructions}`

			let report: string
			try {
				report = await runAgentTurn(prompt, env, {
					channel: 'internal',
					chatId: spawnId,
				})
			} catch (err) {
				report = `Subagent error: ${err instanceof Error ? err.message : String(err)}`
			}

			await env.FERMI_DB.prepare('UPDATE team_spawns SET report = ?, ended_at = ? WHERE id = ?')
				.bind(report, Date.now(), spawnId)
				.run()

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							spawn_id: spawnId,
							role: args.role,
							report,
						}),
					},
				],
			}
		},
	})
}
