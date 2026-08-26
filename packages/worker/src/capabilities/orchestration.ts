import { z } from 'zod'
import { runAgentTurn } from '../channels/inference.ts'
import { defineCapability } from '../lib/capability.ts'

export function registerOrchestrationCapabilities() {
	defineCapability({
		name: 'plan_draft',
		domain: 'plan',
		description: 'Draft a structured plan with numbered steps.',
		inputSchema: z.object({
			steps: z.array(
				z.object({
					description: z.string(),
					tool: z.string().optional(),
					risk: z.enum(['low', 'med', 'high']).default('low'),
				}),
			),
			session_id: z
				.string()
				.optional()
				.describe('Session id to attach plan to. Optional; uses NULL otherwise.'),
		}),
		scope: ['write:plans'],
		risk: 'low',
		readOnly: false,
		keywords: ['plan', 'draft', 'steps'],
		handler: async (args, env) => {
			const planId = crypto.randomUUID()
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
				.bind(planId, args.session_id ?? null, JSON.stringify(steps), 'draft', 0)
				.run()
			return { plan_id: planId, steps, status: 'draft' }
		},
	})

	defineCapability({
		name: 'plan_approve',
		domain: 'plan',
		description: 'Approve a drafted plan.',
		inputSchema: z.object({ plan_id: z.string().min(1) }),
		scope: ['write:plans'],
		risk: 'low',
		readOnly: false,
		keywords: ['plan', 'approve'],
		handler: async (args, env) => {
			const res = await env.FERMI_DB.prepare(
				'UPDATE plans SET status = ?, approved_at = ? WHERE id = ? AND status = ?',
			)
				.bind('approved', Date.now(), args.plan_id, 'draft')
				.run()
			return { plan_id: args.plan_id, approved: (res.meta.changes ?? 0) > 0 }
		},
	})

	defineCapability({
		name: 'team_spawn',
		domain: 'team',
		description:
			'Spawn an isolated subagent with a specific role. risk:med — depth-bounded re-entry into MCP.',
		inputSchema: z.object({
			role: z.enum(['researcher', 'writer', 'verifier', 'planner', 'executor']),
			instructions: z.string(),
			parent_session: z.string().optional(),
		}),
		scope: ['network'],
		risk: 'med',
		readOnly: false,
		keywords: ['team', 'spawn', 'subagent', 'role'],
		handler: async (args, env) => {
			const max = Number.parseInt((await env.FERMI_KV.get('team:max_concurrent')) || '3')
			const active = await env.FERMI_DB.prepare(
				'SELECT COUNT(*) as count FROM team_spawns WHERE ended_at IS NULL',
			).first<{ count: number }>()
			if (active && active.count >= max) {
				return { error: 'max_concurrent_reached', limit: max }
			}
			const spawnId = crypto.randomUUID()
			await env.FERMI_DB.prepare(
				'INSERT INTO team_spawns (id, parent_session, role, started_at) VALUES (?, ?, ?, ?)',
			)
				.bind(spawnId, args.parent_session ?? null, args.role, Date.now())
				.run()
			let report: string
			try {
				report = await runAgentTurn(args.instructions, env, {
					channel: 'internal',
					chatId: spawnId,
				})
			} catch (err) {
				report = `Subagent error: ${err instanceof Error ? err.message : String(err)}`
			}
			await env.FERMI_DB.prepare('UPDATE team_spawns SET report = ?, ended_at = ? WHERE id = ?')
				.bind(report, Date.now(), spawnId)
				.run()
			return { spawn_id: spawnId, role: args.role, report }
		},
	})

	defineCapability({
		name: 'hooks_register',
		domain: 'hooks',
		description: 'Register a hook that fires on a specific event.',
		inputSchema: z.object({
			event: z.enum([
				'tool:before',
				'tool:after',
				'session:start',
				'session:end',
				'plan:approve',
				'plan:step',
				'memory:write',
				'memory:decay',
				'skill:loaded',
				'team:spawn',
				'team:report',
			]),
			matcher: z.string().optional(),
			command: z.string().optional(),
			scope: z.enum(['user', 'project', 'session']).default('session'),
			trust_level: z.enum(['allow', 'ask', 'deny']).default('allow'),
			is_async: z.boolean().default(false),
			once: z.boolean().default(false),
		}),
		scope: ['write:hooks'],
		risk: 'low',
		readOnly: false,
		keywords: ['hook', 'register', 'event'],
		handler: async (args, env) => {
			const id = crypto.randomUUID()
			await env.FERMI_DB.prepare(
				'INSERT INTO hooks (id, event, matcher, scope, command, trust_level, is_async, once, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
			)
				.bind(
					id,
					args.event,
					args.matcher ?? null,
					args.scope,
					args.command ?? null,
					args.trust_level,
					args.is_async ? 1 : 0,
					args.once ? 1 : 0,
					Date.now(),
				)
				.run()
			return { id, event: args.event, status: 'registered' }
		},
	})

	defineCapability({
		name: 'hooks_list',
		domain: 'hooks',
		description: 'List registered hooks, optionally filtered by event.',
		inputSchema: z.object({ event: z.string().optional() }),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['hook', 'list'],
		handler: async (args, env) => {
			const stmt = args.event
				? env.FERMI_DB.prepare('SELECT * FROM hooks WHERE event = ? AND enabled = 1').bind(
						args.event,
					)
				: env.FERMI_DB.prepare('SELECT * FROM hooks WHERE enabled = 1')
			const { results } = await stmt.all()
			return { hooks: results, total: results.length }
		},
	})
}
