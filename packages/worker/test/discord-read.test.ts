import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDiscordChannel } from '../src/channels/discord-read.ts'

const workerEnv = { ...env, DISCORD_BOT_TOKEN: 'test-dc-token' } as unknown as Env

describe('readDiscordChannel', () => {
	beforeEach(() => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
	})
	afterEach(() => fetchMock.deactivate())

	it('reads messages by channel_id, chronological', async () => {
		fetchMock
			.get('https://discord.com')
			.intercept({ path: (p) => p.startsWith('/api/v10/channels/555/messages'), method: 'GET' })
			.reply(200, [
				{ content: 'newest', timestamp: '2', author: { id: '2', username: 'b', global_name: 'B' } },
				{
					content: 'oldest',
					timestamp: '1',
					author: { id: '1', username: 'a', global_name: null },
				},
			])
		const r = await readDiscordChannel(workerEnv, { channelId: '555' })
		expect(r.channel_id).toBe('555')
		expect(r.messages.map((m) => m.content)).toEqual(['oldest', 'newest'])
		expect(r.messages[0].author).toBe('a') // falls back to username when no global_name
	})

	it('filters by query', async () => {
		fetchMock
			.get('https://discord.com')
			.intercept({ path: (p) => p.startsWith('/api/v10/channels/555/messages'), method: 'GET' })
			.reply(200, [
				{ content: 'tournament on July 20', timestamp: '2', author: { id: '2', username: 'b' } },
				{ content: 'unrelated chatter', timestamp: '1', author: { id: '1', username: 'a' } },
			])
		const r = await readDiscordChannel(workerEnv, { channelId: '555', query: 'tournament' })
		expect(r.messages).toHaveLength(1)
		expect(r.messages[0].content).toContain('July 20')
	})

	it('resolves a channel by guild_id + name', async () => {
		fetchMock
			.get('https://discord.com')
			.intercept({ path: '/api/v10/guilds/900/channels', method: 'GET' })
			.reply(200, [
				{ id: '111', name: 'general', type: 0 },
				{ id: '222', name: 'announcements', type: 0 },
			])
		fetchMock
			.get('https://discord.com')
			.intercept({ path: (p) => p.startsWith('/api/v10/channels/222/messages'), method: 'GET' })
			.reply(200, [{ content: 'event Aug 3', timestamp: '1', author: { id: '1', username: 'a' } }])
		const r = await readDiscordChannel(workerEnv, {
			guildId: '900',
			channelName: '#announcements',
		})
		expect(r.channel_id).toBe('222')
		expect(r.messages[0].content).toBe('event Aug 3')
	})

	it('errors clearly when neither id nor name given', async () => {
		await expect(readDiscordChannel(workerEnv, {})).rejects.toThrow(/channel_id/)
	})
})
