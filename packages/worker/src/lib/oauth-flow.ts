import { type OauthClient, getOauthClient } from './oauth-store.ts'
import { getSecret, putSecret } from './secrets-store.ts'

const STATE_TTL_SECONDS = 600
const STATE_KEY_PREFIX = 'oauth:state:'

interface StateRecord {
	client: string
	created_at: number
}

export async function buildAuthUrl(
	client: OauthClient,
	baseUrl: string,
	env: Env,
): Promise<string> {
	const state = crypto.randomUUID()
	await env.FERMI_KV.put(
		`${STATE_KEY_PREFIX}${state}`,
		JSON.stringify({ client: client.name, created_at: Date.now() } satisfies StateRecord),
		{ expirationTtl: STATE_TTL_SECONDS },
	)
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: `${baseUrl}${client.redirect_path}`,
		state,
	})
	if (client.scopes.length > 0) params.set('scope', client.scopes.join(' '))
	return `${client.auth_url}?${params.toString()}`
}

export async function startFlow(
	clientName: string,
	baseUrl: string,
	env: Env,
): Promise<{ url: string; state_ttl_seconds: number }> {
	const client = await getOauthClient(clientName, env)
	if (!client) throw new Error(`oauth_client_not_found: ${clientName}`)
	const url = await buildAuthUrl(client, baseUrl, env)
	return { url, state_ttl_seconds: STATE_TTL_SECONDS }
}

export interface CallbackResult {
	client: string
	stored_secret: string
	scopes: string[]
}

export async function handleCallback(url: URL, env: Env, baseUrl: string): Promise<CallbackResult> {
	const code = url.searchParams.get('code')
	const state = url.searchParams.get('state')
	if (!code || !state) throw new Error('missing_code_or_state')
	const stateJson = await env.FERMI_KV.get(`${STATE_KEY_PREFIX}${state}`)
	if (!stateJson) throw new Error('invalid_or_expired_state')
	await env.FERMI_KV.delete(`${STATE_KEY_PREFIX}${state}`)
	const stateRec = JSON.parse(stateJson) as StateRecord

	const client = await getOauthClient(stateRec.client, env)
	if (!client) throw new Error(`oauth_client_not_found: ${stateRec.client}`)

	const clientSecret = await getSecret(client.client_secret_name, 'app', '', env)
	if (!clientSecret) throw new Error(`oauth_client_secret_not_found: ${client.client_secret_name}`)

	const tokenRes = await fetch(client.token_url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			client_secret: clientSecret.value,
			redirect_uri: `${baseUrl}${client.redirect_path}`,
		}),
	})
	if (!tokenRes.ok) {
		const text = await tokenRes.text()
		throw new Error(`token_exchange_failed: ${tokenRes.status} ${text.slice(0, 200)}`)
	}
	const tokenJson = (await tokenRes.json()) as {
		access_token?: string
		token_type?: string
		scope?: string
		refresh_token?: string
	}
	if (!tokenJson.access_token) throw new Error('no_access_token_in_response')

	await putSecret(
		{
			name: client.result_secret_name,
			value: tokenJson.access_token,
			scope: 'app',
			allowedHosts: client.result_allowed_hosts,
		},
		env,
	)

	return {
		client: client.name,
		stored_secret: client.result_secret_name,
		scopes: tokenJson.scope ? tokenJson.scope.split(' ') : client.scopes,
	}
}
