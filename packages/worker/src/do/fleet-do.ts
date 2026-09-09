import { DurableObject } from 'cloudflare:workers'

interface Reservation {
	est_cost_usd: number
	at: number
	ttl_ms: number
}

export interface ReserveDecision {
	ok: boolean
	error?: string
	active?: number
	reserved_usd?: number
	projected_usd?: number
	monthly_budget_usd?: number
}

/** Pure admission decision (cap + reserved-budget), unit-testable without the DO
 * harness. `reservations` is the live map AFTER expired-entry pruning. */
export function planReservation(
	reservations: Record<string, Reservation>,
	input: {
		est_cost_usd: number
		max_concurrent: number
		monthly_budget_usd: number
		month_actual_usd: number
	},
): ReserveDecision {
	const active = Object.keys(reservations).length
	if (active >= input.max_concurrent) {
		return { ok: false, error: 'concurrency_cap_reached', active }
	}
	const reserved = Object.values(reservations).reduce((s, r) => s + r.est_cost_usd, 0)
	const projected = input.month_actual_usd + reserved + input.est_cost_usd
	if (projected > input.monthly_budget_usd) {
		return {
			ok: false,
			error: 'budget_exceeded',
			projected_usd: Math.round(projected * 100) / 100,
			monthly_budget_usd: input.monthly_budget_usd,
		}
	}
	return { ok: true, active: active + 1, reserved_usd: reserved + input.est_cost_usd }
}

/**
 * Single-instance fleet admission mutex. All launches serialize through this DO
 * (idFromName('global')), closing the TOCTOU where N concurrent launches each
 * read SUM(cost_usd)≈0 and all pass the ceiling. It holds live reservations
 * (rate×ttl estimates) and enforces max-concurrent + a reserved-budget ceiling
 * on top of the caller-supplied actual month spend from D1.
 */
export class FleetDO extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		if (url.pathname === '/reserve') return this.reserve(await request.json())
		if (url.pathname === '/release') return this.release(await request.json())
		if (url.pathname === '/state') return Response.json(await this.snapshot())
		return new Response('Not Found', { status: 404 })
	}

	private async prune(now: number): Promise<Record<string, Reservation>> {
		const res = ((await this.ctx.storage.get('reservations')) as Record<string, Reservation>) ?? {}
		let changed = false
		for (const [id, r] of Object.entries(res)) {
			// Safety valve: a reservation whose release was missed cannot block the
			// fleet forever — drop it once the agent is definitely gone (ttl + 1h grace).
			if (now > r.at + r.ttl_ms + 3_600_000) {
				delete res[id]
				changed = true
			}
		}
		if (changed) await this.ctx.storage.put('reservations', res)
		return res
	}

	async reserve(input: {
		agent_id: string
		est_cost_usd: number
		ttl_seconds: number
		max_concurrent: number
		monthly_budget_usd: number
		month_actual_usd: number
	}): Promise<Response> {
		// blockConcurrencyWhile serializes every admission decision on this DO.
		return this.ctx.blockConcurrencyWhile(async () => {
			const now = Date.now()
			const res = await this.prune(now)
			const decision = planReservation(res, input)
			if (!decision.ok) return Response.json(decision)
			res[input.agent_id] = {
				est_cost_usd: input.est_cost_usd,
				at: now,
				ttl_ms: input.ttl_seconds * 1000,
			}
			await this.ctx.storage.put('reservations', res)
			return Response.json(decision)
		})
	}

	async release(input: { agent_id: string }): Promise<Response> {
		return this.ctx.blockConcurrencyWhile(async () => {
			const res =
				((await this.ctx.storage.get('reservations')) as Record<string, Reservation>) ?? {}
			const existed = input.agent_id in res
			delete res[input.agent_id]
			await this.ctx.storage.put('reservations', res)
			return Response.json({ ok: true, released: existed })
		})
	}

	async snapshot(): Promise<{
		active: number
		reserved_usd: number
		reservations: Record<string, Reservation>
	}> {
		const res = ((await this.ctx.storage.get('reservations')) as Record<string, Reservation>) ?? {}
		return {
			active: Object.keys(res).length,
			reserved_usd: Object.values(res).reduce((s, r) => s + r.est_cost_usd, 0),
			reservations: res,
		}
	}
}

// Thin client so the worker code doesn't repeat DO plumbing. Returns null when
// the binding is absent (e.g. unit tests without the DO wired) so best-effort
// callers degrade gracefully.
function fleetStub(env: Env): DurableObjectStub | null {
	const ns = (env as unknown as { FLEET_DO?: DurableObjectNamespace }).FLEET_DO
	if (!ns) return null
	return ns.get(ns.idFromName('global'))
}

export async function fleetReserve(
	env: Env,
	input: {
		agent_id: string
		est_cost_usd: number
		ttl_seconds: number
		max_concurrent: number
		monthly_budget_usd: number
		month_actual_usd: number
	},
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
	const stub = fleetStub(env)
	if (!stub) return { ok: true, degraded: 'fleet_do_unbound' }
	const res = await stub.fetch('https://do/reserve', {
		method: 'POST',
		body: JSON.stringify(input),
	})
	return res.json()
}

export async function fleetRelease(env: Env, agentId: string): Promise<void> {
	await fleetStub(env)
		?.fetch('https://do/release', { method: 'POST', body: JSON.stringify({ agent_id: agentId }) })
		.catch(() => {})
}
