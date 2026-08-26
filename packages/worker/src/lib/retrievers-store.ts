export interface RetrieverRow {
	name: string
	sql: string
	description: string | null
	param_schema: string
	created_at: number
	updated_at: number
}

export interface Retriever {
	name: string
	sql: string
	description: string | null
	param_schema: Record<string, string>
	created_at: number
	updated_at: number
}

function rowTo(r: RetrieverRow): Retriever {
	return { ...r, param_schema: JSON.parse(r.param_schema) }
}

export async function getRetriever(name: string, env: Env): Promise<Retriever | null> {
	const row = (await env.FERMI_DB.prepare('SELECT * FROM retrievers WHERE name = ?1')
		.bind(name)
		.first()) as RetrieverRow | null
	return row ? rowTo(row) : null
}

export async function listRetrievers(env: Env): Promise<Retriever[]> {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT * FROM retrievers ORDER BY name',
	).all<RetrieverRow>()
	return results.map(rowTo)
}

export interface PutRetrieverInput {
	name: string
	sql: string
	description?: string
	param_schema?: Record<string, string>
}

export async function putRetriever(input: PutRetrieverInput, env: Env): Promise<Retriever> {
	const now = Date.now()
	await env.FERMI_DB.prepare(
		`INSERT INTO retrievers (name, sql, description, param_schema, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
		 ON CONFLICT(name) DO UPDATE SET
		   sql = excluded.sql,
		   description = excluded.description,
		   param_schema = excluded.param_schema,
		   updated_at = excluded.updated_at`,
	)
		.bind(
			input.name,
			input.sql,
			input.description ?? null,
			JSON.stringify(input.param_schema ?? {}),
			now,
		)
		.run()
	return {
		name: input.name,
		sql: input.sql,
		description: input.description ?? null,
		param_schema: input.param_schema ?? {},
		created_at: now,
		updated_at: now,
	}
}

export async function deleteRetriever(name: string, env: Env): Promise<boolean> {
	const res = await env.FERMI_DB.prepare('DELETE FROM retrievers WHERE name = ?1').bind(name).run()
	return (res.meta.changes ?? 0) > 0
}

const PARAM_PATTERN = /:([a-zA-Z_][a-zA-Z0-9_]*)/g

export function bindParams(
	sql: string,
	params: Record<string, unknown>,
): { sql: string; values: unknown[] } {
	const values: unknown[] = []
	let positional = 1
	const replaced = sql.replace(PARAM_PATTERN, (_full, name: string) => {
		values.push(params[name] ?? null)
		return `?${positional++}`
	})
	return { sql: replaced, values }
}

export async function runRetriever(
	name: string,
	params: Record<string, unknown>,
	env: Env,
): Promise<{ rows: unknown[]; rows_count: number }> {
	const r = await getRetriever(name, env)
	if (!r) throw new Error(`retriever_not_found: ${name}`)
	const { sql, values } = bindParams(r.sql, params)
	const stmt = env.FERMI_DB.prepare(sql)
	const { results } = await (values.length > 0 ? stmt.bind(...values).all() : stmt.all())
	return { rows: results, rows_count: results.length }
}
