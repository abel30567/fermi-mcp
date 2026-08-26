export interface MemoryContext {
	task?: string
	query?: string
	entities?: string[]
	constraints?: string[]
}

export interface ContextMemory {
	id: number
	kind: string
	body: string
	pinned: number
	created_at: number
	matched_on: string
}

/** Load memories relevant to a tool-call context. Combines task/query/entities/constraints into LIKE candidates. */
export async function loadRelevantMemoriesForTool(
	ctx: MemoryContext,
	env: Env,
	limit = 5,
): Promise<ContextMemory[]> {
	const terms: string[] = []
	if (ctx.task) terms.push(ctx.task)
	if (ctx.query) terms.push(ctx.query)
	if (ctx.entities) terms.push(...ctx.entities)
	if (ctx.constraints) terms.push(...ctx.constraints)
	if (terms.length === 0) return []

	const seen = new Set<number>()
	const out: ContextMemory[] = []
	for (const t of terms) {
		const trimmed = t.trim()
		if (!trimmed) continue
		const { results } = await env.FERMI_DB.prepare(
			`SELECT id, kind, body, pinned, created_at FROM memory
			 WHERE body LIKE '%' || ?1 || '%' AND decayed_at IS NULL
			 ORDER BY pinned DESC, created_at DESC
			 LIMIT ?2`,
		)
			.bind(trimmed, limit)
			.all<{ id: number; kind: string; body: string; pinned: number; created_at: number }>()
		for (const row of results) {
			if (seen.has(row.id)) continue
			seen.add(row.id)
			out.push({ ...row, matched_on: trimmed })
			if (out.length >= limit) return out
		}
	}
	return out
}
