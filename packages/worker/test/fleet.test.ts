import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	getFleetConfig,
	resolveInstanceType,
	updateFleetConfig,
	validateFleetConfigPatch,
} from '../src/lib/fleet-config.ts'
import { launchCloudAgent } from '../src/lib/fleet-launch.ts'
import {
	createCloudAgent,
	getBox,
	getCloudAgent,
	heartbeatBox,
	listCloudAgents,
	registerBox,
	routeHealth,
	updateBox,
	updateCloudAgent,
} from '../src/lib/fleet-store.ts'
import type { CloudAgentRow, CloudAgentView } from '../src/lib/fleet-store.ts'
import {
	claimTasks,
	completeTask,
	enqueueTask,
	failOpenTask,
	waitForTask,
} from '../src/lib/task-store.ts'
import { runWithGuardrails } from '../src/lib/tool.ts'
import { agentStall, cloudAgentLaunchSchema } from '../src/mcp/tools/cloud-agents.ts'
import {
	clearAudit,
	clearFleet,
	clearSecrets,
	clearTasks,
	setupAuditSchema,
	setupFleetSchema,
	setupSecretsSchema,
	setupSkillsSchema,
	setupTasksSchema,
} from './setup-d1.ts'

describe('fleet-store', () => {
	beforeAll(async () => {
		await setupFleetSchema()
	})

	beforeEach(async () => {
		await clearFleet()
	})

	it('registers a box, heartbeats it online, and refuses heartbeats after destroy', async () => {
		const box = await registerBox(env.FERMI_DB, {
			boxId: 'box-alpha',
			provider: 'aws',
			region: 'us-east-1',
			snapshotRef: 'ami-test',
		})
		expect(box).toMatchObject({ box_id: 'box-alpha', status: 'provisioning' })

		expect((await heartbeatBox(env.FERMI_DB, 'box-alpha')).ok).toBe(true)
		const online = await getBox(env.FERMI_DB, 'box-alpha')
		expect(online?.status).toBe('online')
		expect(online?.last_heartbeat_at).toBeTypeOf('number')

		await updateBox(env.FERMI_DB, 'box-alpha', { status: 'destroyed', destroyedAt: Date.now() })
		expect((await heartbeatBox(env.FERMI_DB, 'box-alpha')).ok).toBe(false)
		expect((await getBox(env.FERMI_DB, 'box-alpha'))?.status).toBe('destroyed')
		expect((await heartbeatBox(env.FERMI_DB, 'missing')).ok).toBe(false)
	})

	it('creates and transitions a cloud agent record', async () => {
		const created = await createCloudAgent(env.FERMI_DB, {
			id: 'ca_test',
			queue: 'agent:ca_test',
			prompt: 'build the thing',
			proofContract: 'screenshot of the thing working',
			route: 'grok',
			budgetUsd: 5,
			ttlSeconds: 1200,
		})
		expect(created).toMatchObject({
			id: 'ca_test',
			status: 'launching',
			route: 'grok',
			proof_contract: 'screenshot of the thing working',
		})

		await updateCloudAgent(env.FERMI_DB, 'ca_test', { status: 'running', startedAt: Date.now() })
		await updateCloudAgent(env.FERMI_DB, 'ca_test', {
			status: 'done',
			endedAt: Date.now(),
			costUsd: 1.25,
			exitReason: 'proof_verified',
		})
		const row = await getCloudAgent(env.FERMI_DB, 'ca_test')
		expect(row).toMatchObject({ status: 'done', cost_usd: 1.25, exit_reason: 'proof_verified' })

		expect(await listCloudAgents(env.FERMI_DB, { status: 'done' })).toHaveLength(1)
		expect(await listCloudAgents(env.FERMI_DB, { status: 'running' })).toHaveLength(0)
	})
})

describe('cloud_agent_launch schema (proof contract required)', () => {
	const schema = z.object(cloudAgentLaunchSchema)

	it('rejects a launch without a proof contract', () => {
		const parsed = schema.safeParse({ prompt: 'build feature X end to end' })
		expect(parsed.success).toBe(false)
	})

	it('rejects a trivially short proof contract', () => {
		const parsed = schema.safeParse({
			prompt: 'build feature X end to end',
			proof_contract: 'trust me',
		})
		expect(parsed.success).toBe(false)
	})

	it('accepts a launch with a real proof contract and defaults the route', () => {
		const parsed = schema.parse({
			prompt: 'build feature X end to end',
			proof_contract: 'before/after screenshots plus passing test output',
		})
		expect(parsed.route).toBe('claude')
		expect(parsed.instance_type).toBeUndefined()
	})

	it('accepts an alternate Claude account and rejects malformed ids', () => {
		const base = {
			prompt: 'build feature X end to end',
			proof_contract: '{"kind":"artifact","name":"a"}',
		}
		expect(schema.parse({ ...base, account: 'kayo' }).account).toBe('kayo')
		expect(schema.safeParse({ ...base, account: 'KAYO' }).success).toBe(false)
		expect(schema.safeParse({ ...base, account: '../x' }).success).toBe(false)
	})

	it('accepts a per-launch instance_type (#43)', () => {
		const parsed = schema.parse({
			prompt: 'cdk synth + jest on the platform repo',
			proof_contract: '{"kind":"artifact","name":"out.diff","min_bytes":1}',
			instance_type: 't3.medium',
		})
		expect(parsed.instance_type).toBe('t3.medium')
	})
})

describe('fleet:config sizing and operator edits (#43)', () => {
	beforeEach(async () => {
		await env.FERMI_KV.delete('fleet:config')
	})

	it('resolves the fleet default when no instance_type is requested, allowlists explicit ones', async () => {
		const config = await getFleetConfig(env)
		expect(resolveInstanceType(config, undefined)).toEqual({ ok: true, instance_type: 't3.small' })
		expect(resolveInstanceType(config, 't3.medium')).toEqual({
			ok: true,
			instance_type: 't3.medium',
		})
		expect(resolveInstanceType(config, 'p4d.24xlarge')).toMatchObject({
			ok: false,
			error: 'instance_type_not_allowed',
		})
	})

	it('validates operator patches: editable fields only, typed, pin untouchable', async () => {
		const config = await getFleetConfig(env)
		expect(validateFleetConfigPatch(config, { runner_ref: 'abc' })).toMatchObject({ ok: false })
		expect(validateFleetConfigPatch(config, { max_concurrent: 0 })).toMatchObject({ ok: false })
		expect(validateFleetConfigPatch(config, { instance_type: 'c7g.xl' })).toMatchObject({
			ok: false,
		})
		expect(validateFleetConfigPatch(config, {})).toMatchObject({ ok: false })
		const ok = validateFleetConfigPatch(config, { instance_type: 't3.medium', max_concurrent: 8 })
		expect(ok).toMatchObject({
			ok: true,
			config: { instance_type: 't3.medium', max_concurrent: 8 },
		})
	})

	it('updateFleetConfig merges into KV without disturbing the runner pin', async () => {
		await env.FERMI_KV.put(
			'fleet:config',
			JSON.stringify({ runner_ref: 'a'.repeat(40), runner_sha256: 'b'.repeat(64) }),
		)
		const res = await updateFleetConfig(env, { instance_type: 't3.medium', monthly_budget_usd: 75 })
		expect(res.ok).toBe(true)
		const stored = JSON.parse((await env.FERMI_KV.get('fleet:config')) ?? '{}')
		expect(stored).toMatchObject({
			instance_type: 't3.medium',
			monthly_budget_usd: 75,
			runner_ref: 'a'.repeat(40),
		})
		expect((await getFleetConfig(env)).instance_type).toBe('t3.medium')
	})
})

describe('agent stall detection for cloud_agent_followup (#42)', () => {
	const NOW = 1_800_000_000_000
	const view = (p: Partial<CloudAgentView>): CloudAgentView =>
		({
			id: 'ca_v',
			box_id: 'box-v',
			task_id: 't',
			queue: 'agent:ca_v',
			status: 'running',
			route: 'claude',
			prompt: 'p',
			proof_contract: 'c',
			budget_usd: null,
			ttl_seconds: null,
			cost_usd: 0,
			inference_usd: 0,
			exit_reason: null,
			artifacts_prefix: null,
			created_at: NOW,
			started_at: NOW,
			ended_at: null,
			instance_type: null,
			last_working_event_at: null,
			restart_count: 0,
			last_heartbeat_at: NOW,
			...p,
		}) as CloudAgentView

	it('flags control-plane stall exits and stale heartbeats, not healthy or plainly finished agents', () => {
		const stale = 10 * 60_000
		expect(agentStall(view({}), NOW, stale)).toEqual({ stalled: false })
		expect(agentStall(view({ status: 'done', exit_reason: 'completed' }), NOW, stale)).toEqual({
			stalled: false,
		})
		expect(
			agentStall(view({ status: 'failed', exit_reason: 'runner_restarted' }), NOW, stale),
		).toEqual({ stalled: true, reason: 'runner_restarted' })
		expect(agentStall(view({ last_heartbeat_at: NOW - stale - 1 }), NOW, stale)).toEqual({
			stalled: true,
			reason: 'heartbeat_stale',
		})
	})
})

describe('high-risk approval flow (guardrails)', () => {
	beforeAll(async () => {
		await setupAuditSchema()
		await setupSkillsSchema() // hooks table, read by tool:before
	})

	beforeEach(async () => {
		await clearAudit()
	})

	const highRiskDef = {
		name: 'cloud_agent_launch',
		scope: ['write:fleet'],
		risk: 'high' as const,
		mutates: true,
	}

	it('denies without a token, proceeds exactly once with it, then rejects reuse', async () => {
		let calls = 0
		const run = (approvalToken?: string) =>
			runWithGuardrails({
				def: highRiskDef,
				args: { prompt: 'x', proof_contract: 'y' },
				env,
				approvalToken,
				approvalPolicy: 'pending_token',
				handler: async () => {
					calls++
					return 'launched'
				},
			})

		const first = await run()
		expect(first.kind).toBe('pending_approval')
		expect(calls).toBe(0)
		const token = first.kind === 'pending_approval' ? first.token : ''
		expect(token).toBeTruthy()

		const second = await run(token)
		expect(second.kind).toBe('ok')
		expect(calls).toBe(1)

		const third = await run(token)
		expect(third.kind).toBe('denied')
		expect(third.kind === 'denied' && third.reason).toBe('invalid_or_expired_token')
		expect(calls).toBe(1)
	})

	it('rejects a made-up token outright', async () => {
		const result = await runWithGuardrails({
			def: highRiskDef,
			args: {},
			env,
			approvalToken: 'not-a-real-token',
			approvalPolicy: 'pending_token',
			handler: async () => 'nope',
		})
		expect(result.kind).toBe('denied')
	})
})

describe('task_wait semantics', () => {
	beforeAll(async () => {
		await setupTasksSchema()
	})

	beforeEach(async () => {
		await clearTasks()
	})

	it('resolves when the task completes while waiting', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'cloud',
			payload: 'work',
			queue: 'agent:ca_wait',
		})
		const finishLater = (async () => {
			await new Promise((r) => setTimeout(r, 300))
			await claimTasks(env.FERMI_DB, { queue: 'agent:ca_wait', claimedBy: 'box-w' })
			await completeTask(env.FERMI_DB, id, { result: 'proof attached', claimedBy: 'box-w' })
		})()
		const outcome = await waitForTask(env.FERMI_DB, id, { timeoutMs: 5_000, pollMs: 100 })
		await finishLater
		expect(outcome).toEqual({ status: 'done', result: 'proof attached' })
	})

	it('times out on a task that never completes', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'cloud',
			payload: 'work',
			queue: 'agent:ca_stall',
		})
		const outcome = await waitForTask(env.FERMI_DB, id, { timeoutMs: 400, pollMs: 100 })
		expect(outcome.status).toBe('timeout')
	})

	it('reports not_found for an unknown task id', async () => {
		const outcome = await waitForTask(env.FERMI_DB, 'missing', { timeoutMs: 200, pollMs: 100 })
		expect(outcome.status).toBe('not_found')
	})

	it('failOpenTask fails a claimed task so a waiter returns, and ignores finished ones', async () => {
		const { id } = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: 'orch',
			chatId: 'cloud',
			payload: 'work',
			queue: 'agent:ca_reap',
		})
		await claimTasks(env.FERMI_DB, { queue: 'agent:ca_reap', claimedBy: 'box-r' })
		expect((await failOpenTask(env.FERMI_DB, id, 'runner_stalled')).ok).toBe(true)
		expect(await waitForTask(env.FERMI_DB, id, { timeoutMs: 200, pollMs: 100 })).toEqual({
			status: 'failed',
			result: 'runner_stalled',
		})
		expect((await failOpenTask(env.FERMI_DB, id, 'again')).ok).toBe(false)
	})
})

describe('routeHealth (#47)', () => {
	const agent = (p: Partial<CloudAgentRow>): CloudAgentRow =>
		({ route: 'claude', status: 'failed', ended_at: 1, exit_reason: null, ...p }) as CloudAgentRow
	const cap = 'harness api_error 429: You have hit your org monthly spend limit'

	it('flags a route after three consecutive same-status API errors, newest first', () => {
		const agents = [
			agent({ ended_at: 30, exit_reason: cap }),
			agent({ ended_at: 20, exit_reason: cap }),
			agent({ ended_at: 10, exit_reason: cap }),
			agent({ ended_at: 5, status: 'done', exit_reason: 'completed' }),
			agent({ route: 'grok', ended_at: 40, exit_reason: 'completed', status: 'done' }),
			agent({ ended_at: null, status: 'running' }),
		]
		expect(routeHealth(agents, 'claude')).toEqual({
			route: 'claude',
			unavailable: true,
			consecutive_api_errors: 3,
			api_error_status: '429',
			last_error: cap,
			since: 10,
		})
		expect(routeHealth(agents, 'grok')).toMatchObject({
			unavailable: false,
			consecutive_api_errors: 0,
		})
	})

	it('tracks each Claude account separately', () => {
		const agents = [
			agent({ ended_at: 30, exit_reason: cap }),
			agent({ ended_at: 20, exit_reason: cap }),
			agent({ ended_at: 10, exit_reason: cap }),
			agent({ account: 'kayo', ended_at: 40, status: 'done', exit_reason: 'completed' }),
		]
		expect(routeHealth(agents, 'claude').unavailable).toBe(true)
		expect(routeHealth(agents, 'claude', 'kayo')).toMatchObject({
			unavailable: false,
			consecutive_api_errors: 0,
		})
	})

	it('resets the streak on a different status or a non-API failure, and ignores ordering of input', () => {
		const mixed = [
			agent({ ended_at: 10, exit_reason: cap }),
			agent({ ended_at: 30, exit_reason: cap }),
			agent({ ended_at: 20, exit_reason: 'harness api_error 401: bad key' }),
		]
		expect(routeHealth(mixed, 'claude')).toMatchObject({
			unavailable: false,
			consecutive_api_errors: 1,
			api_error_status: '429',
		})
		const stalled = [
			agent({ ended_at: 30, exit_reason: 'runner_stalled' }),
			agent({ ended_at: 20, exit_reason: cap }),
		]
		expect(routeHealth(stalled, 'claude')).toMatchObject({
			unavailable: false,
			consecutive_api_errors: 0,
			api_error_status: null,
		})
	})
})

describe('alternate Claude account launch checks', () => {
	const base = {
		prompt: 'build feature X end to end',
		proof_contract: '{"kind":"artifact","name":"out.txt","min_bytes":1}',
	}
	beforeAll(setupSecretsSchema)
	beforeEach(clearSecrets)

	it('rejects an account on a non-claude route', async () => {
		expect(await launchCloudAgent(env, { ...base, route: 'grok', account: 'kayo' })).toMatchObject({
			ok: false,
			error: 'account_requires_claude_route',
		})
	})

	it('rejects a malformed account from the admin path', async () => {
		expect(await launchCloudAgent(env, { ...base, account: 'Kayo!' })).toMatchObject({
			ok: false,
			error: 'invalid_account',
		})
	})

	it('fails at launch when the account token secret is missing', async () => {
		expect(await launchCloudAgent(env, { ...base, account: 'kayo' })).toEqual({
			ok: false,
			error: 'account_token_not_configured',
			missing: ['CLAUDE_CODE_OAUTH_TOKEN_KAYO'],
		})
	})
})
