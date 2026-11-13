#!/usr/bin/env node
// Post-deploy smoke for .github/workflows/deploy.yml. Reads the `wrangler deploy` output and
// FERMI_PUBLIC_URL, then checks that:
//   1. the FERMI_PUBLIC_URL host is one of the hosts wrangler just deployed to, so the OAuth start
//      and canvas links (built from FERMI_PUBLIC_URL) point at this deployment;
//   2. ${FERMI_PUBLIC_URL}/health reports the new version within 60 s;
//   3. /mcp without a token returns 401;
//   4. the OAuth authorization endpoint is on the same host.
// Never prints the URL or host.
//
//   FERMI_PUBLIC_URL=https://… node scripts/smoke-deploy.mjs <wrangler-deploy.log>
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Version id from `wrangler deploy` output ("Current Version ID: <uuid>"). */
export function deployedVersion(log) {
	return log.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1] ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function smoke({
	publicUrl,
	log,
	fetch = globalThis.fetch,
	timeoutMs = 60_000,
	intervalMs = 3_000,
}) {
	const version = deployedVersion(log)
	if (!version) throw new Error('no "Current Version ID" in the wrangler deploy output')
	const base = new URL(publicUrl)
	if (!log.includes(base.host)) {
		throw new Error('FERMI_PUBLIC_URL host is not a target of this deployment')
	}
	const get = (path) =>
		fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(10_000) })

	const deadline = Date.now() + timeoutMs
	let seen = null
	for (;;) {
		try {
			const res = await get('/health')
			if (res.ok) seen = (await res.json()).version ?? null
		} catch {}
		if (seen === version) break
		if (Date.now() + intervalMs > deadline) {
			throw new Error(`/health version ${seen} != ${version} after ${timeoutMs / 1000}s`)
		}
		await sleep(intervalMs)
	}

	const mcp = await get('/mcp')
	if (mcp.status !== 401) throw new Error(`/mcp without a token returned ${mcp.status}, want 401`)

	const meta = await get('/.well-known/oauth-authorization-server')
	const authorize = meta.ok ? (await meta.json()).authorization_endpoint : null
	if (!authorize || new URL(authorize, base).host !== base.host) {
		throw new Error('OAuth authorization endpoint is not on the FERMI_PUBLIC_URL host')
	}
	return version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const log = readFileSync(process.argv[2], 'utf8')
		const version = await smoke({ publicUrl: process.env.FERMI_PUBLIC_URL, log })
		console.log(`smoke-deploy: version ${version} live, /mcp 401, OAuth on the deployment host`)
	} catch (err) {
		console.error(`smoke-deploy: ${err.message}`)
		process.exit(1)
	}
}
