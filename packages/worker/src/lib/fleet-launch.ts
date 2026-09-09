import { fleetRelease, fleetReserve } from '../do/fleet-do.ts'
import { accruedCostUsd, getFleetConfig, monthSpendUsd } from './fleet-config.ts'
import { createCloudAgent, getBox } from './fleet-store.ts'
import { parseProofContract } from './proof-contract.ts'
import { type ProvisionOutcome, dispatchProvision } from './provisioner.ts'
import { enqueueTask } from './task-store.ts'

export interface LaunchInput {
	prompt: string
	proof_contract: string
	route?: 'claude' | 'codex' | 'grok'
	model?: string
	box_id?: string
	budget_usd?: number
	ttl_seconds?: number
	skills?: string[]
	sessions?: string[]
	repo?: string
	branch?: string
	parent_task_id?: string
}

export type LaunchResult =
	| { ok: false; error: string; [k: string]: unknown }
	| {
			ok: true
			agent_id: string
			queue: string
			task_id: string
			status: string
			provision: ProvisionOutcome
	  }

/** Single launch path shared by the MCP tool and the admin endpoint. */
export async function launchCloudAgent(env: Env, input: LaunchInput): Promise<LaunchResult> {
	// #36: new launches must carry a structured, mechanically-checkable
	// contract — free text is judged by an LLM and was vacuously satisfiable.
	const proof = parseProofContract(input.proof_contract)
	if (!proof.ok) {
		return { ok: false, error: `invalid_proof_contract: ${proof.error}` }
	}

	const config = await getFleetConfig(env)
	if (input.box_id) {
		const box = await getBox(env.FERMI_DB, input.box_id)
		if (!box || box.status === 'destroyed') {
			return { ok: false, error: 'box_not_found_or_destroyed', box_id: input.box_id }
		}
	}
	const agentId = `ca_${crypto.randomUUID()}`
	const ttlSeconds = Math.min(
		input.ttl_seconds ?? config.default_ttl_seconds,
		config.max_ttl_seconds,
	)
	// Admission through the single-instance FleetDO mutex: serializes every
	// launch so N concurrent requests cannot all pass the ceiling, enforces
	// max-concurrent, and reserves rate×ttl against the budget. Targeting an
	// existing (private) box provisions no compute, so it needs no reservation.
	if (!input.box_id) {
		const estCost = accruedCostUsd(0, ttlSeconds * 1000, config.instance_type)
		const monthActual = await monthSpendUsd(env.FERMI_DB, Date.now())
		const reservation = await fleetReserve(env, {
			agent_id: agentId,
			est_cost_usd: estCost,
			ttl_seconds: ttlSeconds,
			max_concurrent: config.max_concurrent,
			monthly_budget_usd: config.monthly_budget_usd,
			month_actual_usd: monthActual,
		})
		if (!reservation.ok)
			return { ...reservation, ok: false, error: String(reservation.error ?? 'admission_denied') }
	}
	const queue = `agent:${agentId}`
	const task = await enqueueTask(env.FERMI_DB, {
		channel: 'cloud',
		sender: `cloud_agent:${agentId}`,
		chatId: 'cloud',
		payload: JSON.stringify({
			prompt: input.prompt,
			proof_contract: input.proof_contract,
			route: input.route ?? 'claude',
			model: input.model ?? null,
			skills: input.skills ?? [],
			sessions: input.sessions ?? [],
			repo: input.repo ?? null,
			branch: input.branch ?? null,
		}),
		queue,
		parentTaskId: input.parent_task_id,
	})
	const created = await createCloudAgent(env.FERMI_DB, {
		id: agentId,
		queue,
		prompt: input.prompt,
		proofContract: input.proof_contract,
		route: input.route,
		boxId: input.box_id,
		taskId: task.id,
		budgetUsd: input.budget_usd,
		ttlSeconds: input.ttl_seconds,
	})
	const provision = await dispatchProvision(env, created)
	// If no compute was dispatched (provisioner error, not a targeted box), free
	// the reservation so a failed launch never holds a concurrency/budget slot.
	if (!input.box_id && !provision.dispatched && provision.reason !== 'existing_box_targeted') {
		await fleetRelease(env, agentId)
	}
	return {
		ok: true,
		agent_id: created.id,
		queue,
		task_id: task.id,
		status: created.status,
		provision,
	}
}
