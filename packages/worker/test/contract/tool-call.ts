import { env } from 'cloudflare:test'
import { expect } from 'vitest'
import { McpClient, type ToolResult } from './mcp-client.ts'

export async function session(): Promise<McpClient> {
	const client = new McpClient()
	await client.initialize()
	return client
}

/** Empty the given D1 tables; the contract project shares one D1 across files. */
export async function resetTables(...tables: string[]): Promise<void> {
	await env.FERMI_DB.batch(tables.map((t) => env.FERMI_DB.prepare(`DELETE FROM ${t}`)))
}

/**
 * The MCP SDK rejects arguments that fail the tool's zod schema before the
 * handler runs: an isError result naming the tool and the offending field.
 */
export function expectSchemaRejection(result: ToolResult, tool: string, field: string): void {
	expect(result.isError).toBe(true)
	const text = result.content[0]?.text ?? ''
	expect(text).toContain(
		`MCP error -32602: Input validation error: Invalid arguments for tool ${tool}`,
	)
	expect(text).toMatch(new RegExp(`"path": \\[\\s*"${field}"\\s*\\]`))
}
