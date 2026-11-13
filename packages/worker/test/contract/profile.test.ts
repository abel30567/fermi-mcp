import { env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { PROFILE_BUDGETS } from '../../src/lib/profile-store.ts'
import { describeTool } from './describe-tool.ts'
import { resultJson } from './mcp-client.ts'
import { expectSchemaRejection, resetTables, session } from './tool-call.ts'

beforeEach(() => resetTables('profile_docs'))

async function docBody(name: string): Promise<string | undefined> {
	const row = await env.FERMI_DB.prepare('SELECT body FROM profile_docs WHERE name = ?1')
		.bind(name)
		.first<{ body: string }>()
	return row?.body
}

describeTool('profile_update', () => {
	it('add, replace and remove persist line edits to the doc', async () => {
		const client = await session()
		const update = async (args: Record<string, unknown>) =>
			resultJson(await client.callTool('profile_update', { target: 'user', ...args }))

		expect(await update({ action: 'add', content: 'Prefers metric units' })).toEqual({
			ok: true,
			usage: 20,
			limit: PROFILE_BUDGETS.user,
		})
		await update({ action: 'add', content: 'Lives in Lisbon' })
		expect(await docBody('user')).toBe('Prefers metric units\nLives in Lisbon')

		expect(await update({ action: 'replace', match: 'Lisbon', content: 'Lives in Porto' })).toEqual(
			{ ok: true, usage: 35, limit: PROFILE_BUDGETS.user },
		)
		await update({ action: 'remove', match: 'metric' })
		expect(await docBody('user')).toBe('Lives in Porto')
	})

	it('round-trips into context_bootstrap', async () => {
		const client = await session()
		await client.callTool('profile_update', {
			target: 'agent',
			action: 'add',
			content: 'Deploys go through CI',
		})
		const ctx = resultJson<{ agent_doc: { body: string; usage: number; limit: number } }>(
			await client.callTool('context_bootstrap', { channel: 'tg', chat_id: 'contract-profile' }),
		)
		expect(ctx.agent_doc).toEqual({
			body: 'Deploys go through CI',
			usage: 21,
			limit: PROFILE_BUDGETS.agent,
		})
	})

	it('returns over_budget without truncating or writing', async () => {
		const client = await session()
		await client.callTool('profile_update', { target: 'user', action: 'add', content: 'keep me' })
		const tooLong = 'x'.repeat(PROFILE_BUDGETS.user)
		expect(
			resultJson(
				await client.callTool('profile_update', {
					target: 'user',
					action: 'add',
					content: tooLong,
				}),
			),
		).toEqual({
			ok: false,
			error: 'over_budget',
			usage: 'keep me\n'.length + tooLong.length,
			limit: PROFILE_BUDGETS.user,
		})
		expect(await docBody('user')).toBe('keep me')
	})

	it('returns the documented errors for bad edits', async () => {
		const client = await session()
		const update = async (args: Record<string, unknown>) =>
			resultJson(await client.callTool('profile_update', { target: 'agent', ...args }))
		await update({ action: 'add', content: 'line one' })
		expect(await update({ action: 'add' })).toEqual({ ok: false, error: 'content_required' })
		expect(await update({ action: 'add', content: 'line one' })).toEqual({
			ok: false,
			error: 'duplicate_entry',
		})
		expect(await update({ action: 'remove' })).toEqual({ ok: false, error: 'match_required' })
		expect(await update({ action: 'remove', match: 'absent' })).toEqual({
			ok: false,
			error: 'match_not_found',
		})
		expect(await docBody('agent')).toBe('line one')
	})

	it('rejects a call without action', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('profile_update', { target: 'user', content: 'x' }),
			'profile_update',
			'action',
		)
		expect(await docBody('user')).toBeUndefined()
	})
})
