import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	createCloudAgent,
	getBox,
	getCloudAgent,
	heartbeatBox,
	listCloudAgents,
	registerBox,
	updateBox,
	updateCloudAgent,
} from '../src/lib/fleet-store.ts'
import { claimTasks, completeTask, enqueueTask, waitForTask } from '../src/lib/task-store.ts'
import { runWithGuardrails } from '../src/lib/tool.ts'
import { cloudAgentLaunchSchema } from '../src/mcp/tools/cloud-agents.ts'
import {
	clearAudit,
	clearFleet,
	clearTasks,
	setupAuditSchema,
	setupFleetSchema,
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
})
