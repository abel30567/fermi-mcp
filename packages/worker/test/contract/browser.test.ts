import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { callApproved } from './approval.ts'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// wrangler.test.jsonc has no MYBROWSER binding, so anything that needs a real
// browser fails closed with an error. The session bookkeeping (BrowserSessionDO
// storage + the browser_sessions table) runs for real against the local DO.

const NO_BINDING = /Browser Rendering binding required/

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.prepare('DELETE FROM browser_sessions').run()
	client = new McpClient()
	await client.initialize()
})

function errorText(result: { content: Array<{ text?: string }>; isError?: boolean }): string {
	expect(result.isError).toBe(true)
	return result.content[0]?.text ?? ''
}

async function seedSession(id: string, status = 'active') {
	await env.FERMI_DB.prepare(
		`INSERT INTO browser_sessions (id, label, live_view_url, status, created_at, last_activity)
		 VALUES (?1, 'seeded', NULL, ?2, 1, 1)`,
	)
		.bind(id, status)
		.run()
}

async function sessionRow(id: string) {
	return env.FERMI_DB.prepare('SELECT status FROM browser_sessions WHERE id = ?1')
		.bind(id)
		.first<{ status: string }>()
}

describeTool('browser_navigate', () => {
	it('fails closed without the MYBROWSER binding', async () => {
		const result = await client.callTool('browser_navigate', { url: 'https://example.com' })
		expect(errorText(result)).toMatch(NO_BINDING)
	})
})

describeTool('browser_screenshot', () => {
	it('fails closed without the MYBROWSER binding', async () => {
		const result = await client.callTool('browser_screenshot', { url: 'https://example.com' })
		expect(errorText(result)).toMatch(NO_BINDING)
	})
})

describeTool('browser_extract', () => {
	it('fails closed without the MYBROWSER binding', async () => {
		const result = await client.callTool('browser_extract', {
			url: 'https://example.com',
			selector: 'h1',
		})
		expect(errorText(result)).toMatch(NO_BINDING)
	})
})

describeTool('browser_action', () => {
	const args = { actions: [{ type: 'goto', url: 'https://example.com' }] }

	it('requires an approval token', async () => {
		expect(resultJson(await client.callTool('browser_action', args))).toMatchObject({
			status: 'pending_approval',
			risk: 'high',
		})
	})

	it('fails closed without the MYBROWSER binding once approved', async () => {
		expect(errorText(await callApproved(client, 'browser_action', args))).toMatch(NO_BINDING)
	})
})

describeTool('browser_session_launch', () => {
	it('fails closed without the MYBROWSER binding and records no session', async () => {
		const result = await client.callTool('browser_session_launch', { label: 'shop' })
		expect(errorText(result)).toMatch(/MYBROWSER binding not available/)
		const listed = resultJson<{ sessions: unknown[] }>(
			await client.callTool('browser_session_list', {}),
		)
		expect(listed.sessions).toEqual([])
	})
})

describeTool('browser_session_action', () => {
	it('reports a session with no live browser as no longer active', async () => {
		const id = crypto.randomUUID()
		const result = await callApproved(client, 'browser_session_action', {
			session_id: id,
			actions: [{ type: 'wait', ms: 1 }],
		})
		expect(errorText(result)).toMatch(/Browser session is no longer active/)
	})
})

describeTool('browser_session_request_human', () => {
	it('marks the session waiting_for_human and relays the message', async () => {
		const id = crypto.randomUUID()
		await seedSession(id)
		const result = resultJson(
			await client.callTool('browser_session_request_human', {
				session_id: id,
				message: 'Please solve the CAPTCHA',
			}),
		)
		expect(result).toEqual({ ok: true, live_view_url: null, message: 'Please solve the CAPTCHA' })
		expect(await sessionRow(id)).toEqual({ status: 'waiting_for_human' })
	})
})

describeTool('browser_session_resume', () => {
	it('marks a waiting session active again', async () => {
		const id = crypto.randomUUID()
		await seedSession(id, 'waiting_for_human')
		expect(resultJson(await client.callTool('browser_session_resume', { session_id: id }))).toEqual(
			{ ok: true, status: 'active' },
		)
		expect(await sessionRow(id)).toEqual({ status: 'active' })
	})
})

describeTool('browser_session_close', () => {
	it('closes the session and removes it from the list', async () => {
		const id = crypto.randomUUID()
		await seedSession(id)
		expect(resultJson(await client.callTool('browser_session_close', { session_id: id }))).toEqual({
			ok: true,
		})
		expect(await sessionRow(id)).toBeNull()
	})
})

describeTool('browser_session_list', () => {
	it('lists open sessions, newest first, and hides closed ones', async () => {
		const now = Date.now()
		const insert = env.FERMI_DB.prepare(
			`INSERT INTO browser_sessions (id, label, live_view_url, status, created_at, last_activity)
			 VALUES (?1, ?2, NULL, ?3, ?4, ?4)`,
		)
		await env.FERMI_DB.batch([
			insert.bind('old', 'old', 'active', now - 2000),
			insert.bind('new', 'new', 'waiting_for_human', now - 1000),
			insert.bind('gone', 'gone', 'closed', now),
		])
		const listed = resultJson<{ sessions: Array<{ id: string; status: string }> }>(
			await client.callTool('browser_session_list', {}),
		)
		expect(listed.sessions.map((s) => [s.id, s.status])).toEqual([
			['new', 'waiting_for_human'],
			['old', 'active'],
		])
	})
})
