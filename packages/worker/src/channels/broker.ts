import { getCloudAgent } from '../lib/fleet-store.ts'
import { claimTasks, completeTask, enqueueTask, waitForTask } from '../lib/task-store.ts'
import { getWebSessionMeta } from '../lib/web-session-store.ts'
import { authBox, boxMeta } from './box-gateway.ts'

/**
 * Session broker (#32): boxes drive leased web sessions by RPC instead of
 * receiving raw storageState. Cookies live only in the control plane (D1
 * encrypted at rest, decrypted only for the Mac executor, which also owns the
 * residential IP the session was captured on). Every op round-trips this
 * worker, so invalidating a session cuts off in-flight boxes at the next op.
 *
 * Flow: box POST /box/browser-rpc → op task on the broker queue → Mac executor
 * claims via /admin/broker/claim, drives Playwright locally, completes via
 * /admin/broker/complete → box collects via POST /box/browser-rpc/wait.
 */

export const BROKER_QUEUE = 'broker:ops'

// NO evaluate op: arbitrary page JS could read document.cookie and exfiltrate
// the session through the RPC result — the exact leak the broker exists to
// stop. extract is textContent-only, which cannot see cookies.
const OPS = new Set(['goto', 'click', 'fill', 'extract', 'screenshot'])

function hostAllowed(site: string, url: string): boolean {
	try {
		const sessionHost = new URL(site).hostname
		const opHost = new URL(url).hostname
		return opHost === sessionHost || opHost.endsWith(`.${sessionHost}`)
	} catch {
		return false
	}
}

export async function handleBoxBrowserRpc(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as {
		session?: string
		op?: string
		args?: Record<string, unknown>
	}
	if (typeof body.session !== 'string' || !body.op || !OPS.has(body.op)) {
		return Response.json(
			{ ok: false, error: `op must be one of ${[...OPS].join('|')}` },
			{ status: 400 },
		)
	}

	// Launch binding, same rule as session-lease: only sessions the mission
	// explicitly named.
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
	if (!named.includes(body.session)) {
		return Response.json({ ok: false, error: 'session_not_in_launch' }, { status: 403 })
	}

	// Session must still be live — this check on EVERY op is what makes
	// invalidate an immediate kill switch for in-flight boxes.
	const meta = await getWebSessionMeta(env, body.session)
	if (!meta || meta.revoked_at || (meta.expires_at && meta.expires_at < Date.now())) {
		return Response.json({ ok: false, error: 'session_invalid' }, { status: 403 })
	}

	// Origin allowlist: navigation targets must stay on the session's site.
	const url = body.args?.url
	if (typeof url === 'string' && !hostAllowed(meta.site, url)) {
		return Response.json({ ok: false, error: 'origin_not_allowed' }, { status: 403 })
	}

	const op = await enqueueTask(env.FERMI_DB, {
		channel: 'broker',
		sender: `box:${box.box_id}`,
		chatId: 'broker',
		queue: BROKER_QUEUE,
		payload: JSON.stringify({
			session: body.session,
			site: meta.site,
			op: body.op,
			args: body.args ?? {},
			box_id: box.box_id,
			agent_id: agentId,
		}),
	})
	return Response.json({ ok: true, op_id: op.id })
}

export async function handleBoxBrowserRpcWait(request: Request, env: Env): Promise<Response> {
	const box = await authBox(request, env)
	if (!box) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as {
		op_id?: string
		timeout_seconds?: number
	}
	if (typeof body.op_id !== 'string') return new Response('Bad Request', { status: 400 })
	const row = await env.FERMI_DB.prepare('SELECT queue, payload FROM tasks WHERE id = ?1')
		.bind(body.op_id)
		.first<{ queue: string; payload: string }>()
	let owner: string | undefined
	try {
		owner = row ? (JSON.parse(row.payload).box_id as string) : undefined
	} catch {}
	if (!row || row.queue !== BROKER_QUEUE || owner !== box.box_id) {
		return Response.json({ ok: false, error: 'op_not_yours' }, { status: 403 })
	}
	const timeoutMs = Math.min(Math.max((body.timeout_seconds ?? 60) * 1000, 1000), 120_000)
	const outcome = await waitForTask(env.FERMI_DB, body.op_id, { timeoutMs })
	return Response.json({
		ok: outcome.status === 'done',
		status: outcome.status,
		result: outcome.result ?? null,
	})
}

function adminAuthorized(request: Request, env: Env): boolean {
	const auth = request.headers.get('authorization') ?? ''
	return Boolean(env.FERMI_BEARER_TOKEN) && auth === `Bearer ${env.FERMI_BEARER_TOKEN}`
}

export async function handleBrokerClaim(request: Request, env: Env): Promise<Response> {
	if (!adminAuthorized(request, env)) return new Response('Unauthorized', { status: 401 })
	const ops = await claimTasks(env.FERMI_DB, {
		queue: BROKER_QUEUE,
		claimedBy: 'mac-broker',
		limit: 1,
		leaseMs: 2 * 60_000,
	})
	return Response.json({ ok: true, op: ops[0] ?? null })
}

export async function handleBrokerComplete(request: Request, env: Env): Promise<Response> {
	if (!adminAuthorized(request, env)) return new Response('Unauthorized', { status: 401 })
	const body = (await request.json().catch(() => ({}))) as {
		op_id?: string
		ok?: boolean
		data?: unknown
		error?: string
	}
	if (typeof body.op_id !== 'string') return new Response('Bad Request', { status: 400 })
	const outcome = await completeTask(env.FERMI_DB, body.op_id, {
		status: body.ok === false ? 'failed' : 'done',
		result: JSON.stringify({
			ok: body.ok !== false,
			data: body.data ?? null,
			error: body.error ?? null,
		}),
		claimedBy: 'mac-broker',
	})
	return Response.json(outcome, { status: outcome.ok ? 200 : 409 })
}
