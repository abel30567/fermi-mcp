export type MemoryKind = 'fact' | 'preference' | 'event'

export interface MemoryRow {
	id: number
	kind: MemoryKind
	body: string
	pinned: number
	created_at: number
}

export type RecallSort = 'relevance' | 'created_at'

export async function recallMemories(
	query: string,
	limit: number,
	env: Env,
	sortBy: RecallSort = 'relevance',
): Promise<MemoryRow[]> {
	const orderBy = sortBy === 'created_at' ? 'created_at DESC' : 'pinned DESC, created_at DESC'
	const { results } = await env.FERMI_DB.prepare(
		`SELECT id, kind, body, pinned, created_at
		   FROM memory
		  WHERE body LIKE '%' || ?1 || '%' AND decayed_at IS NULL
		  ORDER BY ${orderBy}
		  LIMIT ?2`,
	)
		.bind(query, limit)
		.all<MemoryRow>()
	return results
}

export async function listRecentMemories(limit: number, env: Env): Promise<MemoryRow[]> {
	const { results } = await env.FERMI_DB.prepare(
		`SELECT id, kind, body, pinned, created_at
		   FROM memory
		  WHERE decayed_at IS NULL
		  ORDER BY created_at DESC
		  LIMIT ?1`,
	)
		.bind(limit)
		.all<MemoryRow>()
	return results
}

export interface WrittenMemory {
	id: number
	kind: MemoryKind
	body: string
	pinned: boolean
	created_at: number
}

export async function writeMemory(
	input: { kind: MemoryKind; body: string; pinned?: boolean },
	env: Env,
): Promise<WrittenMemory> {
	let embedding: ArrayBuffer | null = null
	try {
		const result = (await env.AI.run('@cf/baai/bge-base-en-v1.5', {
			text: [input.body],
		})) as { data?: number[][] }
		if (result?.data?.[0]) {
			embedding = new Float32Array(result.data[0]).buffer
		}
	} catch {
		// AI binding unavailable (local dev) - skip embedding
	}

	const now = Date.now()
	const res = await env.FERMI_DB.prepare(
		'INSERT INTO memory (kind, body, embedding, created_at, pinned) VALUES (?1, ?2, ?3, ?4, ?5)',
	)
		.bind(input.kind, input.body, embedding, now, input.pinned ? 1 : 0)
		.run()

	return {
		id: res.meta.last_row_id as number,
		kind: input.kind,
		body: input.body,
		pinned: !!input.pinned,
		created_at: now,
	}
}

export async function updateMemory(
	id: number,
	patch: { kind?: MemoryKind; body?: string; pinned?: boolean },
	env: Env,
): Promise<{ updated: boolean; changes: number }> {
	const sets: string[] = []
	const values: unknown[] = []
	let idx = 1
	if (patch.kind !== undefined) {
		sets.push(`kind = ?${idx++}`)
		values.push(patch.kind)
	}
	if (patch.body !== undefined) {
		sets.push(`body = ?${idx++}`)
		values.push(patch.body)
	}
	if (patch.pinned !== undefined) {
		sets.push(`pinned = ?${idx++}`)
		values.push(patch.pinned ? 1 : 0)
	}
	if (sets.length === 0) return { updated: false, changes: 0 }
	values.push(id)
	const sql = `UPDATE memory SET ${sets.join(', ')} WHERE id = ?${idx} AND decayed_at IS NULL`
	const res = await env.FERMI_DB.prepare(sql)
		.bind(...values)
		.run()
	return { updated: (res.meta.changes ?? 0) > 0, changes: res.meta.changes ?? 0 }
}

export async function deleteMemory(id: number, env: Env): Promise<{ deleted: boolean }> {
	const res = await env.FERMI_DB.prepare(
		'UPDATE memory SET decayed_at = ?1 WHERE id = ?2 AND decayed_at IS NULL',
	)
		.bind(Date.now(), id)
		.run()
	return { deleted: (res.meta.changes ?? 0) > 0 }
}
