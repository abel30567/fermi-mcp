import { z } from 'zod'
import { defineTool } from '../lib/tool.ts'
import type { FermiMCP } from '../mcp/index.ts'

export function registerPlanModeTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'session_set_mode',
		description:
			'Switch session mode. Use "plan" to enter planning mode where only read-only tools are available.',
		schema: { mode: z.enum(['chat', 'plan']) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const sessionId = agent.state?.sessionId
			if (sessionId) {
				await env.FERMI_DB.prepare('UPDATE sessions SET mode = ? WHERE id = ?')
					.bind(args.mode, sessionId)
					.run()
			}
			agent.setState({ ...agent.state, mode: args.mode })
			return {
				content: [
					{
						type: 'text' as const,
						text: `Mode set to ${args.mode}. ${args.mode === 'plan' ? 'Only read-only tools available. Use plan_draft to create a plan.' : 'All tools available.'}`,
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'plan_draft',
		description: 'Draft a structured plan with numbered steps. Only available in plan mode.',
		schema: {
			steps: z.array(
				z.object({
					description: z.string(),
					tool: z.string().optional(),
					risk: z.enum(['low', 'med', 'high']).default('low'),
				}),
			),
		},
		scope: ['write:plans'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const planId = crypto.randomUUID()
			const sessionId = agent.state?.sessionId
			const steps = [...args.steps]
			if (steps.some((s) => s.risk === 'high')) {
				steps.push({
					description: 'Verify all high-risk steps completed correctly',
					tool: 'team_spawn',
					risk: 'low',
				})
			}
			await env.FERMI_DB.prepare(
				'INSERT INTO plans (id, session_id, steps_json, status, cursor) VALUES (?, ?, ?, ?, ?)',
			)
				.bind(planId, sessionId ?? null, JSON.stringify(steps), 'draft', 0)
				.run()
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							plan_id: planId,
							steps,
							status: 'draft',
							note: 'Plan created. User must call plan_approve to execute.',
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'plan_approve',
		description: 'Approve a drafted plan and transition session to execute mode.',
		schema: { plan_id: z.string() },
		scope: ['write:plans'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const result = await env.FERMI_DB.prepare(
				'UPDATE plans SET status = ?, approved_at = ? WHERE id = ? AND status = ?',
			)
				.bind('approved', Date.now(), args.plan_id, 'draft')
				.run()
			if (!result.meta.changes) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Plan not found or not in draft status',
								plan_id: args.plan_id,
							}),
						},
					],
				}
			}
			const sessionId = agent.state?.sessionId
			if (sessionId) {
				await env.FERMI_DB.prepare('UPDATE sessions SET mode = ? WHERE id = ?')
					.bind('execute', sessionId)
					.run()
			}
			agent.setState({ ...agent.state, mode: 'execute' })
			return {
				content: [
					{
						type: 'text' as const,
						text: `Plan ${args.plan_id} approved. Session in execute mode.`,
					},
				],
			}
		},
	})
}
