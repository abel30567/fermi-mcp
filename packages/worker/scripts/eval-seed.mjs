#!/usr/bin/env node
// Seed a local eval worker (wrangler.eval.jsonc) from a fixture JSON: profile,
// memories, allowlist and pending tasks. Applies D1 migrations, then replaces
// those tables with the fixture's rows via `wrangler d1 execute --local`.
//
//   node scripts/eval-seed.mjs test/fixtures/eval/sample.json [--persist-to DIR]
//
// Pass the same --persist-to as the running `wrangler dev`. See "Running the
// eval target" in the README.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStatements } from './eval-db.mjs'

const args = process.argv.slice(2)
const persistAt = args.indexOf('--persist-to')
const persist = persistAt >= 0 ? ['--persist-to', args.splice(persistAt, 2)[1]] : []
const [fixturePath] = args
if (!fixturePath) {
	console.error('usage: eval-seed.mjs <fixture.json> [--persist-to DIR]')
	process.exit(2)
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const file = join(mkdtempSync(join(tmpdir(), 'fermi-eval-seed-')), 'seed.sql')
writeFileSync(file, `${seedStatements(fixture).join(';\n')};\n`)

const wrangler = (...rest) =>
	execFileSync(
		'npx',
		[
			'wrangler',
			'd1',
			...rest,
			'FERMI_DB',
			'--local',
			'--config',
			'wrangler.eval.jsonc',
			...persist,
		],
		{ cwd: new URL('..', import.meta.url), stdio: ['ignore', 'inherit', 'inherit'] },
	)
wrangler('migrations', 'apply')
wrangler('execute', '--file', file)
