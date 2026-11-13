import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

// MCP-26: the local-dev auth bypass lives in exactly one committed config, the never-deployed
// local eval target. Raw text, so a comment or a nested env block counts too.
const ROOT = new URL('../', import.meta.url)
const BYPASS = 'FERMI_LOCAL_DEV'
const ALLOWED = 'packages/worker/wrangler.eval.jsonc'
const TEMPLATE = 'packages/worker/wrangler.template.jsonc'
// Every file wrangler reads config or vars from, in any directory.
const CONFIG = /(^|\/)(wrangler(\.[^/]+)?\.(jsonc?|toml)|\.dev\.vars(\..*)?)$/

// Tracked files (so force-added gitignored ones count) plus new files not yet ignored.
const repoFiles = execFileSync(
	'git',
	['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
	{ cwd: ROOT, encoding: 'utf8' },
)
	.split('\0')
	.filter((f) => f && existsSync(new URL(f, ROOT)))
const readRepo = (f) => readFileSync(new URL(f, ROOT), 'utf8')

/** Returns the config files that break the bypass rule. */
function violations(files, read) {
	const configs = files.filter((f) => CONFIG.test(f))
	const bad = configs.filter((f) => f !== ALLOWED && read(f).includes(BYPASS))
	if (!configs.includes(ALLOWED)) bad.push(`${ALLOWED} (missing)`)
	else {
		const text = read(ALLOWED)
		if (!/"FERMI_LOCAL_DEV":\s*"true"/.test(text) || /FERMI_AUTH_ENABLED/.test(text))
			bad.push(`${ALLOWED} (must set ${BYPASS}="true" and no FERMI_AUTH_ENABLED)`)
	}
	return bad
}

describe('committed wrangler configs', () => {
	it('include the eval target and the template', () => {
		assert.ok(repoFiles.includes(ALLOWED))
		assert.ok(repoFiles.includes(TEMPLATE))
	})

	it(`contain ${BYPASS} only in ${ALLOWED}`, () => {
		assert.deepEqual(violations(repoFiles, readRepo), [])
	})
})

describe('bypass guard', () => {
	const evalOk = '{ "vars": { "FERMI_LOCAL_DEV": "true" } }'
	const withVar = '{"vars":{"FERMI_LOCAL_DEV":"true"}}'
	const check = (extra) => {
		const files = { [ALLOWED]: evalOk, [TEMPLATE]: '{}', ...extra }
		return violations(Object.keys(files), (f) => files[f])
	}

	it('passes the clean layout', () => {
		assert.deepEqual(check({}), [])
	})

	for (const f of [
		TEMPLATE,
		'packages/worker/wrangler.jsonc',
		'packages/worker/wrangler.json',
		'packages/worker/wrangler.toml',
		'packages/worker/wrangler.phone-sim.jsonc',
		'packages/worker/.dev.vars',
		'packages/worker/.dev.vars.staging',
		'packages/other/wrangler.jsonc',
		'wrangler.jsonc',
		'wrangler.toml',
	]) {
		it(`flags ${BYPASS} in ${f}`, () => {
			assert.deepEqual(check({ [f]: withVar }), [f])
		})
	}

	it('flags the eval config without the bypass or with FERMI_AUTH_ENABLED', () => {
		assert.equal(check({ [ALLOWED]: '{}' }).length, 1)
		assert.equal(
			check({ [ALLOWED]: '{"vars":{"FERMI_LOCAL_DEV": "true","FERMI_AUTH_ENABLED":"false"}}' })
				.length,
			1,
		)
	})

	it('flags a missing eval config', () => {
		assert.deepEqual(
			violations([TEMPLATE], () => '{}'),
			[`${ALLOWED} (missing)`],
		)
	})

	it('ignores FERMI_AUTH_ENABLED outside the eval config', () => {
		assert.deepEqual(check({ [TEMPLATE]: '{"vars":{"FERMI_AUTH_ENABLED":"true"}}' }), [])
	})
})
