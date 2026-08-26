export interface PackageRow {
	slug: string
	source: string
	version: string
	description: string | null
	allowed_imports: string
	created_at: number
	updated_at: number
}

export interface PackageMetadata {
	slug: string
	version: string
	description: string | null
	allowed_imports: string[]
	created_at: number
	updated_at: number
	source_size: number
}

function rowToMetadata(row: PackageRow): PackageMetadata {
	return {
		slug: row.slug,
		version: row.version,
		description: row.description,
		allowed_imports: JSON.parse(row.allowed_imports),
		created_at: row.created_at,
		updated_at: row.updated_at,
		source_size: row.source.length,
	}
}

export async function getPackage(slug: string, env: Env): Promise<PackageRow | null> {
	return (await env.FERMI_DB.prepare('SELECT * FROM packages WHERE slug = ?1')
		.bind(slug)
		.first()) as PackageRow | null
}

export async function listPackages(env: Env): Promise<PackageMetadata[]> {
	const { results } = await env.FERMI_DB.prepare(
		'SELECT * FROM packages ORDER BY slug',
	).all<PackageRow>()
	return results.map(rowToMetadata)
}

export interface PutPackageInput {
	slug: string
	source: string
	version?: string
	description?: string
	allowed_imports?: string[]
}

export async function putPackage(input: PutPackageInput, env: Env): Promise<PackageMetadata> {
	const now = Date.now()
	await env.FERMI_DB.prepare(
		`INSERT INTO packages (slug, source, version, description, allowed_imports, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
		 ON CONFLICT(slug) DO UPDATE SET
		   source = excluded.source,
		   version = excluded.version,
		   description = excluded.description,
		   allowed_imports = excluded.allowed_imports,
		   updated_at = excluded.updated_at`,
	)
		.bind(
			input.slug,
			input.source,
			input.version ?? '0.0.0',
			input.description ?? null,
			JSON.stringify(input.allowed_imports ?? []),
			now,
		)
		.run()
	return {
		slug: input.slug,
		version: input.version ?? '0.0.0',
		description: input.description ?? null,
		allowed_imports: input.allowed_imports ?? [],
		created_at: now,
		updated_at: now,
		source_size: input.source.length,
	}
}

export async function deletePackage(slug: string, env: Env): Promise<boolean> {
	const res = await env.FERMI_DB.prepare('DELETE FROM packages WHERE slug = ?1').bind(slug).run()
	return (res.meta.changes ?? 0) > 0
}

export async function loadAllPackagesAsModules(env: Env): Promise<Record<string, string>> {
	const { results } = await env.FERMI_DB.prepare('SELECT slug, source FROM packages').all<{
		slug: string
		source: string
	}>()
	const out: Record<string, string> = {}
	for (const r of results) out[r.slug] = r.source
	return out
}
