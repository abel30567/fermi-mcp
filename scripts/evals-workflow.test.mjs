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

	it('skips drafts and fork PRs in plan, and the other jobs only follow a plan that found the token', () => {
		assert.match(
			job('plan'),
			/\n {4}if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository && !github\.event\.pull_request\.draft\n/,
		)
		for (const name of ['pending', 'run'])
			assert.match(job(name), /\n {4}needs: plan\n {4}if: needs\.plan\.outputs\.ok == 'true'\n/)
		assert.match(
			job('report'),
			/\n {4}needs: \[plan, run\]\n {4}if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.ok == 'true' \}\}\n/,
		)
		assert.match(
			job('publish'),
			/\n {4}needs: \[plan, pending, report\]\n {4}if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.ok == 'true' \}\}\n/,
		)
	})

	it('reads the token only in the evals environment, and only as an fd in the run step', () => {
		const uses = [...WF.matchAll(/\$\{\{[^}]*\bsecrets\.(\w+)(.*)/g)].map((m) => m[1] + m[2])
		assert.deepEqual(uses, ["CLAUDE_CODE_OAUTH_TOKEN != '' }}", 'CLAUDE_CODE_OAUTH_TOKEN }}'])
		assert.match(job('run'), /\n {4}environment: evals\n/)
		assert.match(job('run'), /EVAL_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}\n/)
		assert.match(job('run'), /exec 3< <\(printf '%s' "\$EVAL_TOKEN"\)\n\s+unset EVAL_TOKEN\n/)
		assert.match(
			job('run'),
			/CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 bash scripts\/evals-ci\.sh run /,
		)
		assert.match(WF, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'/)
		for (const name of ['pending', 'report', 'publish'])
			assert.doesNotMatch(job(name), /\$\{\{[^}]*\bsecrets\.|\n {4}environment:/)
		assert.doesNotMatch(job('run'), /pull-requests: write|statuses: write/)
	})

	// MCP-34: evals' branch policy allows only master, so a plan bound to it failed on every PR merge ref.
	it('binds only run to the evals environment, so plan cannot be rejected on a PR merge ref', () => {
		assert.deepEqual(
			[...WF.matchAll(/\n( *)environment:(.*)/g)].map((m) => [m[1].length, m[2]]),
			[[4, ' evals']],
		)
		assert.doesNotMatch(job('plan'), /\n {4}environment:/)
		assert.doesNotMatch(job('report'), /\n {4}environment:/)
		const jobs = WF.slice(WF.indexOf('\njobs:\n'))
		assert.deepEqual(
			[...jobs.matchAll(/\n {2}(\w+):\n/g)].map((m) => m[1]),
			['plan', 'pending', 'run', 'report', 'publish'],
		)
	})

	it('without a token visible to plan, plan only emits a notice and every other job skips', () => {
		const token = job('plan').match(/\n {6}- id: token\n[\s\S]*?(?=\n {6}- )/)?.[0]
		assert.ok(token)
		assert.match(token, /HAS_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN != '' \}\}/)
		assert.match(token, /\|\| echo "::notice::Evals skipped: /)
		assert.doesNotMatch(job('plan'), /exit 1|::error::/)
		for (const name of ['pending', 'run', 'report', 'publish'])
			assert.match(job(name), /needs\.plan\.outputs\.ok == 'true'/)
	})

	it('documents in the header what must change for evals to run again', () => {
		const header = WF.slice(0, WF.indexOf('\non:\n'))
		assert.match(header, /Only run is bound to the evals environment/)
		assert.match(header, /To make evals actually run again/)
		assert.match(header, /branch policy that permits PR merge refs/)
	})

	it('report tolerates a missing cell artifact', () => {
		assert.match(
			job('report'),
			/- continue-on-error: true\n\s+uses: actions\/download-artifact@\w+ # v[\d.]+\n\s+with:\n\s+name: evals-cell\n/,
		)
	})

	it('never runs on push (master is unaffected) and a .github/-only PR does not match its paths', () => {
		assert.doesNotMatch(WF.slice(WF.indexOf('\non:\n'), WF.indexOf('\nconcurrency:')), /\bpush:/)
		const globs = [...WF.matchAll(/\n {6}- '([^']+)'/g)].map((m) => m[1])
		assert.deepEqual(globs, ['packages/worker/src/**', 'packages/worker/seeds/**'])
		const matches = (file) => globs.some((g) => file.startsWith(g.replace(/\*\*$/, '')))
		for (const file of [
			'.github/workflows/evals.yml',
			'.github/workflows/ci.yml',
			'scripts/evals-workflow.test.mjs',
		])
			assert.equal(matches(file), false, file)
		for (const file of ['packages/worker/src/index.ts', 'packages/worker/seeds/a.sql'])
			assert.equal(matches(file), true, file)
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

	it('pending sets the pending status; report scans the comment; publish posts it and the final status', () => {
		assert.match(
			job('pending'),
			/run: gh api "repos\/\$GITHUB_REPOSITORY\/statuses\/\$HEAD_SHA" -f state=pending -f context=evals\/smoke /,
		)
		assert.match(
			job('report'),
			/node scripts\/scan-secrets\.mjs "\$RUNNER_TEMP\/evals\/comment\.md"/,
		)
		assert.match(job('report'), /\n {6}report: \$\{\{ steps\.report\.outcome \}\}\n/)
		assert.match(job('report'), /\n {6}outcome: \$\{\{ steps\.report\.outputs\.outcome \}\}\n/)
		assert.match(
			job('report'),
			/name: evals-comment\n\s+path: \$\{\{ runner\.temp \}\}\/evals\/comment\.md\n/,
		)
		assert.match(job('publish'), /name: evals-comment\n/)
		assert.match(
			job('publish'),
			/- if: needs\.report\.outputs\.report == 'success'\n\s+run: gh pr comment "\$PR" -R "\$GITHUB_REPOSITORY" --body-file /,
		)
		assert.match(
			job('publish'),
			/OUTCOME: \$\{\{ needs\.report\.outputs\.outcome \|\| 'failure' \}\}\n/,
		)
		assert.match(job('publish'), /-f context=evals\/smoke /)
	})

	// MCP-33: PR-controlled code never holds a write-scoped token.
	it('no job that checks out or runs code has a write scope; GH_TOKEN reaches only gh-only jobs', () => {
		const writes = (name) =>
			[
				...(job(name).match(/\n {4}permissions:\n((?: {6}.*\n)+)/)?.[1] ?? '').matchAll(
					/(\S+): write/g,
				),
			].map((m) => m[1])
		assert.deepEqual(WF.match(/\npermissions:\n((?: {2}.*\n)+)/)?.[1], '  contents: read\n')
		assert.deepEqual(writes('plan'), [])
		assert.deepEqual(writes('run'), [])
		assert.deepEqual(writes('report'), [])
		assert.match(job('report'), /\n {4}permissions:\n {6}contents: read\n {4}\S/)
		for (const name of ['plan', 'run', 'report'])
			assert.match(job(name), /\n {4}permissions:\n {6}contents: read\n {4}\S/, name)
		assert.deepEqual(writes('pending'), ['statuses'])
		assert.deepEqual(writes('publish'), ['pull-requests', 'statuses'])
		for (const name of ['pending', 'publish']) {
			assert.doesNotMatch(
				job(name),
				/actions\/checkout|\b(node|bash|sh|bun|bunx|npm|npx|scripts)\b/,
				name,
			)
			for (const [, cmd] of job(name).matchAll(/\n\s+(?:- )?run: (\S+)/g))
				assert.equal(cmd, 'gh', name)
		}
		for (const name of ['plan', 'run', 'report'])
			assert.doesNotMatch(job(name), /GH_TOKEN|github\.token|\bgh /, name)
	})

	it('keeps the one workflow-level concurrency group and adds none per job', () => {
		assert.deepEqual(
			[...WF.matchAll(/\n( *)concurrency:/g)].map((m) => m[1].length),
			[0],
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
			'${{ runner.temp }}/evals/comment.md',
			'${{ runner.temp }}/evals',
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
