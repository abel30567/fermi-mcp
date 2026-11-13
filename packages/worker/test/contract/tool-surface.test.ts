import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { sha256Hex } from '../../src/channels/box-gateway.ts'
import { registerBox } from '../../src/lib/fleet-store.ts'
import { McpClient } from './mcp-client.ts'
import { registeredTools } from './registry.ts'

// The committed tool surface: daemon prompts and harnesses depend on these names
// and argument shapes, so any change must show up as a diff of tool-surface.json.
// `bun run tool-surface` runs this file with -u to rewrite it.
it('the live tool surface matches tool-surface.json', async () => {
	const owner = new McpClient()
	await owner.initialize()
	const tools = await owner.listTools()

	await registerBox(env.FERMI_DB, {
		boxId: 'box-surface',
		meta: { token_hash: await sha256Hex('box-secret') },
	})
	const box = new McpClient('/box/mcp', { authorization: 'Bearer box-surface.box-secret' })
	await box.initialize()
	const boxNames = new Set((await box.listTools()).map((t) => t.name))

	const defs = new Map((await registeredTools()).map((d) => [d.name, d]))
	const surface = await Promise.all(
		tools
			.sort((a, b) => (a.name < b.name ? -1 : 1))
			.map(async (t) => ({
				name: t.name,
				descriptionSha256: await sha256Hex(t.description ?? ''),
				inputSchema: t.inputSchema,
				risk: defs.get(t.name)?.risk ?? null,
				mutates: defs.get(t.name)?.mutates ?? null,
				box: boxNames.has(t.name),
			})),
	)

	await expect(`${JSON.stringify(surface, null, '\t')}\n`).toMatchFileSnapshot(
		'../../tool-surface.json',
		'The MCP tool surface changed. If intended, run `bun run tool-surface` and commit packages/worker/tool-surface.json',
	)
})
