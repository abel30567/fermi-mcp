// MCP-33: every workflow pins its actions to commit SHAs; the docs workflow installs from a
// committed lockfile and keeps its write scopes in the deploy job.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, '.github/workflows')
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))
const read = (f) => readFileSync(join(DIR, f), 'utf8')
const DOCS = read('docs.yml')
const job = (wf, name) => {
	const start = wf.indexOf(`\n  ${name}:\n`)
	assert.ok(start >= 0, name)
	const end = wf.slice(start + 1).search(/\n {2}\S/)
	return end < 0 ? wf.slice(start) : wf.slice(start, start + 1 + end)
}

describe('workflows', () => {
	it('pin every action to a commit SHA with its version tag as a comment', () => {
		assert.ok(FILES.length >= 4)
		for (const f of FILES)
			for (const [line, ref] of read(f).matchAll(/\buses: (\S+).*/g)) {
				if (ref.startsWith('./')) continue
				assert.match(line, /^uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/, `${f}: ${line}`)
			}
	})

	it('pin the bun version (never latest)', () => {
		for (const f of FILES)
			for (const [, v] of read(f).matchAll(/\bbun-version: (\S+)/g))
				assert.match(v, /^\d+\.\d+\.\d+$/, `${f}: ${v}`)
	})
})

describe('docs workflow', () => {
	it('installs docs-site from its committed lockfile', () => {
		assert.match(
			job(DOCS, 'build'),
			/run: bun install --frozen-lockfile\n\s+working-directory: docs-site\n/,
		)
		assert.doesNotMatch(DOCS, /bun install(?! --frozen-lockfile)/)
		const tracked = execFileSync('git', ['ls-files', 'docs-site/bun.lock'], {
			cwd: ROOT,
			encoding: 'utf8',
		})
		assert.equal(tracked.trim(), 'docs-site/bun.lock')
	})

	it('grants pages and id-token write only to the deploy job; build is read-only', () => {
		assert.equal(DOCS.match(/\npermissions:\n((?: {2}.*\n)+)/)?.[1], '  contents: read\n')
		assert.match(
			job(DOCS, 'build'),
			/\n {4}permissions:\n {6}contents: read\n {6}pages: read\n {4}steps:/,
		)
		assert.match(job(DOCS, 'deploy'), /\n {4}permissions:\n {6}pages: write\n {6}id-token: write\n/)
		assert.deepEqual(
			[...DOCS.matchAll(/(\S+): write/g)].map((m) => m[1]),
			['pages', 'id-token'],
		)
		assert.doesNotMatch(job(DOCS, 'deploy'), /actions\/checkout|\brun:/)
		assert.match(job(DOCS, 'build'), /persist-credentials: false/)
	})

	it('keeps its concurrency group', () => {
		assert.match(DOCS, /\nconcurrency:\n {2}group: pages\n {2}cancel-in-progress: false\n/)
		assert.equal([...DOCS.matchAll(/concurrency:/g)].length, 1)
	})
})
