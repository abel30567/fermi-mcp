import { describe } from 'vitest'

/**
 * A contract-test block for one MCP tool. tool-coverage.test.ts finds these
 * calls by scanning test/contract sources, so the name must be a string literal.
 */
export function describeTool(name: string, fn: () => void): void {
	describe(`tool ${name}`, fn)
}
