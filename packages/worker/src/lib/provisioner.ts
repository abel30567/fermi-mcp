import { sha256Hex } from '../channels/box-gateway.ts'
import { getAwsCreds, runInstance, terminateInstances } from './aws-ec2.ts'
import { getFleetConfig, monthSpendUsd } from './fleet-config.ts'
import type { CloudAgentRow } from './fleet-store.ts'
import { getBox, registerBox, updateBox, updateCloudAgent } from './fleet-store.ts'
import { type RunnerPin, runnerFetchScript } from './runner-pin.ts'

export interface ProvisionOutcome {
	dispatched: boolean
	reason?: string
	box_id?: string
	instance_ref?: string
}

export function bootstrapUserData(opts: {
	boxId: string
	agentId: string
	queue: string
	route: string
	ttlSeconds: number
	mcpBaseUrl: string | null
	boxToken: string
	claudeModel: string | null
	runnerPin: RunnerPin
}): string {
	// Belt-and-braces shutdown: the instance halts itself even if the reaper
	// and the runner both die (InstanceInitiatedShutdownBehavior=terminate).
	const shutdownMinutes = Math.ceil(opts.ttlSeconds / 60) + 5
	return [
		'#!/bin/bash',
		'set -euo pipefail',
		`shutdown -h +${shutdownMinutes}`,
		'mkdir -p /etc/fermi /opt/fermi',
		// Fetch+verify the pinned runner BEFORE the box token exists on disk:
		// a tampered download aborts here (set -e), credentials never land, the
		// box never heartbeats, and the provision-grace reaper reclaims it.
		runnerFetchScript(opts.runnerPin),
		'cat > /etc/fermi/box.env <<EOF',
		`BOX_ID=${opts.boxId}`,
		`AGENT_ID=${opts.agentId}`,
		`QUEUE=${opts.queue}`,
		`ROUTE=${opts.route}`,
		`TTL_SECONDS=${opts.ttlSeconds}`,
		`FERMI_BOX_TOKEN=${opts.boxToken}`,
		...(opts.mcpBaseUrl ? [`FERMI_URL=${opts.mcpBaseUrl}`] : []),
		...(opts.route === 'claude' && opts.claudeModel ? [`CLAUDE_MODEL=${opts.claudeModel}`] : []),
		'EOF',
		// Baked AMIs ship a fermi-runner systemd unit that reads /etc/fermi/box.env.
		'systemctl start fermi-runner 2>/dev/null || true',
	].join('\n')
}

export async function dispatchProvision(env: Env, agent: CloudAgentRow): Promise<ProvisionOutcome> {
	if (agent.box_id)
		return { dispatched: false, reason: 'existing_box_targeted', box_id: agent.box_id }

	const config = await getFleetConfig(env)
	const spend = await monthSpendUsd(env.FERMI_DB, Date.now())
	if (spend >= config.monthly_budget_usd) {
		return { dispatched: false, reason: 'budget_exceeded' }
	}

	// Supply-chain gate (#34): never boot a box without a pinned, hash-verified
	// runner. Set via POST /admin/fleet/pin-runner.
	if (!config.runner_ref || !config.runner_sha256) {
		return { dispatched: false, reason: 'runner_pin_unset' }
	}

	if (!config.default_env) return { dispatched: false, reason: 'no_environment_configured' }
	const envRaw = await env.FERMI_KV.get(`cloudenv:${config.default_env}`)
	const imageId = envRaw ? (JSON.parse(envRaw).image_ref as string | undefined) : undefined
	if (!imageId) return { dispatched: false, reason: 'environment_missing_image_ref' }

	const creds = await getAwsCreds(env)
	if (!creds) return { dispatched: false, reason: 'aws_credentials_missing' }

	const ttlSeconds = Math.min(
		agent.ttl_seconds ?? config.default_ttl_seconds,
		config.max_ttl_seconds,
	)
	const boxId = `box-${agent.id.replace(/^ca_/, '').slice(0, 8)}`
	// Per-box credential: secret only ever exists in user-data; hash at rest.
	// Destroying the box revokes it (authBox refuses destroyed boxes).
	const boxSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
	await registerBox(env.FERMI_DB, {
		boxId,
		provider: 'aws',
		region: config.region,
		snapshotRef: imageId,
		meta: {
			instance_type: config.instance_type,
			agent_id: agent.id,
			token_hash: await sha256Hex(boxSecret),
		},
	})

	const launched = await runInstance(creds, config.region, {
		imageId,
		instanceType: config.instance_type,
		userData: bootstrapUserData({
			boxId,
			agentId: agent.id,
			queue: agent.queue,
			route: agent.route,
			ttlSeconds,
			mcpBaseUrl: config.mcp_base_url ?? null,
			claudeModel: agent.route === 'claude' ? config.claude_model : null,
			boxToken: `${boxId}.${boxSecret}`,
			runnerPin: { ref: config.runner_ref, sha256: config.runner_sha256 },
		}),
		tagName: `fermi-${boxId}`,
	})
	if (!launched.ok) {
		await updateBox(env.FERMI_DB, boxId, { status: 'destroyed', destroyedAt: Date.now() })
		return { dispatched: false, reason: launched.error ?? 'run_instances_failed', box_id: boxId }
	}

	await updateBox(env.FERMI_DB, boxId, { instanceRef: launched.instanceId })
	await updateCloudAgent(env.FERMI_DB, agent.id, { boxId, startedAt: Date.now() })
	return { dispatched: true, box_id: boxId, instance_ref: launched.instanceId }
}

export async function dispatchTeardown(env: Env, agent: CloudAgentRow): Promise<ProvisionOutcome> {
	if (!agent.box_id) return { dispatched: false, reason: 'no_box' }
	const box = await getBox(env.FERMI_DB, agent.box_id)
	if (!box) return { dispatched: false, reason: 'box_not_found' }
	if (box.provider !== 'aws' || !box.instance_ref) {
		// Private workers and never-launched boxes have no compute to reclaim.
		await updateBox(env.FERMI_DB, box.box_id, { status: 'destroyed', destroyedAt: Date.now() })
		return { dispatched: false, reason: 'no_compute_attached', box_id: box.box_id }
	}
	const config = await getFleetConfig(env)
	const creds = await getAwsCreds(env)
	if (!creds) return { dispatched: false, reason: 'aws_credentials_missing', box_id: box.box_id }
	const result = await terminateInstances(creds, box.region ?? config.region, [box.instance_ref])
	if (!result.ok) return { dispatched: false, reason: result.error, box_id: box.box_id }
	await updateBox(env.FERMI_DB, box.box_id, { status: 'destroyed', destroyedAt: Date.now() })
	return { dispatched: true, box_id: box.box_id, instance_ref: box.instance_ref }
}
