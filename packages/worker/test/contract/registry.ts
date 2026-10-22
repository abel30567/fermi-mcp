import { env } from 'cloudflare:test'
import { registerAllCapabilities } from '../../src/capabilities/index.ts'
import { type GuardrailDef, TOOL_REGISTRY } from '../../src/lib/tool.ts'
import type { FermiMCP } from '../../src/mcp/index.ts'
import { registerTools } from '../../src/mcp/register-tools.ts'

// The registry: every tool registerTools() hands to the MCP server for an owner,
// sorted by name, with the guardrail metadata defineTool() recorded for it.
export async function registeredTools(): Promise<GuardrailDef[]> {
	const names: string[] = []
	const agent = {
		principal: 'owner',
		bindings: env,
		state: {},
		server: { tool: (name: string) => names.push(name) },
	} as unknown as FermiMCP
	registerAllCapabilities()
	await registerTools(agent)
	return names.sort().map((name) => {
		const def = TOOL_REGISTRY.get(name)
		if (!def) throw new Error(`${name} was registered without defineTool()`)
		return def
	})
}
