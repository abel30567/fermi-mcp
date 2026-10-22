#!/usr/bin/env node
// Seed a local eval worker (wrangler.eval.jsonc) from a fixture JSON: profile,
// memories, allowlist, pending tasks and skills. Applies D1 migrations, replaces
// those tables with the fixture's rows via `wrangler d1 execute --local`, then
// writes each skill through the running worker's `skill_set` tool on /mcp.
//
//   node scripts/eval-seed.mjs test/fixtures/eval/sample.json [--persist-to DIR] \
//     [--url http://127.0.0.1:8787]
//
// Pass the same --persist-to and port as the running `wrangler dev`. See
// "Running the eval target" in the README.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedSkills, seedStatements } from './eval-db.mjs'

const args = process.argv.slice(2)
const persistAt = args.indexOf('--persist-to')
const persist = persistAt >= 0 ? ['--persist-to', args.splice(persistAt, 2)[1]] : []
const urlAt = args.indexOf('--url')
const url = urlAt >= 0 ? args.splice(urlAt, 2)[1] : 'http://127.0.0.1:8787'
const [fixturePath] = args
if (!fixturePath) {
	console.error('usage: eval-seed.mjs <fixture.json> [--persist-to DIR] [--url WORKER_URL]')
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
if (fixture.skills) {
	await seedSkills(fixture.skills, new URL('/mcp', url).href)
	console.log(`seeded ${fixture.skills.length} skill(s) via skill_set`)
}
