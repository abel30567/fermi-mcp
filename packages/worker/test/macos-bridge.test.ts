import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { FermiMCP } from '../src/mcp/index.ts'
import { registerMacOSBridgeTools } from '../src/mcp/tools/macos-bridge.ts'

function register(bindings: Partial<Env>) {
	const tools = new Map<string, Record<string, z.ZodType>>()
	const agent = {
		principal: 'owner',
		bindings,
		state: {},
		server: {
			tool: (name: string, _description: string, schema: Record<string, z.ZodType>) => {
				tools.set(name, schema)
			},
		},
	} as unknown as FermiMCP
	registerMacOSBridgeTools(agent)
	return tools
}

describe('macOS bridge tools', () => {
	it('registers nothing without MACOS_MCP_URL', () => {
		expect(register({}).size).toBe(0)
	})

	it('registers mac_chrome_open with a profile label and url', () => {
		const tools = register({ MACOS_MCP_URL: 'https://mac.test' })
		const schema = tools.get('mac_chrome_open')
		expect(schema).toBeDefined()
		const obj = z.object(schema as Record<string, z.ZodType>)
		expect(obj.safeParse({ label: 'work', url: 'https://example.com' }).success).toBe(true)
		expect(obj.safeParse({ url: 'https://example.com' }).success).toBe(false)
	})

	it('accepts the optional human flag on mac_click and mac_keystroke', () => {
		const tools = register({ MACOS_MCP_URL: 'https://mac.test' })
		for (const [name, args] of [
			['mac_click', { x: 1, y: 2 }],
			['mac_keystroke', { keys: 'hello' }],
		] as const) {
			const schema = tools.get(name) as Record<string, z.ZodType>
			expect(schema.human).toBeDefined()
			const obj = z.object(schema)
			expect(obj.safeParse({ ...args, human: true }).success).toBe(true)
			expect(obj.safeParse(args).success).toBe(true)
			expect(obj.safeParse({ ...args, human: 'yes' }).success).toBe(false)
		}
	})
})
