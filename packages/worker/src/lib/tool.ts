import { z } from 'zod'
import type { FermiMCP } from '../mcp/index.ts'
import { executeHooks } from '../orchestration/hooks.ts'
import { hashArgs, measureResultBytes, writeAudit } from './audit.ts'

export type ToolScope =
	| 'read'
	| `write:${string}`
	| 'network'
	| 'shell'
	| 'browser:cloud'
	| 'browser:local'

export type RiskLevel = 'low' | 'med' | 'high'

export interface ToolDef<T extends Record<string, z.ZodType>> {
	name: string
	description: string
	schema: T
	scope: ToolScope[]
	risk: RiskLevel
	mutates: boolean
	handler: (
		args: z.infer<z.ZodObject<T>>,
		env: Env,
	) => Promise<{
		content: Array<{ type: 'text'; text: string }>
	}>
}

const PLAN_MODE_EXEMPT = new Set(['plan_draft', 'plan_approve', 'session_set_mode'])

export interface GuardrailDef {
	name: string
	scope: ToolScope[]
	risk: RiskLevel
	mutates: boolean
}

export interface AgentLikeState {
	mode?: 'chat' | 'plan' | 'execute'
	sessionId?: string
}

export type ApprovalPolicy = 'pending_token' | 'require_token' | 'none'

export type GuardrailResult<R> =
	| { kind: 'ok'; value: R }
	| { kind: 'pending_approval'; token: string }
	| {
			kind: 'denied'
			reason:
				| 'plan_mode_restricted'
				| 'requires_approval'
				| 'invalid_or_expired_token'
				| 'blocked_by_hook'
			details?: Record<string, unknown>
	  }

export interface RunWithGuardrailsOpts<R> {
	def: GuardrailDef
	args: Record<string, unknown>
	env: Env
	agentState?: AgentLikeState
	approvalToken?: string
	planModeExempt?: boolean
	approvalPolicy: ApprovalPolicy
	handler: (args: Record<string, unknown>) => Promise<R>
}

export async function runWithGuardrails<R>(
	opts: RunWithGuardrailsOpts<R>,
): Promise<GuardrailResult<R>> {
	const { def, args, env, agentState, approvalToken, planModeExempt, approvalPolicy, handler } =
		opts
	const argsHash = await hashArgs(args)

	if (agentState?.mode === 'plan' && def.mutates && !planModeExempt) {
		return {
			kind: 'denied',
			reason: 'plan_mode_restricted',
			details: { tool: def.name },
		}
	}

	if (def.risk === 'high' && approvalPolicy !== 'none') {
		if (!approvalToken) {
			if (approvalPolicy === 'require_token') {
				return {
					kind: 'denied',
					reason: 'requires_approval',
					details: { tool: def.name, scope: def.scope, risk: def.risk },
				}
			}
			const token = crypto.randomUUID()
			await env.FERMI_KV.put(
				`approval:${token}`,
				JSON.stringify({ tool: def.name, args_hash: argsHash }),
				{ expirationTtl: 300 },
			)
			await writeAudit(env.FERMI_DB, {
				tool: def.name,
				args_hash: argsHash,
				outcome: 'pending',
				risk: def.risk,
			})
			return { kind: 'pending_approval', token }
		}

		const stored = await env.FERMI_KV.get(`approval:${approvalToken}`)
		if (!stored) {
			await writeAudit(env.FERMI_DB, {
				tool: def.name,
				args_hash: argsHash,
				outcome: 'denied',
				risk: def.risk,
			})
			return { kind: 'denied', reason: 'invalid_or_expired_token' }
		}
		await env.FERMI_KV.delete(`approval:${approvalToken}`)
	}

	const hookCtx = { tool: def.name, args }
	const preHook = await executeHooks('tool:before', hookCtx, env)
	if (preHook.decision === 'deny') {
		await writeAudit(env.FERMI_DB, {
			tool: def.name,
			args_hash: argsHash,
			outcome: 'denied',
			risk: def.risk,
		})
		return {
			kind: 'denied',
			reason: 'blocked_by_hook',
			details: { hooks: preHook.messages },
		}
	}

	const startedAt = Date.now()
	try {
		const value = await handler(args)
		executeHooks('tool:after', hookCtx, env).catch(() => {})
		await writeAudit(env.FERMI_DB, {
			tool: def.name,
			args_hash: argsHash,
			outcome: 'ok',
			risk: def.risk,
			approved_by: def.risk === 'high' && approvalPolicy !== 'none' ? 'token' : undefined,
			duration_ms: Date.now() - startedAt,
			result_bytes: measureResultBytes(value),
			session_id: agentState?.sessionId,
		})
		return { kind: 'ok', value }
	} catch (err) {
		await writeAudit(env.FERMI_DB, {
			tool: def.name,
			args_hash: argsHash,
			outcome: 'denied',
			risk: def.risk,
			duration_ms: Date.now() - startedAt,
			session_id: agentState?.sessionId,
		})
		throw err
	}
}

export function defineTool<T extends Record<string, z.ZodType>>(agent: FermiMCP, def: ToolDef<T>) {
	const schema =
		def.risk === 'high'
			? {
					...def.schema,
					approval_token: z
						.string()
						.optional()
						.describe('Approval token for high-risk tool execution'),
				}
			: def.schema

	const wrappedHandler = async (args: Record<string, unknown>) => {
		const env = agent.bindings
		const { approval_token, ...handlerArgs } = args

		const result = await runWithGuardrails({
			def: { name: def.name, scope: def.scope, risk: def.risk, mutates: def.mutates },
			args: handlerArgs,
			env,
			agentState: agent.state,
			approvalToken: approval_token as string | undefined,
			planModeExempt: PLAN_MODE_EXEMPT.has(def.name),
			approvalPolicy: def.risk === 'high' ? 'pending_token' : 'none',
			handler: (a) => def.handler(a as z.infer<z.ZodObject<T>>, env),
		})

		if (result.kind === 'ok') return result.value

		if (result.kind === 'pending_approval') {
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							status: 'pending_approval',
							token: result.token,
							prompt: `Tool "${def.name}" requires approval. Re-invoke with approval_token to proceed.`,
							scope: def.scope,
							risk: def.risk,
						}),
					},
				],
			}
		}

		// kind === 'denied'
		switch (result.reason) {
			case 'plan_mode_restricted':
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'plan_mode_restricted',
								message: `Tool "${def.name}" is not available in plan mode. Only read-only tools and plan management tools can be used. Switch to chat or execute mode first.`,
							}),
						},
					],
				}
			case 'invalid_or_expired_token':
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								status: 'denied',
								reason: 'Invalid or expired approval token',
							}),
						},
					],
				}
			case 'blocked_by_hook':
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								status: 'denied',
								reason: 'Blocked by hook',
								hooks: (result.details?.hooks as string[]) ?? [],
							}),
						},
					],
				}
			default:
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ status: 'denied', reason: result.reason }),
						},
					],
				}
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: generic MCP callback bridge
	agent.server.tool(def.name, def.description, schema, wrappedHandler as any)
}
