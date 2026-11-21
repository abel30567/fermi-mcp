import { sha256Hex } from '../channels/box-gateway.ts'
import { getAwsCreds, runInstance, terminateInstances } from './aws-ec2.ts'
import { getFleetConfig, monthSpendUsd } from './fleet-config.ts'
import type { CloudAgentRow } from './fleet-store.ts'
import { getBox, registerBox, updateBox, updateCloudAgent } from './fleet-store.ts'
import { type HarnessPin, harnessInstallScript, harnessPinFromConfig } from './harness-pin.ts'
import { type RunnerPin, runnerFetchScript, runnerPinFromConfig } from './runner-pin.ts'

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
	antigravityModel?: string | null
	runnerPin: RunnerPin
	harness?: HarnessPin | null
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
		...(opts.route === 'antigravity' && opts.antigravityModel
			? [`ANTIGRAVITY_MODEL=${opts.antigravityModel}`]
			: []),
		'EOF',
		// hbar (ISSUE-89): claude route only, and only when the box can reach the
		// server; without a pin the user-data is unchanged.
		...(opts.harness && opts.route === 'claude' && opts.mcpBaseUrl
			? [
					harnessInstallScript(opts.harness, {
						baseUrl: opts.mcpBaseUrl,
						boxToken: opts.boxToken,
					}),
				]
			: []),
		// Antigravity CLI v1.5.14 fallback: no-op when already baked into the AMI,
		// otherwise fetches the official SHA-512-verified single binary (~101 MB).
		...(opts.route === 'antigravity'
			? [
					'if [ ! -x /opt/fermi/antigravity/antigravity ]; then',
					'  case "$(uname -m)" in',
					'    x86_64|amd64) AGY_URL="https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/linux-x64/cli_linux_x64.tar.gz"; AGY_SHA512="83311d3f354567612dc16c1ae2ea9b503d6f6833aa4e138d39aa229da3f3bb99b0e4d7cca0bce4796b0060d6a51d8113eb7449ed5dc0e7900bf217107ea5bff9" ;;',
					'    aarch64|arm64) AGY_URL="https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/linux-arm/cli_linux_arm64.tar.gz"; AGY_SHA512="c9b29bba475f63a1a80161ae93ba72b221c7a586d9851e4d0061546704bab66d6b2760b25d716d191724fc7564f3246456ee151e28aa37af48dbcd72bdc6c463" ;;',
					'    *) echo "unsupported arch for antigravity: $(uname -m)" >&2; exit 1 ;;',
					'  esac',
					'  AGY_TMP=$(mktemp -d)',
					'  curl -fsSL --retry 4 --retry-delay 2 "$AGY_URL" -o "$AGY_TMP/agy.tar.gz"',
					'  echo "$AGY_SHA512  $AGY_TMP/agy.tar.gz" | sha512sum -c -',
					'  mkdir -p /opt/fermi/antigravity',
					'  tar -xzf "$AGY_TMP/agy.tar.gz" -C /opt/fermi/antigravity',
					'  chmod 0755 /opt/fermi/antigravity/antigravity && chmod -R a+rX /opt/fermi/antigravity',
					'  rm -rf "$AGY_TMP"',
					'fi',
				]
			: []),
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
	const runnerPin = runnerPinFromConfig(config)
	if (!runnerPin) return { dispatched: false, reason: 'runner_pin_unset' }

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
	// Per-launch size (#43) recorded on the agent at launch; fleet default otherwise.
	const instanceType = agent.instance_type ?? config.instance_type
	// Per-box credential: secret only ever exists in user-data; hash at rest.
	// Destroying the box revokes it (authBox refuses destroyed boxes).
	const boxSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
	await registerBox(env.FERMI_DB, {
		boxId,
		provider: 'aws',
		region: config.region,
		snapshotRef: imageId,
		meta: {
			instance_type: instanceType,
			agent_id: agent.id,
			token_hash: await sha256Hex(boxSecret),
		},
	})

	const launched = await runInstance(creds, config.region, {
		imageId,
		instanceType,
		userData: bootstrapUserData({
			boxId,
			agentId: agent.id,
			queue: agent.queue,
			route: agent.route,
			ttlSeconds,
			mcpBaseUrl: config.mcp_base_url ?? null,
			claudeModel: agent.route === 'claude' ? config.claude_model : null,
			antigravityModel: agent.route === 'antigravity' ? config.antigravity_model : null,
			boxToken: `${boxId}.${boxSecret}`,
			runnerPin,
			harness: harnessPinFromConfig(config),
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
