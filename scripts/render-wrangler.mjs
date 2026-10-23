#!/usr/bin/env node
// Renders packages/worker/wrangler.jsonc from wrangler.template.jsonc using environment variables
// only, so account-specific ids never live in the repo. Every __NAME__ placeholder is filled from
// the env var NAME (__CF_ACCOUNT_ID__ from CLOUDFLARE_ACCOUNT_ID). Prints names, never values.
//
//   node scripts/render-wrangler.mjs           write packages/worker/wrangler.jsonc
//   node scripts/render-wrangler.mjs --check   validate only, write nothing
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(
	new URL('../packages/worker/wrangler.template.jsonc', import.meta.url),
)
const OUTPUT = fileURLToPath(new URL('../packages/worker/wrangler.jsonc', import.meta.url))
const ENV_NAME = { CF_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID' }
const PLACEHOLDER = /__([A-Z0-9_]+)__/g

const envName = (placeholder) => ENV_NAME[placeholder] ?? placeholder

/** Env var names the template needs, in first-use order. */
export function requiredEnv(template) {
	return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => envName(m[1])))]
}

/** Fills every placeholder; throws (naming the variables, not their values) if any is unfilled. */
export function render(template, env) {
	const missing = requiredEnv(template).filter((name) => !env[name]?.trim())
	if (missing.length > 0) throw new Error(`missing values for: ${missing.join(', ')}`)

	if (requiredEnv(template).includes('FERMI_PUBLIC_URL')) {
		let url
		try {
			url = new URL(env.FERMI_PUBLIC_URL.trim())
		} catch {}
		if (url?.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
			throw new Error('FERMI_PUBLIC_URL must be an https origin (https://host, no path)')
		}
	}

	const out = template.replace(PLACEHOLDER, (_, name) =>
		JSON.stringify(env[envName(name)].trim()).slice(1, -1),
	)
	const left = [...new Set(out.match(PLACEHOLDER))]
	if (left.length > 0) throw new Error(`unfilled placeholders: ${left.join(', ')}`)
	return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const check = process.argv.includes('--check')
	try {
		const template = readFileSync(TEMPLATE, 'utf8')
		const out = render(template, process.env)
		if (!check) writeFileSync(OUTPUT, out)
		const count = requiredEnv(template).length
		console.log(`render-wrangler: ${count} values ok${check ? ' (--check, nothing written)' : ''}`)
	} catch (err) {
		console.error(`render-wrangler: ${err.message}`)
		process.exit(1)
	}
}
