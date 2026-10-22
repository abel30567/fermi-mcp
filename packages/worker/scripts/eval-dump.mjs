#!/usr/bin/env node
// Dump a local eval worker's D1 state as JSON (stdout): profile, memories,
// allowlist, tasks, outbox, schedules, skill metadata and audit, via
// `wrangler d1 execute --local`. D1 only: phone calls live in each PhoneCallDO,
// so evals assert on them from the fake Twilio log instead.
//
//   node scripts/eval-dump.mjs [--persist-to DIR] > dump.json

import { execFileSync } from 'node:child_process'
import { DUMP_QUERIES, shapeDump } from './eval-db.mjs'

const args = process.argv.slice(2)
const persistAt = args.indexOf('--persist-to')
const persist = persistAt >= 0 ? ['--persist-to', args[persistAt + 1]] : []

const out = execFileSync(
	'npx',
	[
		'wrangler',
		'd1',
		'execute',
		'FERMI_DB',
		'--local',
		'--config',
		'wrangler.eval.jsonc',
		...persist,
		'--json',
		'--command',
		Object.values(DUMP_QUERIES).join('; '),
	],
	{ cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)
const results = JSON.parse(out)
console.log(JSON.stringify(shapeDump(results.map((r) => r.results)), null, 2))
