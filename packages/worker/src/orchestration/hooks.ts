import { z } from 'zod'
import { defineTool } from '../lib/tool.ts'
import type { FermiMCP } from '../mcp/index.ts'

export interface HookContext {
	tool?: string
	args?: Record<string, unknown>
}

export interface HookResult {
	decision: 'allow' | 'ask' | 'deny'
	messages: string[]
}

function matchGlob(pattern: string, value: string): boolean {
	const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
	return regex.test(value)
}

export async function executeHooks(
	event: string,
	context: HookContext,
	env: Env,
): Promise<HookResult> {
	const hooks = await env.FERMI_DB.prepare('SELECT * FROM hooks WHERE event = ? AND enabled = 1')
		.bind(event)
		.all()

	let decision: 'allow' | 'ask' | 'deny' = 'allow'
	const messages: string[] = []

	for (const hook of hooks.results) {
		if (hook.matcher && context.tool && !matchGlob(hook.matcher as string, context.tool)) continue

		messages.push(`Hook ${hook.id} fired for ${event}:${context.tool ?? 'n/a'}`)

		// deny > ask > allow precedence
		const level = hook.trust_level as string
		if (level === 'deny') decision = 'deny'
		else if (level === 'ask' && decision !== 'deny') decision = 'ask'

		// Handle once-only hooks
		if (hook.once) {
			await env.FERMI_DB.prepare('UPDATE hooks SET enabled = 0 WHERE id = ?').bind(hook.id).run()
		}
	}

	return { decision, messages }
}

export function registerHookTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'hooks_register',
		description: 'Register a hook that fires on a specific event.',
		schema: {
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
			matcher: z.string().optional().describe('Glob pattern to match tool names (e.g. "memory_*")'),
			command: z.string().optional().describe('Command or note associated with the hook'),
			scope: z.enum(['user', 'project', 'session']).default('session'),
			trust_level: z.enum(['allow', 'ask', 'deny']).default('allow'),
			is_async: z.boolean().default(false),
			once: z.boolean().default(false),
		},
		scope: ['write:hooks'],
		risk: 'low',
		mutates: true,
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
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ id, event: args.event, status: 'registered' }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'hooks_list',
		description: 'List registered hooks, optionally filtered by event.',
		schema: {
			event: z.string().optional().describe('Filter by event name'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const query = args.event
				? env.FERMI_DB.prepare('SELECT * FROM hooks WHERE event = ? AND enabled = 1').bind(
						args.event,
					)
				: env.FERMI_DB.prepare('SELECT * FROM hooks WHERE enabled = 1')
			const results = await query.all()
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							hooks: results.results,
							total: results.results.length,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'hooks_test',
		description: 'Dry-run: show which hooks would fire for a given event and tool name.',
		schema: {
			event: z.string(),
			tool_name: z.string().optional(),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const result = await executeHooks(args.event, { tool: args.tool_name }, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							event: args.event,
							tool: args.tool_name,
							decision: result.decision,
							hooks_fired: result.messages,
						}),
					},
				],
			}
		},
	})
}
