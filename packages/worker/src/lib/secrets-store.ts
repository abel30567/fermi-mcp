import { decryptSecret, encryptSecret } from './crypto.ts'

export type SecretScope = 'user' | 'app' | 'session'

export interface SecretMetadata {
	name: string
	scope: SecretScope
	session_id: string
	allowed_hosts: string[]
	allowed_capabilities: string[]
	allowed_packages: string[]
	key_version: number
	created_at: number
	updated_at: number
}

interface SecretRow {
	name: string
	scope: SecretScope
	session_id: string
	encrypted_value: ArrayBuffer
	iv: ArrayBuffer
	allowed_hosts: string
	allowed_capabilities: string
	allowed_packages: string
	key_version: number
	created_at: number
	updated_at: number
}

function rowToMetadata(row: SecretRow): SecretMetadata {
	return {
		name: row.name,
		scope: row.scope,
		session_id: row.session_id,
		allowed_hosts: JSON.parse(row.allowed_hosts),
		allowed_capabilities: JSON.parse(row.allowed_capabilities),
		allowed_packages: JSON.parse(row.allowed_packages),
		key_version: row.key_version,
		created_at: row.created_at,
		updated_at: row.updated_at,
	}
}

export async function getSecret(
	name: string,
	scope: SecretScope,
	sessionId: string,
	env: Env,
): Promise<{ value: string; metadata: SecretMetadata } | null> {
	const row = (await env.FERMI_DB.prepare(
		'SELECT * FROM secrets WHERE name = ?1 AND scope = ?2 AND session_id = ?3',
	)
		.bind(name, scope, scope === 'session' ? sessionId : '')
		.first()) as SecretRow | null
	if (!row) return null
	const value = await decryptSecret({ encrypted_value: row.encrypted_value, iv: row.iv }, env)
	return { value, metadata: rowToMetadata(row) }
}

export async function listSecrets(scope: SecretScope | null, env: Env): Promise<SecretMetadata[]> {
	const stmt = scope
		? env.FERMI_DB.prepare(
				'SELECT name, scope, session_id, "" AS encrypted_value, "" AS iv, allowed_hosts, allowed_capabilities, allowed_packages, key_version, created_at, updated_at FROM secrets WHERE scope = ?1 ORDER BY name',
			).bind(scope)
		: env.FERMI_DB.prepare(
				'SELECT name, scope, session_id, "" AS encrypted_value, "" AS iv, allowed_hosts, allowed_capabilities, allowed_packages, key_version, created_at, updated_at FROM secrets ORDER BY scope, name',
			)
	const { results } = await stmt.all<SecretRow>()
	return results.map(rowToMetadata)
}

export interface PutSecretInput {
	name: string
	value: string
	scope: SecretScope
	sessionId?: string
	allowedHosts?: string[]
	allowedCapabilities?: string[]
	allowedPackages?: string[]
}

export async function putSecret(input: PutSecretInput, env: Env): Promise<SecretMetadata> {
	const { encrypted, iv } = await encryptSecret(input.value, env)
	const now = Date.now()
	const sessionId = input.scope === 'session' ? (input.sessionId ?? '') : ''
	const allowedHosts = JSON.stringify(input.allowedHosts ?? [])
	const allowedCapabilities = JSON.stringify(input.allowedCapabilities ?? [])
	const allowedPackages = JSON.stringify(input.allowedPackages ?? [])

	await env.FERMI_DB.prepare(
		`INSERT INTO secrets (name, scope, session_id, encrypted_value, iv, allowed_hosts, allowed_capabilities, allowed_packages, key_version, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
		 ON CONFLICT(name, scope, session_id) DO UPDATE SET
		   encrypted_value = excluded.encrypted_value,
		   iv = excluded.iv,
		   allowed_hosts = excluded.allowed_hosts,
		   allowed_capabilities = excluded.allowed_capabilities,
		   allowed_packages = excluded.allowed_packages,
		   updated_at = excluded.updated_at`,
	)
		.bind(
			input.name,
			input.scope,
			sessionId,
			encrypted,
			iv,
			allowedHosts,
			allowedCapabilities,
			allowedPackages,
			now,
		)
		.run()

	return {
		name: input.name,
		scope: input.scope,
		session_id: sessionId,
		allowed_hosts: input.allowedHosts ?? [],
		allowed_capabilities: input.allowedCapabilities ?? [],
		allowed_packages: input.allowedPackages ?? [],
		key_version: 1,
		created_at: now,
		updated_at: now,
	}
}

export async function deleteSecret(
	name: string,
	scope: SecretScope,
	sessionId: string,
	env: Env,
): Promise<boolean> {
	const res = await env.FERMI_DB.prepare(
		'DELETE FROM secrets WHERE name = ?1 AND scope = ?2 AND session_id = ?3',
	)
		.bind(name, scope, scope === 'session' ? sessionId : '')
		.run()
	return res.meta.changes > 0
}

export async function addAllowedHost(
	name: string,
	scope: SecretScope,
	sessionId: string,
	host: string,
	env: Env,
): Promise<SecretMetadata | null> {
	const row = (await env.FERMI_DB.prepare(
		'SELECT * FROM secrets WHERE name = ?1 AND scope = ?2 AND session_id = ?3',
	)
		.bind(name, scope, scope === 'session' ? sessionId : '')
		.first()) as SecretRow | null
	if (!row) return null
	const hosts: string[] = JSON.parse(row.allowed_hosts)
	if (hosts.includes(host)) return rowToMetadata(row)
	hosts.push(host)
	const now = Date.now()
	await env.FERMI_DB.prepare(
		'UPDATE secrets SET allowed_hosts = ?1, updated_at = ?2 WHERE name = ?3 AND scope = ?4 AND session_id = ?5',
	)
		.bind(JSON.stringify(hosts), now, name, scope, row.session_id)
		.run()
	return { ...rowToMetadata(row), allowed_hosts: hosts, updated_at: now }
}
