import { fleetRelease } from '../do/fleet-do.ts'
import {
	getAwsCreds,
	isInstanceTerminated,
	listFleetInstances,
	terminateInstances,
} from '../lib/aws-ec2.ts'
import { type FleetConfig, accruedCostUsd, getFleetConfig } from '../lib/fleet-config.ts'
import type { BoxRow, CloudAgentRow } from '../lib/fleet-store.ts'
import {
	listActiveBoxes,
	listReaperAgents,
	scrubBoxToken,
	updateBox,
	updateCloudAgent,
} from '../lib/fleet-store.ts'
import { failOpenTask } from '../lib/task-store.ts'

const LIVE_AGENT = new Set(['launching', 'running', 'waiting_human'])

export interface ReapPlan {
	expire_agents: { id: string; reason: string }[]
	terminate_boxes: string[]
	accrue: { id: string; cost_usd: number }[]
}

function boxInstanceType(box: BoxRow): string {
	try {
		return (JSON.parse(box.meta).instance_type as string) ?? 't3.small'
	} catch {
		return 't3.small'
	}
}

/**
 * Pure reaping decisions so the shutdown policy is unit-testable:
 * - live agents past TTL expire (their box is terminated);
 * - boxes that never heartbeated within the provisioning grace are terminated;
 * - boxes with stale heartbeats terminate; a live agent on one is failed as
 *   `runner_stalled` right away instead of sitting `running` until TTL (#42);
 * - running agents accrue estimated cost each tick (absolute, idempotent).
 */
export function planFleetReap(
	agents: CloudAgentRow[],
	boxes: BoxRow[],
	now: number,
	config: FleetConfig,
): ReapPlan {
	const plan: ReapPlan = { expire_agents: [], terminate_boxes: [], accrue: [] }
	const boxById = new Map(boxes.map((b) => [b.box_id, b]))
	const liveAgentsByBox = new Map<string, number>()
	const heartbeatStale = (box: BoxRow | undefined) =>
		box?.last_heartbeat_at != null && now - box.last_heartbeat_at > config.heartbeat_stale_ms

	for (const agent of agents) {
		const live = LIVE_AGENT.has(agent.status)
		const ttlSeconds = Math.min(
			agent.ttl_seconds ?? config.default_ttl_seconds,
			config.max_ttl_seconds,
		)
		const expired = live && now > agent.created_at + ttlSeconds * 1000
		const overBudget = live && agent.budget_usd != null && agent.cost_usd >= agent.budget_usd
		const stalled = live && !!agent.box_id && heartbeatStale(boxById.get(agent.box_id))
		if (expired || overBudget || stalled) {
			plan.expire_agents.push({
				id: agent.id,
				reason: expired ? 'ttl_exceeded' : overBudget ? 'budget_exceeded' : 'runner_stalled',
			})
			if (agent.box_id) plan.terminate_boxes.push(agent.box_id)
			continue
		}
		if (live && agent.box_id) {
			liveAgentsByBox.set(agent.box_id, (liveAgentsByBox.get(agent.box_id) ?? 0) + 1)
			const box = boxById.get(agent.box_id)
			if (box && box.provider === 'aws' && box.instance_ref) {
				plan.accrue.push({
					id: agent.id,
					cost_usd: accruedCostUsd(
						agent.started_at ?? agent.created_at,
						now,
						agent.instance_type ?? boxInstanceType(box),
					),
				})
			}
		}
		if (!live && agent.box_id) {
			const box = boxById.get(agent.box_id)
			if (box && box.status !== 'destroyed') plan.terminate_boxes.push(agent.box_id)
		}
	}

	for (const box of boxes) {
		if (box.status === 'destroyed' || plan.terminate_boxes.includes(box.box_id)) continue
		if (box.last_heartbeat_at == null) {
			if (now > box.created_at + config.provision_grace_ms) {
				plan.terminate_boxes.push(box.box_id)
			}
			continue
		}
		// Live agents on a stale box were already expired above (runner_stalled),
		// so by here a stale box has nothing left to protect.
		if (heartbeatStale(box) && (liveAgentsByBox.get(box.box_id) ?? 0) === 0) {
			plan.terminate_boxes.push(box.box_id)
		}
	}

	plan.terminate_boxes = [...new Set(plan.terminate_boxes)]
	return plan
}

export async function handleFleetReaper(env: Env): Promise<void> {
	const now = Date.now()
	const config = await getFleetConfig(env)
	const agents = await listReaperAgents(env.FERMI_DB)
	const boxes = await listActiveBoxes(env.FERMI_DB)
	if (agents.length === 0 && boxes.length === 0) return

	const plan = planFleetReap(agents, boxes, now, config)

	for (const { id, cost_usd } of plan.accrue) {
		await updateCloudAgent(env.FERMI_DB, id, { costUsd: cost_usd })
	}
	const agentById = new Map(agents.map((a) => [a.id, a]))
	for (const { id, reason } of plan.expire_agents) {
		await updateCloudAgent(env.FERMI_DB, id, { status: 'failed', endedAt: now, exitReason: reason })
		// Fail the work task too, so an orchestrator blocked in task_wait returns
		// now rather than timing out on a task nobody will complete (#42).
		const taskId = agentById.get(id)?.task_id
		if (taskId) await failOpenTask(env.FERMI_DB, taskId, reason)
		await fleetRelease(env, id)
	}

	const boxById = new Map(boxes.map((b) => [b.box_id, b]))
	const instanceRefs = plan.terminate_boxes
		.map((id) => boxById.get(id))
		.filter((b): b is BoxRow => !!b && b.provider === 'aws' && !!b.instance_ref)
		.map((b) => b.instance_ref as string)

	const creds = await getAwsCreds(env)
	if (creds) {
		if (instanceRefs.length > 0) {
			await terminateInstances(creds, config.region, instanceRefs)
		}
		// Orphan sweep: any fleet-tagged instance AWS knows about that no live
		// box row claims gets terminated. Nothing tagged fermi-fleet may outlive
		// its registry row.
		const live = await listFleetInstances(creds, config.region)
		if (live.ok) {
			const knownRefs = new Set(
				boxes
					.filter((b) => !plan.terminate_boxes.includes(b.box_id))
					.map((b) => b.instance_ref)
					.filter(Boolean),
			)
			const orphans = live.instanceIds.filter((id) => !knownRefs.has(id))
			if (orphans.length > 0) await terminateInstances(creds, config.region, orphans)
		}
	}

	// Only mark a box destroyed once its instance is confirmed gone — otherwise
	// we'd revoke the token while EC2 keeps billing, and destroyed rows drop out
	// of the next tick so terminate would never retry (#37). Unconfirmed boxes
	// stay live for the next reaper pass.
	for (const boxId of plan.terminate_boxes) {
		const box = boxById.get(boxId)
		let confirmed = true
		if (creds && box?.provider === 'aws' && box.instance_ref) {
			const chk = await isInstanceTerminated(creds, config.region, box.instance_ref)
			confirmed = chk.confirmed
		}
		if (confirmed) {
			await updateBox(env.FERMI_DB, boxId, { status: 'destroyed', destroyedAt: now })
			await scrubBoxToken(env.FERMI_DB, boxId)
		} else {
			await updateBox(env.FERMI_DB, boxId, { status: 'offline' })
		}
	}
}
