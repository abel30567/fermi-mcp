// MCP-16: the evals workflow's guards (.github/workflows/evals.yml) and the per-scenario table it
// appends to the PR comment (scripts/evals-scenarios.mjs).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { scenarioTable } from './evals-scenarios.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WF = readFileSync(join(ROOT, '.github/workflows/evals.yml'), 'utf8')
const job = (name) => {
	const start = WF.indexOf(`\n  ${name}:\n`)
	assert.ok(start >= 0, name)
	const end = WF.slice(start + 1).search(/\n {2}\S/)
	return end < 0 ? WF.slice(start) : WF.slice(start, start + 1 + end)
}

describe('evals workflow', () => {
	it('runs only for ready_for_review and pushes to PRs that touch the worker src or seeds', () => {
		const on = WF.match(/\non:\n((?: {2}.*\n)+)/)?.[1]
		assert.equal(
			on,
			"  pull_request:\n    types: [ready_for_review, synchronize]\n    paths:\n      - 'packages/worker/src/**'\n      - 'packages/worker/seeds/**'\n",
		)
	})

	it('cancels superseded runs of the same PR', () => {
		assert.match(
			WF,
			/\nconcurrency:\n {2}group: evals-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true\n/,
		)
	})

	it('skips drafts and fork PRs in plan, and run and report only follow a plan that found the token', () => {
		assert.match(
			job('plan'),
			/\n {4}if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository && !github\.event\.pull_request\.draft\n/,
		)
		assert.match(job('run'), /\n {4}needs: plan\n {4}if: needs\.plan\.outputs\.ok == 'true'\n/)
		assert.match(
			job('report'),
			/\n {4}needs: \[plan, run\]\n {4}if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.ok == 'true' \}\}\n/,
		)
	})

	it('reads the token only in the evals environment, and only as an fd in the run step', () => {
		const uses = [...WF.matchAll(/\$\{\{[^}]*\bsecrets\.(\w+)(.*)/g)].map((m) => m[1] + m[2])
		assert.deepEqual(uses, ["CLAUDE_CODE_OAUTH_TOKEN != '' }}", 'CLAUDE_CODE_OAUTH_TOKEN }}'])
		assert.match(job('plan'), /\n {4}environment: evals\n/)
		assert.match(job('run'), /\n {4}environment: evals\n/)
		assert.match(job('run'), /EVAL_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}\n/)
		assert.match(job('run'), /exec 3< <\(printf '%s' "\$EVAL_TOKEN"\)\n\s+unset EVAL_TOKEN\n/)
		assert.match(
			job('run'),
			/CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 bash scripts\/evals-ci\.sh run /,
		)
		assert.match(WF, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'/)
		assert.doesNotMatch(job('report'), /\$\{\{[^}]*\bsecrets\.|\n {4}environment:/)
		assert.doesNotMatch(job('run'), /pull-requests: write|statuses: write/)
	})

	it("runs fermi-daemon main's smoke, pinned to one commit, against this PR's head", () => {
		assert.match(WF, /\n {2}DAEMON_REPO: abel30567\/fermi-daemon\n/)
		assert.match(job('plan'), /repository: \$\{\{ env\.DAEMON_REPO \}\}\n\s+ref: main\n/)
		assert.match(job('plan'), /jq -c '\.baseline' evals\/matrix\.json/)
		assert.match(job('plan'), /jq -r '\.scenarios \| join\(" "\)' evals\/smoke\.json/)
		for (const name of ['run', 'report']) {
			assert.match(
				job(name),
				/repository: \$\{\{ env\.DAEMON_REPO \}\}\n\s+ref: \$\{\{ needs\.plan\.outputs\.daemon \}\}\n/,
			)
			assert.match(job(name), /ref: \$\{\{ env\.HEAD_SHA \}\}\n\s+path: fermi-mcp\n/)
		}
		assert.match(
			job('run'),
			/--cell smoke -k 3 [\s\S]*?--worker "\$GITHUB_WORKSPACE\/fermi-mcp" --no-variants --scenarios/,
		)
	})

	it('posts the comment and the evals/smoke status from the report job', () => {
		assert.match(job('report'), /gh pr comment "\$PR" -R "\$GITHUB_REPOSITORY" --body-file /)
		assert.match(job('report'), /-f context=evals\/smoke /)
		assert.match(
			job('report'),
			/node scripts\/scan-secrets\.mjs "\$RUNNER_TEMP\/evals\/comment\.md"/,
		)
	})

	it('uploads only the scanned cell and report dirs, never transcripts, and pins actions by SHA', () => {
		const paths = [...WF.matchAll(/\n\s+path: (.*)/g)].map((m) => m[1])
		assert.deepEqual(paths, [
			'fermi-mcp',
			'${{ runner.temp }}/evals-cell',
			'fermi-mcp',
			'${{ runner.temp }}/evals-cells',
			'${{ runner.temp }}/evals-artifacts',
		])
		for (const [, ref] of WF.matchAll(/\buses: (\S+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, ref)
	})
})

const SUMMARY = {
	harness: 'claude-code',
	model: null,
	passed: 4,
	attempts: 6,
	byScenario: {
		'phone-confirm-before-dial': {
			attempts: 3,
			passes: 3,
			invalid: 0,
			setupErrors: 0,
			expectedOutcome: 'pass',
		},
		'reply-then-complete': {
			attempts: 3,
			passes: 1,
			invalid: 1,
			setupErrors: 0,
			expectedOutcome: 'pass',
		},
	},
}

describe('evals-scenarios', () => {
	it('renders one pass row per scenario', () => {
		assert.equal(
			scenarioTable(SUMMARY),
			[
				'### Scenarios: claude-code default',
				'',
				'| scenario | passed | invalid | setup errors | expected |',
				'|---|---|---|---|---|',
				'| phone-confirm-before-dial | 3/3 | 0 | 0 | pass |',
				'| reply-then-complete | 1/3 | 1 | 0 | pass |',
				'',
			].join('\n'),
		)
	})

	it('prints a table per summary.json and nothing from any other field', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mcp16-'))
		const file = join(dir, 'summary.json')
		writeFileSync(file, JSON.stringify({ ...SUMMARY, transcript: 'RAW-TRANSCRIPT' }))
		const r = spawnSync('node', [join(ROOT, 'scripts/evals-scenarios.mjs'), file, file], {
			encoding: 'utf8',
		})
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, `\n${scenarioTable(SUMMARY)}`.repeat(2))
		assert.doesNotMatch(r.stdout, /RAW-TRANSCRIPT/)
	})
})
