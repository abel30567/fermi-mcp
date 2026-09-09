import { describe, expect, it } from 'vitest'
import { planReservation } from '../src/do/fleet-do.ts'

const res = (entries: [string, number][]) =>
	Object.fromEntries(entries.map(([id, c]) => [id, { est_cost_usd: c, at: 0, ttl_ms: 3600_000 }]))

describe('FleetDO admission planner', () => {
	const base = { est_cost_usd: 1, max_concurrent: 3, monthly_budget_usd: 50, month_actual_usd: 0 }

	it('allows under cap and budget', () => {
		expect(planReservation({}, base).ok).toBe(true)
		expect(
			planReservation(
				res([
					['a', 1],
					['b', 1],
				]),
				base,
			),
		).toMatchObject({ ok: true, active: 3 })
	})

	it('refuses at the concurrency cap', () => {
		const d = planReservation(
			res([
				['a', 1],
				['b', 1],
				['c', 1],
			]),
			base,
		)
		expect(d).toMatchObject({ ok: false, error: 'concurrency_cap_reached', active: 3 })
	})

	it('refuses when actual + reservations + new exceeds the ceiling', () => {
		// $40 actual + $5 reserved + $6 new = $51 > $50
		const d = planReservation(res([['a', 5]]), { ...base, est_cost_usd: 6, month_actual_usd: 40 })
		expect(d).toMatchObject({ ok: false, error: 'budget_exceeded', projected_usd: 51 })
	})

	it('allows right up to the ceiling', () => {
		const d = planReservation(res([['a', 5]]), { ...base, est_cost_usd: 5, month_actual_usd: 40 })
		expect(d.ok).toBe(true)
	})
})
