export interface FleetConfig {
	region: string
	monthly_budget_usd: number
	max_concurrent: number
	instance_type: string
	claude_model: string
	default_env: string | null
	mcp_base_url: string | null
	/** Supply-chain pin for the box-runner boot download (#34); launch refuses when unset. */
	runner_ref: string | null
	runner_sha256: string | null
	default_ttl_seconds: number
	max_ttl_seconds: number
	heartbeat_stale_ms: number
	provision_grace_ms: number
}

const DEFAULTS: FleetConfig = {
	region: 'us-east-1',
	monthly_budget_usd: 50,
	max_concurrent: 5,
	instance_type: 't3.small',
	claude_model: 'claude-opus-4-6[1m]',
	default_env: null,
	mcp_base_url: null,
	runner_ref: null,
	runner_sha256: null,
	default_ttl_seconds: 3600,
	max_ttl_seconds: 4 * 3600,
	heartbeat_stale_ms: 10 * 60_000,
	provision_grace_ms: 15 * 60_000,
}

// On-demand USD/hour, us-east-1 Linux. Used for budget accrual estimates;
// the authoritative number is the AWS bill (fleetctl report reconciles).
export const HOURLY_RATES: Record<string, number> = {
	't3.micro': 0.0104,
	't3.small': 0.0208,
	't3.medium': 0.0416,
	't3.large': 0.0832,
}

export async function getFleetConfig(env: Env): Promise<FleetConfig> {
	const raw = await env.FERMI_KV.get('fleet:config')
	if (!raw) return { ...DEFAULTS }
	try {
		return { ...DEFAULTS, ...JSON.parse(raw) }
	} catch {
		return { ...DEFAULTS }
	}
}

export function hourlyRate(instanceType: string): number {
	return HOURLY_RATES[instanceType] ?? HOURLY_RATES['t3.small']
}

/** Estimated cost of a run: wall-clock hours x instance rate. */
export function accruedCostUsd(startedAt: number, endedAt: number, instanceType: string): number {
	const hours = Math.max(endedAt - startedAt, 0) / 3_600_000
	return Math.round(hours * hourlyRate(instanceType) * 10_000) / 10_000
}

export function monthStart(now: number): number {
	const d = new Date(now)
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** Sum of estimated spend for agents created this calendar month (UTC). */
export async function monthSpendUsd(db: D1Database, now: number): Promise<number> {
	const row = await db
		.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cloud_agents WHERE created_at >= ?1')
		.bind(monthStart(now))
		.first<{ total: number }>()
	return row?.total ?? 0
}
