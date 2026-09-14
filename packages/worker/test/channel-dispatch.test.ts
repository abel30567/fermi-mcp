import { env, fetchMock } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sendChannelMessage } from '../src/channels/dispatch.ts'
import { clearOutbox, setupOutboxSchema } from './setup-d1.ts'

const workerEnv = env as unknown as Env

interface SentMessage {
	chat_id: string
	text: string
}

const sent: SentMessage[] = []
const discordSent: { channel_id: string; content: string }[] = []
const slackSent: { channel: string; text: string }[] = []

function interceptSendMessage() {
	fetchMock
		.get('https://api.telegram.org')
		.intercept({ path: (p) => p.endsWith('/sendMessage'), method: 'POST' })
		.reply(200, (opts) => {
			sent.push(JSON.parse(String(opts.body)) as SentMessage)
			return { ok: true }
		})
		.persist()
}

function interceptSlack() {
	fetchMock
		.get('https://slack.com')
		.intercept({ path: '/api/chat.postMessage', method: 'POST' })
		.reply(200, (opts) => {
			slackSent.push(JSON.parse(String(opts.body)) as { channel: string; text: string })
			return { ok: true }
		})
		.persist()
}

function interceptDiscord() {
	fetchMock
		.get('https://discord.com')
		.intercept({ path: (p) => /\/channels\/([^/]+)\/messages$/.test(p), method: 'POST' })
		.reply(200, (opts) => {
			const channelId = /\/channels\/([^/]+)\/messages/.exec(opts.path)?.[1] ?? ''
			discordSent.push({ channel_id: channelId, content: JSON.parse(String(opts.body)).content })
			return {}
		})
		.persist()
}

beforeAll(async () => {
	await setupOutboxSchema()
	fetchMock.activate()
	fetchMock.disableNetConnect()
	interceptSendMessage()
	interceptDiscord()
	interceptSlack()
})

describe('sendChannelMessage', () => {
	beforeEach(async () => {
		sent.length = 0
		discordSent.length = 0
		slackSent.length = 0
		await clearOutbox()
	})

	it('routes wa to the outbox without any fetch', async () => {
		await sendChannelMessage(workerEnv, 'wa', '15551234567', 'hi there')
		expect(sent).toHaveLength(0)
		const row = await env.FERMI_DB.prepare(
			"SELECT chat_id, body, status FROM outbox WHERE channel = 'wa'",
		).first<{ chat_id: string; body: string; status: string }>()
		expect(row).toMatchObject({ chat_id: '15551234567', body: 'hi there', status: 'pending' })
	})

	it('routes tg through the Telegram sendMessage API', async () => {
		await sendChannelMessage(workerEnv, 'tg', '99', 'telegram hello')
		expect(sent).toHaveLength(1)
		expect(sent[0]).toMatchObject({ chat_id: '99', text: 'telegram hello' })
		const row = await env.FERMI_DB.prepare("SELECT id FROM outbox WHERE channel = 'tg'").first()
		expect(row).toBeNull()
	})

	it('routes dc through the Discord REST messages API', async () => {
		await sendChannelMessage(workerEnv, 'dc', '112233', 'discord hello')
		expect(discordSent).toHaveLength(1)
		expect(discordSent[0]).toMatchObject({ channel_id: '112233', content: 'discord hello' })
		const row = await env.FERMI_DB.prepare("SELECT id FROM outbox WHERE channel = 'dc'").first()
		expect(row).toBeNull()
	})

	it('routes sl through Slack chat.postMessage', async () => {
		await sendChannelMessage(workerEnv, 'sl', 'C123', 'slack hello')
		expect(slackSent).toHaveLength(1)
		expect(slackSent[0]).toMatchObject({ channel: 'C123', text: 'slack hello' })
		const row = await env.FERMI_DB.prepare("SELECT id FROM outbox WHERE channel = 'sl'").first()
		expect(row).toBeNull()
	})
})
