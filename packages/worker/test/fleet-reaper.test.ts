import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { planFleetReap } from '../src/cron/fleet-reaper.ts'
import {
	accruedCostUsd,
	getFleetConfig,
	monthSpendUsd,
	monthStart,
} from '../src/lib/fleet-config.ts'
import type { BoxRow, CloudAgentRow } from '../src/lib/fleet-store.ts'
import { createCloudAgent, updateCloudAgent } from '../src/lib/fleet-store.ts'
import { dispatchProvision } from '../src/lib/provisioner.ts'
import { clearFleet, setupFleetSchema } from './setup-d1.ts'

const NOW = 1_800_000_000_000

function agent(partial: Partial<CloudAgentRow>): CloudAgentRow {
	return {
		id: 'ca_x',
		box_id: null,
		task_id: null,
		queue: 'agent:ca_x',
		status: 'running',
		route: 'claude',
		prompt: 'p',
		proof_contract: 'proof',
		budget_usd: null,
		ttl_seconds: null,
		cost_usd: 0,
		exit_reason: null,
		artifacts_prefix: null,
		created_at: NOW,
		started_at: null,
		ended_at: null,
		...partial,
	}
}

function box(partial: Partial<BoxRow>): BoxRow {
	return {
		box_id: 'box-1',
		provider: 'aws',
		status: 'online',
		instance_ref: 'i-abc',
		mcp_url: null,
		oauth_client_id: null,
		region: 'us-east-1',
		snapshot_ref: 'ami-1',
		last_heartbeat_at: NOW,
		created_at: NOW,
		destroyed_at: null,
		meta: '{"instance_type":"t3.small"}',
		...partial,
	}
}

describe('fleet reaper planner', () => {
	let config: Awaited<ReturnType<typeof getFleetConfig>>
	beforeAll(async () => {
		config = await getFleetConfig(env)
	})

	it('expires a live agent past its TTL and terminates its box', () => {
		const a = agent({
			id: 'ca_ttl',
			box_id: 'box-1',
			ttl_seconds: 600,
			created_at: NOW - 601_000,
		})
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.expire_agents).toEqual([{ id: 'ca_ttl', reason: 'ttl_exceeded' }])
		expect(plan.terminate_boxes).toContain('box-1')
	})

	it('leaves a live agent within TTL alone and accrues its cost', () => {
		const a = agent({
			id: 'ca_ok',
			box_id: 'box-1',
			ttl_seconds: 3600,
			started_at: NOW - 3_600_000,
		})
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.expire_agents).toHaveLength(0)
		expect(plan.terminate_boxes).toHaveLength(0)
		expect(plan.accrue).toEqual([
			{ id: 'ca_ok', cost_usd: accruedCostUsd(NOW - 3_600_000, NOW, 't3.small') },
		])
		expect(plan.accrue[0].cost_usd).toBeCloseTo(0.0208, 4)
	})

	it('terminates the box of a finished agent', () => {
		const a = agent({ id: 'ca_done', box_id: 'box-1', status: 'done' })
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.terminate_boxes).toEqual(['box-1'])
		expect(plan.expire_agents).toHaveLength(0)
	})

	it('terminates a box that never heartbeated past the provisioning grace', () => {
		const b = box({ box_id: 'box-dead', last_heartbeat_at: null, created_at: NOW - 16 * 60_000 })
		const plan = planFleetReap([], [b], NOW, config)
		expect(plan.terminate_boxes).toEqual(['box-dead'])
	})

	it('keeps a never-heartbeated box within the grace window', () => {
		const b = box({ box_id: 'box-new', last_heartbeat_at: null, created_at: NOW - 60_000 })
		const plan = planFleetReap([], [b], NOW, config)
		expect(plan.terminate_boxes).toHaveLength(0)
	})

	it('marks a stale-heartbeat box with a live agent offline, and terminates it without one', () => {
		const stale = NOW - 11 * 60_000
		const busy = box({ box_id: 'box-busy', last_heartbeat_at: stale })
		const idle = box({ box_id: 'box-idle', last_heartbeat_at: stale })
		const a = agent({ id: 'ca_busy', box_id: 'box-busy' })
		const plan = planFleetReap([a], [busy, idle], NOW, config)
		expect(plan.offline_boxes).toEqual(['box-busy'])
		expect(plan.terminate_boxes).toEqual(['box-idle'])
	})

	it('expires a live agent at/over its budget_usd and terminates its box', () => {
		const a = agent({ id: 'ca_bud', box_id: 'box-1', budget_usd: 1, cost_usd: 1 })
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.expire_agents).toEqual([{ id: 'ca_bud', reason: 'budget_exceeded' }])
		expect(plan.terminate_boxes).toContain('box-1')
	})

	it('leaves a live agent under budget alone', () => {
		const a = agent({ id: 'ca_ok', box_id: 'box-1', budget_usd: 5, cost_usd: 1, ttl_seconds: 3600 })
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.expire_agents).toHaveLength(0)
	})

	it('never budget-expires an agent with null budget_usd', () => {
		const a = agent({
			id: 'ca_nob',
			box_id: 'box-1',
			budget_usd: null,
			cost_usd: 999,
			ttl_seconds: 3600,
		})
		const plan = planFleetReap([a], [box({})], NOW, config)
		expect(plan.expire_agents).toHaveLength(0)
	})

	it('head-of-line: one expired agent does not disturb its siblings', () => {
		const expired = agent({
			id: 'ca_a',
			box_id: 'box-a',
			ttl_seconds: 600,
			created_at: NOW - 700_000,
		})
		const healthy = agent({ id: 'ca_b', box_id: 'box-b', ttl_seconds: 3600 })
		const plan = planFleetReap(
			[expired, healthy],
			[box({ box_id: 'box-a' }), box({ box_id: 'box-b' })],
			NOW,
			config,
		)
		expect(plan.expire_agents.map((e) => e.id)).toEqual(['ca_a'])
		expect(plan.terminate_boxes).toEqual(['box-a'])
	})
})

describe('budget enforcement', () => {
	beforeAll(async () => {
		await setupFleetSchema()
	})

	beforeEach(async () => {
		await clearFleet()
	})

	it('sums only this month of spend', async () => {
		const now = Date.now()
		await createCloudAgent(env.FERMI_DB, {
			id: 'ca_this_month',
			queue: 'q1',
			prompt: 'p',
			proofContract: 'proof here',
		})
		await updateCloudAgent(env.FERMI_DB, 'ca_this_month', { costUsd: 12.5 })
		await createCloudAgent(env.FERMI_DB, {
			id: 'ca_last_month',
			queue: 'q2',
			prompt: 'p',
			proofContract: 'proof here',
		})
		await env.FERMI_DB.prepare(
			'UPDATE cloud_agents SET created_at = ?1, cost_usd = 40 WHERE id = ?2',
		)
			.bind(monthStart(now) - 1000, 'ca_last_month')
			.run()
		expect(await monthSpendUsd(env.FERMI_DB, now)).toBeCloseTo(12.5)
	})

	it('dispatchProvision refuses when month spend meets the ceiling', async () => {
		await createCloudAgent(env.FERMI_DB, {
			id: 'ca_pricey',
			queue: 'q1',
			prompt: 'p',
			proofContract: 'proof here',
		})
		await updateCloudAgent(env.FERMI_DB, 'ca_pricey', { costUsd: 50 })
		const outcome = await dispatchProvision(
			env,
			agent({ id: 'ca_new', queue: 'agent:ca_new', created_at: Date.now() }),
		)
		expect(outcome).toMatchObject({ dispatched: false, reason: 'budget_exceeded' })
	})

	it('dispatchProvision refuses when no environment snapshot is configured', async () => {
		// Valid runner pin so the earlier supply-chain gate (#34) doesn't trip first.
		await env.FERMI_KV.put(
			'fleet:config',
			JSON.stringify({ runner_ref: 'a'.repeat(40), runner_sha256: 'b'.repeat(64) }),
		)
		const outcome = await dispatchProvision(
			env,
			agent({ id: 'ca_noenv', queue: 'agent:ca_noenv', created_at: Date.now() }),
		)
		expect(outcome).toMatchObject({ dispatched: false, reason: 'no_environment_configured' })
	})

	it('dispatchProvision does not provision when an existing box is targeted', async () => {
		const outcome = await dispatchProvision(env, agent({ id: 'ca_pw', box_id: 'box-mac' }))
		expect(outcome).toMatchObject({ dispatched: false, reason: 'existing_box_targeted' })
	})
})
