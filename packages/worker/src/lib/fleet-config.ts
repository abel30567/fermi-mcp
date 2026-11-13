import { REF_RE, RUNNER_ENTRY, manifestError, runnerUrl } from './runner-pin.ts'

export interface FleetConfig {
	region: string
	monthly_budget_usd: number
	max_concurrent: number
	instance_type: string
	/** Per-launch `instance_type` overrides must come from this list (#43). */
	allowed_instance_types: string[]
	claude_model: string
	default_env: string | null
	mcp_base_url: string | null
	/** Supply-chain pin for the box-runner boot download (#34); launch refuses when unset. */
	runner_ref: string | null
	runner_sha256: string | null
	/** Multi-file pin (MCP-22): path → sha256 at runner_ref; overrides runner_sha256 when set. */
	runner_files: Record<string, string> | null
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
	allowed_instance_types: ['t3.small', 't3.medium', 't3.large'],
	claude_model: 'claude-opus-4-6[1m]',
	default_env: null,
	mcp_base_url: null,
	runner_ref: null,
	runner_sha256: null,
	runner_files: null,
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

/** Resolve a launch's instance type: explicit must be allowlisted, else the fleet default. */
export function resolveInstanceType(
	config: FleetConfig,
	requested: string | undefined,
): { ok: true; instance_type: string } | { ok: false; error: string; allowed: string[] } {
	if (requested === undefined) return { ok: true, instance_type: config.instance_type }
	if (!config.allowed_instance_types.includes(requested)) {
		return { ok: false, error: 'instance_type_not_allowed', allowed: config.allowed_instance_types }
	}
	return { ok: true, instance_type: requested }
}

/**
 * Operator-editable fleet:config fields (POST /admin/fleet/config, #43). The
 * runner pin is deliberately excluded — it has its own fetch+hash endpoint.
 */
export type FleetConfigPatch = Partial<
	Pick<
		FleetConfig,
		| 'instance_type'
		| 'allowed_instance_types'
		| 'max_concurrent'
		| 'monthly_budget_usd'
		| 'default_ttl_seconds'
		| 'claude_model'
	>
>

export function validateFleetConfigPatch(
	current: FleetConfig,
	body: unknown,
): { ok: true; config: FleetConfig; patch: FleetConfigPatch } | { ok: false; error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { ok: false, error: 'body must be an object' }
	}
	const b = body as Record<string, unknown>
	const patch: FleetConfigPatch = {}
	const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
	for (const key of Object.keys(b)) {
		const v = b[key]
		switch (key) {
			case 'instance_type':
			case 'claude_model':
				if (typeof v !== 'string' || v.length === 0 || v.length > 64)
					return { ok: false, error: `${key} must be a non-empty string` }
				patch[key] = v
				break
			case 'allowed_instance_types':
				if (!Array.isArray(v) || v.length === 0 || !v.every((t) => typeof t === 'string' && t))
					return { ok: false, error: 'allowed_instance_types must be a non-empty string array' }
				patch.allowed_instance_types = v as string[]
				break
			case 'max_concurrent':
			case 'default_ttl_seconds':
				if (!isPosInt(v)) return { ok: false, error: `${key} must be a positive integer` }
				patch[key] = v
				break
			case 'monthly_budget_usd':
				if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
					return { ok: false, error: 'monthly_budget_usd must be a non-negative number' }
				patch.monthly_budget_usd = v
				break
			default:
				return { ok: false, error: `${key} is not an editable field` }
		}
	}
	if (Object.keys(patch).length === 0) return { ok: false, error: 'no editable fields supplied' }
	const config: FleetConfig = { ...current, ...patch }
	if (!config.allowed_instance_types.includes(config.instance_type)) {
		return { ok: false, error: 'instance_type must be one of allowed_instance_types' }
	}
	if (config.default_ttl_seconds > config.max_ttl_seconds) {
		return {
			ok: false,
			error: `default_ttl_seconds exceeds max_ttl_seconds (${config.max_ttl_seconds})`,
		}
	}
	return { ok: true, config, patch }
}

/**
 * POST /admin/fleet/pin-runner. `{ref}` (legacy) pins box-runner.mjs at its
 * current hash; `{ref, files: {path: sha256}}` pins a manifest, and every
 * declared hash must match the file at that ref or nothing is stored.
 */
export async function pinRunner(
	env: Env,
	body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const b = (body && typeof body === 'object' ? body : {}) as { ref?: unknown; files?: unknown }
	if (typeof b.ref !== 'string' || !REF_RE.test(b.ref))
		return { status: 400, body: { ok: false, error: 'ref must be a commit sha' } }
	const ref = b.ref
	if (b.files !== undefined) {
		const err = manifestError(b.files)
		if (err) return { status: 400, body: { ok: false, error: err } }
	}
	const declared = b.files as Record<string, string> | undefined
	const files: Record<string, string> = {}
	let bytes = 0
	for (const path of declared ? Object.keys(declared) : [RUNNER_ENTRY]) {
		const res = await fetch(runnerUrl(ref, path))
		if (!res.ok) return { status: 502, body: { ok: false, error: `fetch_${res.status}`, path } }
		const buf = await res.arrayBuffer()
		bytes += buf.byteLength
		const digest = await crypto.subtle.digest('SHA-256', buf)
		files[path] = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('')
		if (declared && declared[path] !== files[path]) {
			const error = 'sha256_mismatch'
			return {
				status: 409,
				body: { ok: false, error, path, expected: declared[path], actual: files[path] },
			}
		}
	}
	const raw = await env.FERMI_KV.get('fleet:config')
	const config = raw ? JSON.parse(raw) : {}
	const sha256 = files[RUNNER_ENTRY]
	await env.FERMI_KV.put(
		'fleet:config',
		JSON.stringify({ ...config, runner_ref: ref, runner_sha256: sha256, runner_files: files }),
	)
	return { status: 200, body: { ok: true, ref, sha256, files, bytes } }
}

export async function updateFleetConfig(
	env: Env,
	body: unknown,
): Promise<{ ok: true; config: FleetConfig } | { ok: false; error: string }> {
	const current = await getFleetConfig(env)
	const verdict = validateFleetConfigPatch(current, body)
	if (!verdict.ok) return verdict
	// Merge onto the raw stored object so unknown/forward fields survive.
	const raw = await env.FERMI_KV.get('fleet:config')
	let stored: Record<string, unknown> = {}
	try {
		stored = raw ? JSON.parse(raw) : {}
	} catch {}
	await env.FERMI_KV.put('fleet:config', JSON.stringify({ ...stored, ...verdict.patch }))
	return { ok: true, config: verdict.config }
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
