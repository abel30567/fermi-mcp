import { describe, expect, it } from 'vitest'
import { registeredTools } from './registry.ts'
import uncovered from './uncovered.json'

// Coverage gate: every registered tool needs a describeTool('<name>', ...) block
// somewhere in test/contract, or an entry in uncovered.json. Coverage is read from
// the test sources themselves, so parallel PRs never edit a shared manifest.

// Equals the number of entries in uncovered.json. It may only go down: a PR that
// covers tools removes them from uncovered.json and lowers this to the new count.
const UNCOVERED_CEILING = 103

const SOURCES = import.meta.glob<string>(['./**/*.ts', '!./tool-coverage.test.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
})

function describedTools(sources: Record<string, string>): Set<string> {
	const names = new Set<string>()
	for (const source of Object.values(sources)) {
		for (const m of source.matchAll(/\bdescribeTool\(\s*(['"`])([^'"`]+)\1/g)) names.add(m[2])
	}
	return names
}

function coverageProblems(
	registered: string[],
	described: Set<string>,
	allowlist: string[],
): string[] {
	const known = new Set(registered)
	const allowed = new Set(allowlist)
	const problems: string[] = []
	for (const name of registered) {
		if (!described.has(name) && !allowed.has(name)) {
			problems.push(`${name}: no describeTool('${name}', ...) block in test/contract`)
		}
		if (described.has(name) && allowed.has(name)) {
			problems.push(`${name}: covered now, remove it from test/contract/uncovered.json`)
		}
	}
	for (const name of described) {
		if (!known.has(name)) problems.push(`${name}: describeTool() names an unregistered tool`)
	}
	for (const name of allowed) {
		if (!known.has(name)) problems.push(`${name}: uncovered.json names an unregistered tool`)
	}
	return problems
}

describe('MCP contract: tool coverage', () => {
	it('uncovered.json is sorted, unique and only shrinks', () => {
		expect(uncovered).toEqual([...new Set(uncovered)].sort())
		expect(uncovered.length).toBeLessThanOrEqual(UNCOVERED_CEILING)
	})

	it('flags a tool whose describeTool block was removed', () => {
		const tools = ['a_tool', 'b_tool']
		const covered = describedTools({ 'x.test.ts': "describeTool('a_tool', () => {})" })
		expect(coverageProblems(tools, covered, [])).toEqual([
			"b_tool: no describeTool('b_tool', ...) block in test/contract",
		])
		expect(coverageProblems(tools, covered, ['b_tool'])).toEqual([])
		expect(coverageProblems(tools, describedTools({}), ['b_tool'])).toEqual([
			"a_tool: no describeTool('a_tool', ...) block in test/contract",
		])
	})

	it('every registered tool has a describeTool block or an uncovered.json entry', async () => {
		const registered = (await registeredTools()).map((d) => d.name)
		const problems = coverageProblems(registered, describedTools(SOURCES), uncovered)
		expect(
			problems,
			'Tool coverage gaps. A renamed or new tool also changes the surface: run `bun run tool-surface`',
		).toEqual([])
	})
})
