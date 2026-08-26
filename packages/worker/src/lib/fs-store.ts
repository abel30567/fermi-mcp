export interface FsReadResult {
	path: string
	size: number
	body: string
}

export async function readFile(path: string, env: Env): Promise<FsReadResult | null> {
	const obj = await env.FERMI_BUCKET.get(path)
	if (!obj) return null
	const body = await obj.text()
	return { path, size: obj.size, body }
}

export interface FsWriteCheck {
	allowed: boolean
	allowedPrefixes: string[]
}

export async function checkWriteAllowed(path: string, env: Env): Promise<FsWriteCheck> {
	const scopeJson = await env.FERMI_KV.get('permission:fs.write:scope')
	const allowedPrefixes: string[] = scopeJson ? JSON.parse(scopeJson) : []
	if (allowedPrefixes.length === 0) return { allowed: true, allowedPrefixes }
	return {
		allowed: allowedPrefixes.some((p) => path.startsWith(p)),
		allowedPrefixes,
	}
}

export async function writeFile(
	path: string,
	body: string,
	env: Env,
): Promise<{ path: string; size: number; written: true }> {
	await env.FERMI_BUCKET.put(path, body)
	return { path, size: new TextEncoder().encode(body).length, written: true }
}

export interface FsListEntry {
	key: string
	size: number
	uploaded: string
}

export async function listFiles(
	prefix: string,
	env: Env,
): Promise<{ prefix: string; objects: FsListEntry[]; truncated: boolean }> {
	const list = await env.FERMI_BUCKET.list({ prefix })
	const objects = list.objects.map((o) => ({
		key: o.key,
		size: o.size,
		uploaded: o.uploaded.toISOString(),
	}))
	return { prefix, objects, truncated: list.truncated }
}
