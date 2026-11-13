import { describe, expect, it } from 'vitest'
import { registeredTools } from './registry.ts'

// Coverage gate: every registered tool needs a describeTool('<name>', ...) block
// somewhere in test/contract. Coverage is read from the test sources themselves,
// so parallel PRs never edit a shared manifest.

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

function coverageProblems(registered: string[], described: Set<string>): string[] {
	const known = new Set(registered)
	const problems: string[] = []
	for (const name of registered) {
		if (!described.has(name)) {
			problems.push(`${name}: no describeTool('${name}', ...) block in test/contract`)
		}
	}
	for (const name of described) {
		if (!known.has(name)) problems.push(`${name}: describeTool() names an unregistered tool`)
	}
	return problems
}

describe('MCP contract: tool coverage', () => {
	it('flags a tool whose describeTool block was removed', () => {
		const tools = ['a_tool', 'b_tool']
		const covered = describedTools({ 'x.test.ts': "describeTool('a_tool', () => {})" })
		expect(coverageProblems(tools, covered)).toEqual([
			"b_tool: no describeTool('b_tool', ...) block in test/contract",
		])
		expect(coverageProblems(['a_tool'], covered)).toEqual([])
		expect(coverageProblems(['b_tool'], covered)).toEqual([
			"b_tool: no describeTool('b_tool', ...) block in test/contract",
			'a_tool: describeTool() names an unregistered tool',
		])
	})

	it('every registered tool has a describeTool block', async () => {
		const registered = (await registeredTools()).map((d) => d.name)
		const problems = coverageProblems(registered, describedTools(SOURCES))
		expect(
			problems,
			'Tool coverage gaps. A renamed or new tool also changes the surface: run `bun run tool-surface`',
		).toEqual([])
	})
})
