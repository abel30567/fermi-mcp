import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { render, requiredEnv } from './render-wrangler.mjs'

const SCRIPT = fileURLToPath(new URL('./render-wrangler.mjs', import.meta.url))
const TEMPLATE = readFileSync(
	new URL('../packages/worker/wrangler.template.jsonc', import.meta.url),
	'utf8',
)

// Fake values only; built at runtime so no id-shaped literal lives in the repo.
const FAKE = {
	CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
	WORKER_NAME: 'fermi-test',
	D1_DATABASE_NAME: 'fermi-test',
	D1_DATABASE_ID: `${'b'.repeat(8)}-0000-4000-8000-${'c'.repeat(12)}`,
	R2_BUCKET_NAME: 'fermi-test-storage',
	KV_FERMI_ID: 'd'.repeat(32),
	KV_OAUTH_ID: 'e'.repeat(32),
	VECTORIZE_INDEX_NAME: 'fermi-test-capabilities',
	FERMI_PUBLIC_URL: 'https://fermi.example.workers.dev',
}

const check = (env) =>
	spawnSync(process.execPath, [SCRIPT, '--check'], {
		env: { PATH: process.env.PATH, ...env },
		encoding: 'utf8',
	})

describe('render-wrangler', () => {
	it('needs exactly the documented variables', () => {
		assert.deepEqual(requiredEnv(TEMPLATE).sort(), Object.keys(FAKE).sort())
	})

	it('fills every placeholder and puts FERMI_PUBLIC_URL in vars', () => {
		const out = render(TEMPLATE, FAKE)
		assert.doesNotMatch(out, /__[A-Z0-9_]+__/)
		assert.match(out, /"FERMI_PUBLIC_URL": "https:\/\/fermi\.example\.workers\.dev"/)
		assert.match(out, new RegExp(`"database_id": "${FAKE.D1_DATABASE_ID}"`))
		assert.match(out, new RegExp(`"CF_ACCOUNT_ID": "${FAKE.CLOUDFLARE_ACCOUNT_ID}"`))
		assert.match(out, /"version_metadata": \{ "binding": "CF_VERSION_METADATA" \}/)
	})

	it('fails naming every missing or blank variable', () => {
		const { D1_DATABASE_ID, ...env } = { ...FAKE, KV_OAUTH_ID: '  ' }
		assert.throws(() => render(TEMPLATE, env), /missing values for: D1_DATABASE_ID, KV_OAUTH_ID$/)
	})

	it('rejects a FERMI_PUBLIC_URL that is not an https origin', () => {
		for (const bad of ['http://fermi.example.workers.dev', 'https://x.example/mcp', 'nope']) {
			assert.throws(() => render(TEMPLATE, { ...FAKE, FERMI_PUBLIC_URL: bad }), /https origin/)
		}
	})

	it('fails when a value would leave a placeholder behind', () => {
		assert.throws(
			() => render(TEMPLATE, { ...FAKE, WORKER_NAME: '__OOPS__' }),
			/unfilled placeholders: __OOPS__/,
		)
	})

	it('escapes values into valid JSON strings', () => {
		const out = render('{ "a": "__WORKER_NAME__" }', { WORKER_NAME: 'x"y\\z' })
		assert.equal(JSON.parse(out).a, 'x"y\\z')
	})

	it('--check exits 0 with fake values and never prints them', () => {
		const res = check(FAKE)
		assert.equal(res.status, 0, res.stderr)
		for (const value of Object.values(FAKE)) {
			assert.ok(!`${res.stdout}${res.stderr}`.includes(value), 'value leaked to output')
		}
	})

	it('--check exits 1 loudly when a placeholder is unfilled', () => {
		const { KV_FERMI_ID, ...env } = FAKE
		const res = check(env)
		assert.equal(res.status, 1)
		assert.match(res.stderr, /missing values for: KV_FERMI_ID/)
	})
})
