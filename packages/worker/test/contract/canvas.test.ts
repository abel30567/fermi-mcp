import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Canvases live in the local LiveCanvasDO; /canvas/<id> renders their state.

let client: McpClient

beforeEach(async () => {
	client = new McpClient()
	await client.initialize()
})

async function open(args: Record<string, unknown> = {}) {
	return resultJson<{ canvas_id: string; url: string; status: string }>(
		await client.callTool('open_generated_ui', args),
	)
}

async function renderedState(canvasId: string): Promise<Record<string, unknown>> {
	const html = await (await SELF.fetch(`http://fermi.test/canvas/${canvasId}`)).text()
	const pre = html.match(/<pre id="state">([\s\S]*?)<\/pre>/)?.[1] ?? ''
	const unescaped = pre
		.replaceAll('&quot;', '"')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&')
	return JSON.parse(unescaped)
}

describeTool('open_generated_ui', () => {
	it('creates a canvas with its title and initial state and returns its URL', async () => {
		const opened = await open({ title: 'Report', initial_state: { step: 1 } })
		expect(opened.status).toBe('created')
		expect(opened.url).toBe(`http://localhost:8787/canvas/${opened.canvas_id}`)
		expect(await renderedState(opened.canvas_id)).toMatchObject({ step: 1, _title: 'Report' })
	})

	it('defaults the title', async () => {
		const opened = await open()
		expect(await renderedState(opened.canvas_id)).toMatchObject({ _title: 'Untitled Canvas' })
	})
})

describeTool('canvas_update', () => {
	it('merges the patch into the canvas state', async () => {
		const opened = await open({ title: 'Live', initial_state: { step: 1, keep: true } })
		const patched = resultJson<{ ok: boolean; state: Record<string, unknown> }>(
			await client.callTool('canvas_update', {
				canvas_id: opened.canvas_id,
				patch: { step: 2, added: 'x' },
			}),
		)
		expect(patched.ok).toBe(true)
		expect(patched.state).toMatchObject({ step: 2, keep: true, added: 'x', _title: 'Live' })
		expect(await renderedState(opened.canvas_id)).toEqual(patched.state)
	})
})
