export type UsageGroupBy = 'tool' | 'day' | 'risk' | 'outcome'
export type UsageSort = 'calls' | 'est_tokens'

export interface UsageStatsInput {
	since?: string
	group_by?: UsageGroupBy
	tool?: string
	sort?: UsageSort
	limit?: number
}

export interface UsageRow {
	key: string
	calls: number
	ok: number
	denied: number
	pending: number
	total_result_bytes: number
	avg_result_bytes: number | null
	est_tokens: number
	avg_duration_ms: number | null
	first_used_at: number | null
	last_used_at: number | null
}

const DAY_MS = 86_400_000
// Rough heuristic for English/JSON payloads; the MCP server never sees the
// LLM client's real token counts, so this is an estimate by design.
const BYTES_PER_TOKEN = 4

/** Parse '7d' / '30d' / '12h' / epoch-ms into a since-timestamp. Default 30d. */
export function parseSince(since: string | undefined, now = Date.now()): number {
	if (!since) return now - 30 * DAY_MS
	const rel = /^(\d+)([dh])$/.exec(since.trim())
	if (rel) {
		const n = Number(rel[1])
		return now - n * (rel[2] === 'd' ? DAY_MS : 3_600_000)
	}
	const ms = Number(since)
	if (Number.isFinite(ms) && ms > 0) return ms
	return now - 30 * DAY_MS
}

const GROUP_EXPR: Record<UsageGroupBy, string> = {
	tool: 'tool',
	day: "date(ts / 1000, 'unixepoch')",
	risk: "COALESCE(risk, 'unknown')",
	outcome: "COALESCE(outcome, 'unknown')",
}

export async function getUsageStats(
	input: UsageStatsInput,
	env: Env,
): Promise<{
	since: number
	group_by: UsageGroupBy
	rows: UsageRow[]
	totals: { calls: number; total_result_bytes: number; est_tokens: number }
	notes: string[]
}> {
	const groupBy = input.group_by ?? 'tool'
	const since = parseSince(input.since)
	const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)
	const orderBy = input.sort === 'est_tokens' ? 'total_result_bytes DESC' : 'calls DESC'
	const expr = GROUP_EXPR[groupBy]

	const conditions = ['ts >= ?1']
	const binds: unknown[] = [since]
	if (input.tool) {
		conditions.push(`tool = ?${binds.length + 1}`)
		binds.push(input.tool)
	}
	const where = conditions.join(' AND ')

	const { results } = await env.FERMI_DB.prepare(
		`SELECT ${expr} AS key,
		        COUNT(*) AS calls,
		        SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END) AS ok,
		        SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
		        SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
		        COALESCE(SUM(result_bytes), 0) AS total_result_bytes,
		        AVG(result_bytes) AS avg_result_bytes,
		        AVG(duration_ms) AS avg_duration_ms,
		        MIN(ts) AS first_used_at,
		        MAX(ts) AS last_used_at
		   FROM audit
		  WHERE ${where}
		  GROUP BY ${expr}
		  ORDER BY ${orderBy}
		  LIMIT ?${binds.length + 1}`,
	)
		.bind(...binds, limit)
		.all<Omit<UsageRow, 'est_tokens'>>()

	const rows: UsageRow[] = results.map((r) => ({
		...r,
		avg_result_bytes: r.avg_result_bytes != null ? Math.round(r.avg_result_bytes) : null,
		avg_duration_ms: r.avg_duration_ms != null ? Math.round(r.avg_duration_ms) : null,
		est_tokens: Math.round(r.total_result_bytes / BYTES_PER_TOKEN),
	}))

	const totals = rows.reduce(
		(acc, r) => {
			acc.calls += r.calls
			acc.total_result_bytes += r.total_result_bytes
			acc.est_tokens += r.est_tokens
			return acc
		},
		{ calls: 0, total_result_bytes: 0, est_tokens: 0 },
	)

	return {
		since,
		group_by: groupBy,
		rows,
		totals,
		notes: [
			`est_tokens assumes ~${BYTES_PER_TOKEN} bytes/token over the JSON-serialized tool result; the LLM client's real token usage may differ.`,
			'Audit rows written before the usage-analytics migration have no result_bytes/duration_ms and contribute only to call counts.',
		],
	}
}
