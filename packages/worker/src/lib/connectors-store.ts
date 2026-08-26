export interface ConnectorRow {
	name: string
	capability: string
	secret_name: string | null
	base_url: string
	description: string | null
	default_headers: string
	created_at: number
	updated_at: number
}

export interface Connector {
	name: string
	capability: string
	secret_name: string | null
	base_url: string
	description: string | null
	default_headers: Record<string, string>
	created_at: number
	updated_at: number
}

function rowTo(row: ConnectorRow): Connector {
	return {
		name: row.name,
		capability: row.capability,
		secret_name: row.secret_name,
		base_url: row.base_url,
		description: row.description,
		default_headers: JSON.parse(row.default_headers),
		created_at: row.created_at,
		updated_at: row.updated_at,
	}
}

export async function getConnector(name: string, env: Env): Promise<Connector | null> {
	const row = (await env.FERMI_DB.prepare('SELECT * FROM connectors WHERE name = ?1')
		.bind(name)
		.first()) as ConnectorRow | null
	return row ? rowTo(row) : null
}

export async function listConnectors(env: Env): Promise<Connector[]> {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT * FROM connectors ORDER BY name',
	).all<ConnectorRow>()
	return results.map(rowTo)
}

export interface PutConnectorInput {
	name: string
	capability: string
	secret_name?: string | null
	base_url: string
	description?: string
	default_headers?: Record<string, string>
}

export async function putConnector(input: PutConnectorInput, env: Env): Promise<Connector> {
	const now = Date.now()
	await env.FERMI_DB.prepare(
		`INSERT INTO connectors (name, capability, secret_name, base_url, description, default_headers, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
		 ON CONFLICT(name) DO UPDATE SET
		   capability = excluded.capability,
		   secret_name = excluded.secret_name,
		   base_url = excluded.base_url,
		   description = excluded.description,
		   default_headers = excluded.default_headers,
		   updated_at = excluded.updated_at`,
	)
		.bind(
			input.name,
			input.capability,
			input.secret_name ?? null,
			input.base_url,
			input.description ?? null,
			JSON.stringify(input.default_headers ?? {}),
			now,
		)
		.run()
	return {
		name: input.name,
		capability: input.capability,
		secret_name: input.secret_name ?? null,
		base_url: input.base_url,
		description: input.description ?? null,
		default_headers: input.default_headers ?? {},
		created_at: now,
		updated_at: now,
	}
}

export async function deleteConnector(name: string, env: Env): Promise<boolean> {
	const res = await env.FERMI_DB.prepare('DELETE FROM connectors WHERE name = ?1').bind(name).run()
	return (res.meta.changes ?? 0) > 0
}
