export interface OauthClientRow {
	name: string
	client_id: string
	client_secret_name: string
	auth_url: string
	token_url: string
	scopes: string
	redirect_path: string
	result_secret_name: string
	result_allowed_hosts: string
	created_at: number
	updated_at: number
}

export interface OauthClient {
	name: string
	client_id: string
	client_secret_name: string
	auth_url: string
	token_url: string
	scopes: string[]
	redirect_path: string
	result_secret_name: string
	result_allowed_hosts: string[]
	created_at: number
	updated_at: number
}

function rowTo(r: OauthClientRow): OauthClient {
	return {
		...r,
		scopes: JSON.parse(r.scopes),
		result_allowed_hosts: JSON.parse(r.result_allowed_hosts),
	}
}

export async function getOauthClient(name: string, env: Env): Promise<OauthClient | null> {
	const row = (await env.FERMI_DB.prepare('SELECT * FROM oauth_clients WHERE name = ?1')
		.bind(name)
		.first()) as OauthClientRow | null
	return row ? rowTo(row) : null
}

export async function listOauthClients(env: Env): Promise<OauthClient[]> {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT * FROM oauth_clients ORDER BY name',
	).all<OauthClientRow>()
	return results.map(rowTo)
}

export interface PutOauthClientInput {
	name: string
	client_id: string
	client_secret_name: string
	auth_url: string
	token_url: string
	scopes?: string[]
	redirect_path?: string
	result_secret_name: string
	result_allowed_hosts?: string[]
}

export async function putOauthClient(input: PutOauthClientInput, env: Env): Promise<OauthClient> {
	const now = Date.now()
	await env.FERMI_DB.prepare(
		`INSERT INTO oauth_clients (name, client_id, client_secret_name, auth_url, token_url, scopes, redirect_path, result_secret_name, result_allowed_hosts, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
		 ON CONFLICT(name) DO UPDATE SET
		   client_id = excluded.client_id,
		   client_secret_name = excluded.client_secret_name,
		   auth_url = excluded.auth_url,
		   token_url = excluded.token_url,
		   scopes = excluded.scopes,
		   redirect_path = excluded.redirect_path,
		   result_secret_name = excluded.result_secret_name,
		   result_allowed_hosts = excluded.result_allowed_hosts,
		   updated_at = excluded.updated_at`,
	)
		.bind(
			input.name,
			input.client_id,
			input.client_secret_name,
			input.auth_url,
			input.token_url,
			JSON.stringify(input.scopes ?? []),
			input.redirect_path ?? '/oauth/callback',
			input.result_secret_name,
			JSON.stringify(input.result_allowed_hosts ?? []),
			now,
		)
		.run()
	return {
		name: input.name,
		client_id: input.client_id,
		client_secret_name: input.client_secret_name,
		auth_url: input.auth_url,
		token_url: input.token_url,
		scopes: input.scopes ?? [],
		redirect_path: input.redirect_path ?? '/oauth/callback',
		result_secret_name: input.result_secret_name,
		result_allowed_hosts: input.result_allowed_hosts ?? [],
		created_at: now,
		updated_at: now,
	}
}

export async function deleteOauthClient(name: string, env: Env): Promise<boolean> {
	const res = await env.FERMI_DB.prepare('DELETE FROM oauth_clients WHERE name = ?1')
		.bind(name)
		.run()
	return (res.meta.changes ?? 0) > 0
}
