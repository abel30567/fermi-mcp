import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

interface Entry {
	channel: string
	sender_id: string
	note: string | null
	added_by: string | null
	tasks_total: number
}

let client: McpClient

beforeEach(async () => {
	await env.FERMI_DB.batch([
		env.FERMI_DB.prepare('DELETE FROM allowlist'),
		env.FERMI_DB.prepare('DELETE FROM tasks'),
	])
	client = new McpClient()
	await client.initialize()
})

async function list() {
	return resultJson<{ entries: Entry[]; total: number }>(
		await client.callTool('allowlist_list', {}),
	)
}

describeTool('allowlist_add', () => {
	it('adds a sender, and re-adding refreshes the entry instead of duplicating it', async () => {
		const add = (note: string) =>
			client.callTool('allowlist_add', { channel: 'tg', sender_id: '111', note })
		expect(resultJson(await add('guest'))).toEqual({ ok: true })
		expect(resultJson(await add('friend'))).toEqual({ ok: true })
		const { entries } = await list()
		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({
			channel: 'tg',
			sender_id: '111',
			note: 'friend',
			added_by: 'mcp',
		})
	})
})

describeTool('allowlist_remove', () => {
	it('removes a sender from one channel only, then reports not_found', async () => {
		await client.callTool('allowlist_add', { channel: 'tg', sender_id: '111' })
		await client.callTool('allowlist_add', { channel: 'wa', sender_id: '111' })
		const remove = () => client.callTool('allowlist_remove', { channel: 'tg', sender_id: '111' })
		expect(resultJson(await remove())).toEqual({ ok: true })
		expect((await list()).entries.map((e) => e.channel)).toEqual(['wa'])
		expect(resultJson(await remove())).toEqual({ ok: false, error: 'not_found' })
	})
})

describeTool('allowlist_list', () => {
	it('lists entries ordered by task usage', async () => {
		await client.callTool('allowlist_add', { channel: 'dc', sender_id: 'quiet' })
		await client.callTool('allowlist_add', { channel: 'sl', sender_id: 'busy' })
		for (let i = 0; i < 2; i++) {
			await client.callTool('task_enqueue', {
				channel: 'sl',
				sender: 'busy',
				chat_id: 'c1',
				payload: `msg ${i}`,
			})
		}
		const listed = await list()
		expect(listed.total).toBe(2)
		expect(listed.entries.map((e) => [e.sender_id, e.tasks_total])).toEqual([
			['busy', 2],
			['quiet', 0],
		])
	})
})
