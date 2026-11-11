import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_TOKEN_TTL_MS, issueCanvasToken } from '../../src/lib/canvas-auth.ts'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Canvases live in the local LiveCanvasDO; /canvas/<id> renders their state and
// needs a share token (?token= or Authorization: Bearer) issued at creation.

interface Opened {
	canvas_id: string
	url: string
	status: string
	read_token: string
	write_token: string
	expires_at: string
}

let client: McpClient

beforeEach(async () => {
	client = new McpClient()
	await client.initialize()
})

async function open(args: Record<string, unknown> = {}) {
	return resultJson<Opened>(await client.callTool('open_generated_ui', args))
}

function canvasUrl(canvasId: string, token?: string, suffix = ''): string {
	const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`
	return `http://fermi.test/canvas/${canvasId}${suffix}${query}`
}

function postPatch(canvasId: string, token: string | undefined, patch: Record<string, unknown>) {
	return SELF.fetch(canvasUrl(canvasId, token, '/patch'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(patch),
	})
}

async function revoke(canvasId: string, token?: string): Promise<number> {
	const args = token === undefined ? { canvas_id: canvasId } : { canvas_id: canvasId, token }
	return resultJson<{ revoked: number }>(await client.callTool('canvas_revoke', args)).revoked
}

async function renderedState(canvasId: string, token: string): Promise<Record<string, unknown>> {
	const html = await (await SELF.fetch(canvasUrl(canvasId, token))).text()
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
		expect(opened.url).toBe(
			`http://localhost:8787/canvas/${opened.canvas_id}?token=${opened.read_token}`,
		)
		expect(await renderedState(opened.canvas_id, opened.read_token)).toMatchObject({
			step: 1,
			_title: 'Report',
		})
	})

	it('defaults the title', async () => {
		const opened = await open()
		expect(await renderedState(opened.canvas_id, opened.read_token)).toMatchObject({
			_title: 'Untitled Canvas',
		})
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
		expect(await renderedState(opened.canvas_id, opened.read_token)).toEqual(patched.state)
	})
})

describeTool('canvas_revoke', () => {
	it('revokes one token and leaves the others working', async () => {
		const opened = await open()
		expect(await revoke(opened.canvas_id, opened.read_token)).toBe(1)
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, opened.read_token))).status).toBe(401)
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, opened.write_token))).status).toBe(200)
	})

	it('revokes every token of the canvas when no token is given', async () => {
		const opened = await open()
		expect(await revoke(opened.canvas_id)).toBe(2)
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, opened.read_token))).status).toBe(401)
		expect((await postPatch(opened.canvas_id, opened.write_token, { x: 1 })).status).toBe(401)
	})

	it('replaying a token after revoke is rejected (edge: replay after revoke)', async () => {
		const opened = await open()
		expect((await postPatch(opened.canvas_id, opened.write_token, { a: 1 })).status).toBe(200)
		await revoke(opened.canvas_id, opened.write_token)
		const replay = await postPatch(opened.canvas_id, opened.write_token, { a: 2 })
		expect(replay.status).toBe(401)
		expect(await renderedState(opened.canvas_id, opened.read_token)).toMatchObject({ a: 1 })
	})
})

describe('canvas share tokens', () => {
	it('issues distinct 128-bit tokens that expire after the TTL', async () => {
		const before = Date.now()
		const opened = await open()
		expect(opened.read_token).not.toBe(opened.write_token)
		for (const token of [opened.read_token, opened.write_token]) {
			expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)
		}
		const expires = Date.parse(opened.expires_at)
		expect(expires).toBeGreaterThanOrEqual(before + CANVAS_TOKEN_TTL_MS)
		expect(expires).toBeLessThanOrEqual(Date.now() + CANVAS_TOKEN_TTL_MS)
	})

	it('rejects GET, POST and the WebSocket upgrade without a token', async () => {
		const opened = await open()
		const get = await SELF.fetch(canvasUrl(opened.canvas_id))
		expect(get.status).toBe(401)
		expect(get.headers.get('WWW-Authenticate')).toContain('Bearer')
		expect((await postPatch(opened.canvas_id, undefined, { x: 1 })).status).toBe(401)
		const ws = await SELF.fetch(canvasUrl(opened.canvas_id), { headers: { Upgrade: 'websocket' } })
		expect(ws.status).toBe(401)
		expect(ws.webSocket).toBeNull()
	})

	it('rejects an unknown token', async () => {
		const opened = await open()
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, 'not-a-token'))).status).toBe(401)
	})

	it('accepts the token in an Authorization header', async () => {
		const opened = await open()
		const res = await SELF.fetch(canvasUrl(opened.canvas_id), {
			headers: { Authorization: `Bearer ${opened.read_token}` },
		})
		expect(res.status).toBe(200)
		expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
	})

	it('a read token can GET but cannot POST; a write token can', async () => {
		const opened = await open({ initial_state: { v: 0 } })
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, opened.read_token))).status).toBe(200)
		expect((await postPatch(opened.canvas_id, opened.read_token, { v: 1 })).status).toBe(403)
		expect(await renderedState(opened.canvas_id, opened.read_token)).toMatchObject({ v: 0 })
		const written = await postPatch(opened.canvas_id, opened.write_token, { v: 2 })
		expect(written.status).toBe(200)
		expect(await renderedState(opened.canvas_id, opened.read_token)).toMatchObject({ v: 2 })
	})

	it('rejects an expired token', async () => {
		const opened = await open()
		const expired = await issueCanvasToken(env, opened.canvas_id, 'write', -1)
		expect((await SELF.fetch(canvasUrl(opened.canvas_id, expired.token))).status).toBe(401)
		expect((await postPatch(opened.canvas_id, expired.token, { x: 1 })).status).toBe(401)
	})

	it('a token only opens the canvas it was issued for', async () => {
		const a = await open()
		const b = await open()
		expect((await SELF.fetch(canvasUrl(b.canvas_id, a.read_token))).status).toBe(401)
	})

	it('edge: missing canvas id is a 400 before any token check', async () => {
		expect((await SELF.fetch('http://fermi.test/canvas/')).status).toBe(400)
		const opened = await open()
		expect((await SELF.fetch(`http://fermi.test/canvas/?token=${opened.read_token}`)).status).toBe(
			400,
		)
	})

	it('edge: concurrent writers with a write token all land', async () => {
		const opened = await open()
		const writes = Array.from({ length: 10 }, (_, i) =>
			postPatch(opened.canvas_id, opened.write_token, { [`k${i}`]: i }),
		)
		const statuses = (await Promise.all(writes)).map((r) => r.status)
		expect(statuses).toEqual(Array(10).fill(200))
		const state = await renderedState(opened.canvas_id, opened.read_token)
		for (let i = 0; i < 10; i++) expect(state[`k${i}`]).toBe(i)
	})

	it('edge: a WebSocket is checked at upgrade only and outlives a later revoke', async () => {
		const opened = await open({ initial_state: { n: 0 } })
		const res = await SELF.fetch(canvasUrl(opened.canvas_id, opened.read_token), {
			headers: { Upgrade: 'websocket' },
		})
		expect(res.status).toBe(101)
		const ws = res.webSocket as WebSocket
		const messages: Array<{ type: string; data: Record<string, unknown> }> = []
		ws.addEventListener('message', (e) => {
			messages.push(JSON.parse(e.data as string))
		})
		ws.accept()

		await revoke(opened.canvas_id)
		await client.callTool('canvas_update', { canvas_id: opened.canvas_id, patch: { n: 1 } })
		await vi.waitFor(() => expect(messages.some((m) => m.data.n === 1)).toBe(true))

		// A new upgrade with the revoked token is refused.
		const again = await SELF.fetch(canvasUrl(opened.canvas_id, opened.read_token), {
			headers: { Upgrade: 'websocket' },
		})
		expect(again.status).toBe(401)
		ws.close()
	})
})
