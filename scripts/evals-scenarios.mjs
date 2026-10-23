#!/usr/bin/env node
// Per-scenario pass table for the evals PR comment (.github/workflows/evals.yml). Reads only the
// summary.json files fermi-daemon's scripts/evals-ci.sh leaves (already secret-scanned), never
// results.json or transcripts, and prints markdown.
//
//   node scripts/evals-scenarios.mjs <summary.json>...
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Markdown table: one row per scenario of one fermi-daemon evals summary.json. */
export function scenarioTable(summary) {
	const rows = Object.entries(summary.byScenario ?? {}).map(
		([name, s]) =>
			`| ${name} | ${s.passes}/${s.attempts} | ${s.invalid} | ${s.setupErrors} | ${s.expectedOutcome} |`,
	)
	return [
		`### Scenarios: ${summary.harness} ${summary.model ?? 'default'}`,
		'',
		'| scenario | passed | invalid | setup errors | expected |',
		'|---|---|---|---|---|',
		...rows,
		'',
	].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	for (const file of process.argv.slice(2)) {
		process.stdout.write(`\n${scenarioTable(JSON.parse(readFileSync(file, 'utf8')))}`)
	}
}
