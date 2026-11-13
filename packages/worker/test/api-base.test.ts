import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readDiscordChannel } from '../src/channels/discord-read.ts'
import { sendChannelMessage } from '../src/channels/dispatch.ts'
import { runAgentTurn } from '../src/channels/inference.ts'
import { setTelegramWebhook } from '../src/channels/telegram.ts'
import { readPhoneConfig, twilioDial } from '../src/lib/phone-call.ts'
import { setupSecretsSchema } from './setup-d1.ts'

// Every upstream API the agent can reach is redirectable to a local fake via a
// *_API_BASE var (the eval target). These tests stand up the "fake" at a
// loopback origin and fail if the code still calls the real service.
const FAKE = 'http://127.0.0.1:9911'

const evalEnv = {
	...env,
	SLACK_API_BASE: `${FAKE}/`,
	TELEGRAM_API_BASE: FAKE,
	DISCORD_API_BASE: FAKE,
	ANTHROPIC_API_BASE: FAKE,
	TWILIO_API_BASE: FAKE,
	TWILIO_ACCOUNT_SID: 'ACeval',
	TWILIO_AUTH_TOKEN: 'eval-token',
	TWILIO_FROM_NUMBER: '+15555550100',
	OPENAI_API_KEY: 'sk-eval',
	FERMI_PUBLIC_URL: 'http://127.0.0.1:8164',
	ANTHROPIC_API_KEY: 'sk-ant-eval',
} as unknown as Env

const fake = () => fetchMock.get(FAKE)

describe('API base overrides', () => {
	beforeAll(async () => {
		await setupSecretsSchema()
	})
	beforeEach(() => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
	})
	afterEach(() => {
		fetchMock.assertNoPendingInterceptors()
		fetchMock.deactivate()
	})

	it('SLACK_API_BASE: channel_send to Slack hits the fake', async () => {
		let body = ''
		fake()
			.intercept({ path: '/api/chat.postMessage', method: 'POST' })
			.reply(200, (opts) => {
				body = String(opts.body)
				return { ok: true }
			})
		await sendChannelMessage(evalEnv, 'sl', 'C123', 'hi slack')
		expect(JSON.parse(body)).toEqual({ channel: 'C123', text: 'hi slack' })
	})

	it('TELEGRAM_API_BASE: sendMessage and setWebhook hit the fake', async () => {
		fake()
			.intercept({ path: '/bottest-bot-token/sendMessage', method: 'POST' })
			.reply(200, { ok: true })
		fake()
			.intercept({ path: '/bottest-bot-token/setWebhook', method: 'POST' })
			.reply(200, { ok: true })
		await sendChannelMessage(evalEnv, 'tg', '42', 'hi telegram')
		const res = await setTelegramWebhook(evalEnv, 'http://127.0.0.1:8164/tg/webhook')
		expect(res.ok).toBe(true)
	})

	it('DISCORD_API_BASE: send and read hit the fake', async () => {
		fake().intercept({ path: '/api/v10/channels/555/messages', method: 'POST' }).reply(200, {})
		fake()
			.intercept({ path: '/api/v10/channels/555/messages?limit=20', method: 'GET' })
			.reply(200, [{ content: 'from fake', timestamp: '1', author: { id: '1', username: 'a' } }])
		await sendChannelMessage(evalEnv, 'dc', '555', 'hi discord')
		const read = await readDiscordChannel(evalEnv, { channelId: '555' })
		expect(read.messages.map((m) => m.content)).toEqual(['from fake'])
	})

	it('ANTHROPIC_API_BASE: the inference loop calls the fake Messages API', async () => {
		fake()
			.intercept({ path: '/v1/messages', method: 'POST' })
			.reply(
				200,
				{
					id: 'msg_eval',
					type: 'message',
					role: 'assistant',
					model: 'claude-haiku-4-5-20251001',
					content: [{ type: 'text', text: 'hello from the fake' }],
					stop_reason: 'end_turn',
					stop_sequence: null,
					usage: { input_tokens: 1, output_tokens: 1 },
				},
				{ headers: { 'content-type': 'application/json' } },
			)
		const reply = await runAgentTurn('hi', evalEnv, { channel: 'internal' })
		expect(reply).toBe('hello from the fake')
	})

	it('TWILIO_API_BASE: a Worker var redirects the dial request to the fake', async () => {
		const cfg = await readPhoneConfig(evalEnv)
		expect(cfg.ok).toBe(true)
		if (!cfg.ok) return
		expect(cfg.config.twilioApiBase).toBe(FAKE)
		fake()
			.intercept({ path: '/2010-04-01/Accounts/ACeval/Calls.json', method: 'POST' })
			.reply(201, { sid: 'CAeval' })
		expect(await twilioDial(cfg.config, new URLSearchParams())).toEqual({ call_sid: 'CAeval' })
	})
})
