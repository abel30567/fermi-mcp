import { beforeAll, describe, expect, it } from 'vitest'
import { McpClient, type Tool } from './mcp-client.ts'

// Client-compatibility lint: the subset of JSON Schema that strict MCP clients
// (OpenAI and Gemini function calling) accept, checked on the live tools/list.
//
// Known client limitation: Gemini's strict subset accepts only `enum` and
// `date-time` as string formats. `uri` and `uuid` are still allowed here because
// tools rely on zod's .url() and .uuid() for validation, so Gemini-strict clients
// may reject the tools that use them.

const NAME = /^[a-zA-Z0-9_-]{1,64}$/
const FORBIDDEN_ROOT_KEYS = ['$ref', 'oneOf', 'allOf']
const ALLOWED_FORMATS = new Set(['date', 'date-time', 'time', 'email', 'uri', 'uuid'])
const MAX_DESCRIPTION = 1024
// tools/list was 71,922 bytes when this budget was recorded (120 tools).
const TOOLS_LIST_BUDGET_BYTES = 90_000

type Schema = Record<string, unknown>

// Every `format` keyword in a schema, with its JSON path. Property names are
// data, not keywords, so a property called "format" is not reported.
function formats(schema: unknown, path: string): Array<[string, string]> {
	if (!schema || typeof schema !== 'object') return []
	const s = schema as Schema
	const found: Array<[string, string]> = typeof s.format === 'string' ? [[path, s.format]] : []
	for (const [key, sub] of Object.entries((s.properties ?? {}) as Schema)) {
		found.push(...formats(sub, `${path}.properties.${key}`))
	}
	for (const key of ['items', 'additionalProperties', 'not']) {
		found.push(...formats(s[key], `${path}.${key}`))
	}
	for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
		const list = Array.isArray(s[key]) ? (s[key] as unknown[]) : []
		list.forEach((sub, i) => found.push(...formats(sub, `${path}.${key}[${i}]`)))
	}
	return found
}

describe('MCP contract: client compatibility', () => {
	let tools: Tool[] = []

	beforeAll(async () => {
		const client = new McpClient()
		await client.initialize()
		tools = await client.listTools()
		expect(tools.length).toBeGreaterThan(0)
	})

	it('names match ^[a-zA-Z0-9_-]{1,64}$', () => {
		expect(tools.map((t) => t.name).filter((n) => !NAME.test(n))).toEqual([])
	})

	it('input schemas are a plain root object', () => {
		const bad = tools.flatMap((t) => {
			const root = t.inputSchema as Schema
			const keys = FORBIDDEN_ROOT_KEYS.filter((k) => k in root)
			return root.type === 'object' && keys.length === 0
				? []
				: [`${t.name}: type=${String(root.type)} ${keys.join(' ')}`.trim()]
		})
		expect(bad).toEqual([])
	})

	it(`format values are within ${[...ALLOWED_FORMATS].join(', ')}`, () => {
		const bad = tools.flatMap((t) =>
			formats(t.inputSchema, t.name)
				.filter(([, f]) => !ALLOWED_FORMATS.has(f))
				.map(([path, f]) => `${path}: ${f}`),
		)
		expect(bad).toEqual([])
	})

	it(`descriptions are at most ${MAX_DESCRIPTION} characters`, () => {
		const bad = tools
			.filter((t) => (t.description ?? '').length > MAX_DESCRIPTION)
			.map((t) => `${t.name}: ${t.description?.length}`)
		expect(bad).toEqual([])
	})

	it(`tools/list JSON is under ${TOOLS_LIST_BUDGET_BYTES} bytes`, () => {
		const bytes = new TextEncoder().encode(JSON.stringify({ tools })).length
		console.log(`contract: tools/list=${bytes} bytes, ${tools.length} tools`)
		expect(bytes).toBeLessThan(TOOLS_LIST_BUDGET_BYTES)
	})
})
