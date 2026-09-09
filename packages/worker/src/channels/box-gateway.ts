import { accruedCostUsd } from '../lib/fleet-config.ts'
import type { BoxRow } from '../lib/fleet-store.ts'
import {
	getBox,
	getCloudAgent,
	heartbeatBox,
	updateBox,
	updateCloudAgent,
} from '../lib/fleet-store.ts'
import { getSecret, putSecret } from '../lib/secrets-store.ts'
import { claimTasks, completeTask, countPendingTasks, enqueueTask } from '../lib/task-store.ts'

// Inference credentials live in Fermi secrets; boxes fetch them at boot and
// write refreshed OAuth bundles back so rotation never strands the fleet.
const ROUTE_SECRETS: Record<string, string[]> = {
	claude: ['CLAUDE_CODE_OAUTH_TOKEN'],
	codex: ['CPA_AUTH_CODEX', 'CPA_API_KEY'],
	grok: ['CPA_AUTH_XAI', 'CPA_API_KEY'],
}
const WRITABLE_AUTH_SECRETS = new Set(['CPA_AUTH_CODEX', 'CPA_AUTH_XAI'])

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function boxMeta(box: BoxRow): { token_hash?: string; agent_id?: string } {
	try {
		return JSON.parse(box.meta)
	} catch {
		return {}
	}
}

/**
 * Per-box bearer auth: tokens look like "<box_id>.<secret>"; only the SHA-256
 * of the secret is at rest (boxes.meta.token_hash). Destroyed boxes always
 * fail auth — destroying a box IS the revocation.
 */
export async function authBox(request: Request, env: Env): Promise<BoxRow | null> {
	const auth = request.headers.get('authorization') ?? ''
	if (!auth.startsWith('Bearer ')) return null
	const token = auth.slice(7)
	const dot = token.indexOf('.')
	if (dot <= 0) return null
	const boxId = token.slice(0, dot)
	const secret = token.slice(dot + 1)
	const box = await getBox(env.FERMI_DB, boxId)
	if (!box || box.status === 'destroyed') return null
	const meta = boxMeta(box)
	if (!meta.token_hash || meta.token_hash !== (await sha256Hex(secret))) return null
	return box
}

export async function handleBoxHeartbeat(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	await heartbeatBox(env.FERMI_DB, box.box_id)
	const agentId = boxMeta(box).agent_id
	const queue = agentId ? `agent:${agentId}` : null
	return Response.json({
		ok: true,
		at: Date.now(),
		pending: queue ? await countPendingTasks(env.FERMI_DB, queue) : 0,
		pending_control: queue ? await countPendingTasks(env.FERMI_DB, `${queue}:ctl`) : 0,
	})
}

/**
 * One poll returns at most one work task (leased to this box) plus every
 * pending control message (delivered exactly once — claimed and completed in
 * the same request).
 */
export async function handleBoxPoll(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const agentId = boxMeta(box).agent_id
	if (!agentId) return Response.json({ ok: false, error: 'box_has_no_agent' }, { status: 400 })
	const body = (await request.json().catch(() => ({}))) as { lease_minutes?: number }
	const queue = `agent:${agentId}`

	const control = await claimTasks(env.FERMI_DB, {
		queue: `${queue}:ctl`,
		limit: 10,
		claimedBy: box.box_id,
	})
	for (const c of control) {
		await completeTask(env.FERMI_DB, c.id, { result: 'delivered', claimedBy: box.box_id })
	}

	const [task] = await claimTasks(env.FERMI_DB, {
		queue,
		limit: 1,
		claimedBy: box.box_id,
		leaseMs:
			typeof body.lease_minutes === 'number'
				? Math.min(Math.max(body.lease_minutes, 1), 240) * 60_000
				: undefined,
	})
	if (task) {
		const agent = await getCloudAgent(env.FERMI_DB, agentId)
		if (agent && agent.status === 'launching') {
			await updateCloudAgent(env.FERMI_DB, agentId, { status: 'running' })
		}
	}
	return Response.json({
		ok: true,
		task: task ?? null,
		control: control.map((c) => JSON.parse(c.payload)),
	})
}

export async function handleBoxComplete(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as {
		task_id?: string
		status?: 'done' | 'failed'
		result?: string
		inference_cost_usd?: number
	}
	if (typeof body.task_id !== 'string') return new Response('Bad Request', { status: 400 })
	const status = body.status === 'failed' ? 'failed' : 'done'

	// Mechanical proof check (#36): a structured contract must pass before
	// `done` is accepted; text claims (`RESULT: PROOF_OK`) count for nothing.
	// Refusal leaves the task claimed so the box can fix its work or fail
	// honestly. Free-text contracts predating #36 are grandfathered.
	let proofVerdict: 'pass' | 'unverifiable' | 'legacy' = 'legacy'
	const preCheckAgentId = boxMeta(box).agent_id
	if (status === 'done' && preCheckAgentId) {
		const preAgent = await getCloudAgent(env.FERMI_DB, preCheckAgentId)
		if (preAgent && preAgent.task_id === body.task_id) {
			const { checkProofContract, parseProofContract } = await import('../lib/proof-contract.ts')
			const parsed = parseProofContract(preAgent.proof_contract)
			if (parsed.ok) {
				const check = await checkProofContract(parsed.contract, {
					getArtifact: async (name) => {
						const obj = await env.FERMI_BUCKET.get(`artifacts/${preCheckAgentId}/${name}`)
						return obj ? { bytes: await obj.arrayBuffer() } : null
					},
					fetchUrl: async (url) => {
						const res = await fetch(url, { redirect: 'follow' })
						return { status: res.status, body: (await res.text()).slice(0, 65536) }
					},
				})
				if (check.verdict === 'fail') {
					return Response.json(
						{ ok: false, error: 'proof_unverified', detail: check.detail },
						{ status: 422 },
					)
				}
				proofVerdict = check.verdict
			}
		}
	}

	const outcome = await completeTask(env.FERMI_DB, body.task_id, {
		status,
		result: body.result,
		claimedBy: box.box_id,
	})
	if (!outcome.ok) return Response.json(outcome, { status: 409 })

	const agentId = boxMeta(box).agent_id
	if (agentId) {
		const agent = await getCloudAgent(env.FERMI_DB, agentId)
		if (agent && agent.task_id === body.task_id) {
			// Inference is covered by the OAuth subscriptions (claude/codex/grok
			// setup tokens), so it does NOT count against the AWS budget:
			// cost_usd is EC2 wall-clock only, finalized here; the reported
			// inference figure is kept separately as telemetry (inference_usd).
			const inference =
				typeof body.inference_cost_usd === 'number' && body.inference_cost_usd >= 0
					? body.inference_cost_usd
					: 0
			let instanceType = 't3.small'
			try {
				instanceType = JSON.parse(box.meta).instance_type ?? instanceType
			} catch {}
			// 'completed_unverified' flags test/dom contracts the worker cannot
			// check itself — orchestrators replay those via fleetctl verify.
			const doneReason = proofVerdict === 'unverifiable' ? 'completed_unverified' : 'completed'
			await updateCloudAgent(env.FERMI_DB, agentId, {
				status,
				endedAt: Date.now(),
				exitReason: status === 'done' ? doneReason : (body.result ?? 'failed'),
				costUsd: accruedCostUsd(agent.started_at ?? agent.created_at, Date.now(), instanceType),
				inferenceUsd: agent.inference_usd + inference,
			})
		}
		// Release the reservation whenever the box's work task terminates — one
		// agent per box, so a completed/failed task means the slot is free. Doing
		// this unconditionally (not only on the task_id match) prevents leaked
		// reservations when an agent fails abnormally.
		const { fleetRelease } = await import('../do/fleet-do.ts')
		await fleetRelease(env, agentId)
		// The runner powers off right after completing; reflect that now instead
		// of leaving the box "online" until the stale-heartbeat reaper catches up
		// (~10 min of confusing status). The reaper still owns the final
		// offline -> destroyed transition via confirmed EC2 termination (#37).
		await updateBox(env.FERMI_DB, box.box_id, { status: 'offline' })
	}
	return Response.json({ ok: true })
}

/**
 * Hand a box the credentials for its inference route. claude → a dedicated
 * long-lived Claude Code OAuth token (claude setup-token). codex/grok → the
 * CLIProxyAPI auth bundle the box runs LOCALLY, talking straight to the
 * provider — the Mac is never an exposed proxy.
 */
export async function handleBoxInferenceAuth(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const agentId = boxMeta(box).agent_id
	const agent = agentId ? await getCloudAgent(env.FERMI_DB, agentId) : null
	if (!agent) return Response.json({ ok: false, error: 'box_has_no_agent' }, { status: 400 })

	const names = [...(ROUTE_SECRETS[agent.route] ?? [])]

	// Repo credentials are least-privilege: only missions whose task payload
	// names a repo get GITHUB_TOKEN.
	if (agent.task_id) {
		const task = await env.FERMI_DB.prepare('SELECT payload FROM tasks WHERE id = ?1')
			.bind(agent.task_id)
			.first<{ payload: string }>()
		try {
			if (task && JSON.parse(task.payload).repo) names.push('GITHUB_TOKEN')
		} catch {}
	}

	const values: Record<string, string> = {}
	const missing: string[] = []
	for (const name of names) {
		const secret = await getSecret(name, 'app', '', env)
		if (secret) values[name] = secret.value
		else missing.push(name)
	}
	if (missing.length > 0) {
		return Response.json(
			{ ok: false, error: 'inference_auth_not_configured', missing },
			{ status: 409 },
		)
	}
	return Response.json({ ok: true, route: agent.route, secrets: values })
}

/** Writeback for refreshed CLIProxyAPI OAuth bundles (rotation-safe fleet). */
export async function handleBoxInferenceAuthUpdate(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as { secrets?: Record<string, string> }
	if (!body.secrets || typeof body.secrets !== 'object') {
		return new Response('Bad Request', { status: 400 })
	}
	const updated: string[] = []
	for (const [name, value] of Object.entries(body.secrets)) {
		if (!WRITABLE_AUTH_SECRETS.has(name) || typeof value !== 'string' || value.length > 65_536) {
			continue
		}
		// The upsert overwrites allowlists; carry the existing ones forward.
		const existing = await getSecret(name, 'app', '', env)
		await putSecret(
			{
				name,
				scope: 'app',
				value,
				allowedHosts: existing?.metadata.allowed_hosts ?? [],
				allowedCapabilities: existing?.metadata.allowed_capabilities ?? [],
				allowedPackages: existing?.metadata.allowed_packages ?? [],
			},
			env,
		)
		updated.push(name)
	}
	return Response.json({ ok: true, updated })
}

/** Box leases a captured web session (concurrency-capped, allowed_boxes-scoped). */
export async function handleBoxSessionLease(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as {
		name?: string
		lease_seconds?: number
	}
	if (typeof body.name !== 'string') return new Response('Bad Request', { status: 400 })
	// Bind the lease to the launch: a box may only lease a session its own
	// mission explicitly named (payload.sessions). Closes "any live box can
	// lease any session by name" (review C-4).
	const agentId = boxMeta(box).agent_id
	const agent = agentId ? await getCloudAgent(env.FERMI_DB, agentId) : null
	if (!agent?.task_id) {
		return Response.json({ ok: false, error: 'box_has_no_agent' }, { status: 400 })
	}
	const task = await env.FERMI_DB.prepare('SELECT payload FROM tasks WHERE id = ?1')
		.bind(agent.task_id)
		.first<{ payload: string }>()
	let named: string[] = []
	try {
		named = JSON.parse(task?.payload ?? '{}').sessions ?? []
	} catch {}
	if (!named.includes(body.name)) {
		return Response.json({ ok: false, error: 'session_not_in_launch' }, { status: 403 })
	}
	const { leaseWebSession } = await import('../lib/web-session-store.ts')
	const result = await leaseWebSession(
		env,
		body.name,
		box.box_id,
		Math.min(Math.max(body.lease_seconds ?? 3600, 60), 14400),
	)
	if (!result.ok) return Response.json(result, { status: 409 })
	// Broker mode (#32): the box gets a handle, never the cookies. It drives
	// the session via /box/browser-rpc; storageState stays in the control plane.
	return Response.json({
		ok: true,
		mode: 'broker',
		session: body.name,
		site: result.site,
		lease_id: result.lease_id,
		expires_at: result.expires_at,
	})
}

export async function handleBoxSessionRelease(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as { lease_id?: string }
	if (typeof body.lease_id !== 'string') return new Response('Bad Request', { status: 400 })
	const { releaseWebSession } = await import('../lib/web-session-store.ts')
	return Response.json(await releaseWebSession(env, body.lease_id))
}

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

/**
 * Proof-artifact upload: raw body streamed to R2 under the agent's prefix.
 * Filename comes from the x-artifact-name header and is sanitized to a flat
 * basename — a box cannot write outside artifacts/<its agent id>/.
 */
export async function handleBoxArtifact(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const agentId = boxMeta(box).agent_id
	if (!agentId) return Response.json({ ok: false, error: 'box_has_no_agent' }, { status: 400 })

	const rawName = request.headers.get('x-artifact-name') ?? ''
	const name = rawName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128)
	if (!name || name.startsWith('.')) return new Response('Bad Request', { status: 400 })

	const length = Number(request.headers.get('content-length') ?? 0)
	if (!length || length > MAX_ARTIFACT_BYTES) {
		return Response.json({ ok: false, error: 'artifact_too_large_or_empty' }, { status: 413 })
	}

	const key = `artifacts/${agentId}/${name}`
	await env.FERMI_BUCKET.put(key, request.body, {
		httpMetadata: {
			contentType: request.headers.get('content-type') ?? 'application/octet-stream',
		},
	})
	await updateCloudAgent(env.FERMI_DB, agentId, { artifactsPrefix: `artifacts/${agentId}/` })
	return Response.json({ ok: true, key })
}

export async function listAgentArtifacts(
	env: Env,
	agentId: string,
): Promise<{ key: string; size: number }[]> {
	const listed = await env.FERMI_BUCKET.list({ prefix: `artifacts/${agentId}/`, limit: 100 })
	return listed.objects.map((o) => ({ key: o.key, size: o.size }))
}

export async function handleBoxReport(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const agentId = boxMeta(box).agent_id
	if (!agentId) return Response.json({ ok: false, error: 'box_has_no_agent' }, { status: 400 })
	const body = (await request.json().catch(() => ({}))) as {
		status?: 'running' | 'waiting_human'
		artifacts_prefix?: string
		note?: string
	}
	const patch: Parameters<typeof updateCloudAgent>[2] = {}
	if (body.status === 'running' || body.status === 'waiting_human') patch.status = body.status
	if (typeof body.artifacts_prefix === 'string') patch.artifactsPrefix = body.artifacts_prefix
	await updateCloudAgent(env.FERMI_DB, agentId, patch)
	if (typeof body.note === 'string' && body.note.length > 0) {
		// Progress notes land as completed rows on the agent's events queue so
		// orchestrators see them via cloud_agent_get without a schema change.
		const event = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: `box:${box.box_id}`,
			chatId: 'cloud',
			payload: body.note.slice(0, 4000),
			queue: `agent:${agentId}:events`,
		})
		await claimTasks(env.FERMI_DB, { queue: `agent:${agentId}:events`, claimedBy: box.box_id })
		await completeTask(env.FERMI_DB, event.id, { result: 'noted', claimedBy: box.box_id })
	}
	return Response.json({ ok: true })
}
