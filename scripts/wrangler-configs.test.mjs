import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'

// MCP-26: the local-dev auth bypass lives in exactly one committed config, the never-deployed
// local eval target. Raw text, so a comment or a nested env block counts too.
const DIR = new URL('../packages/worker/', import.meta.url)
const BYPASS = 'FERMI_LOCAL_DEV'
const ALLOWED = 'wrangler.eval.jsonc'
// wrangler.jsonc is rendered from the template and gitignored, so it is not a committed config.
const configs = readdirSync(DIR).filter(
	(f) => /^wrangler.*\.jsonc$/.test(f) && f !== 'wrangler.jsonc',
)
const read = (f) => readFileSync(new URL(f, DIR), 'utf8')

describe('committed wrangler configs', () => {
	it('include the eval target and the template', () => {
		assert.ok(configs.includes(ALLOWED))
		assert.ok(configs.includes('wrangler.template.jsonc'))
	})

	it(`contain ${BYPASS} only in ${ALLOWED}`, () => {
		assert.deepEqual(
			configs.filter((f) => f !== ALLOWED && read(f).includes(BYPASS)),
			[],
		)
	})

	it(`never contain ${BYPASS} in wrangler.template.jsonc`, () => {
		assert.equal(read('wrangler.template.jsonc').includes(BYPASS), false)
	})

	it(`${ALLOWED} sets ${BYPASS} to "true" and drops FERMI_AUTH_ENABLED`, () => {
		const text = read(ALLOWED)
		assert.match(text, /"FERMI_LOCAL_DEV":\s*"true"/)
		assert.doesNotMatch(text, /"FERMI_AUTH_ENABLED"/)
	})
})
