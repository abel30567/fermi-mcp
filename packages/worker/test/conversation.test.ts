import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	getConversationHistory,
	getOrCreateChannelSession,
	logChannelMessage,
} from '../src/lib/conversation.ts'
import { endSession } from '../src/lib/session.ts'
import { clearSessions, setupSessionsSchema } from './setup-d1.ts'

describe('conversation', () => {
	beforeAll(async () => {
		await setupSessionsSchema()
	})

	beforeEach(async () => {
		await clearSessions()
	})

	it('reuses the open session for a chat', async () => {
		const first = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		const second = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		expect(second).toBe(first)
		const row = await env.FERMI_DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{
			n: number
		}>()
		expect(row?.n).toBe(1)
	})

	it('opens a fresh session after the previous one is ended', async () => {
		const first = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		await endSession(env.FERMI_DB, first)
		const second = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		expect(second).not.toBe(first)
	})

	it('returns chronological history across sessions of the same chat', async () => {
		const first = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'user', 'one')
		await endSession(env.FERMI_DB, first)
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'assistant', 'two')

		const history = await getConversationHistory(env.FERMI_DB, 'tg', '99')
		expect(history.messages.map((m) => m.body)).toEqual(['one', 'two'])
		expect(history.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
	})

	it('isolates chats and clamps the limit', async () => {
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'user', 'mine')
		await logChannelMessage(env.FERMI_DB, 'tg', '77', 'user', 'theirs')
		for (let i = 0; i < 60; i++) {
			await logChannelMessage(env.FERMI_DB, 'tg', '99', 'user', `bulk ${i}`)
		}

		const history = await getConversationHistory(env.FERMI_DB, 'tg', '99', 999)
		expect(history.messages).toHaveLength(50)
		expect(history.messages.some((m) => m.body === 'theirs')).toBe(false)
	})

	it('surfaces the newest closed session summary as prior_summary', async () => {
		const first = await getOrCreateChannelSession(env.FERMI_DB, 'tg', '99')
		await endSession(env.FERMI_DB, first)
		await env.FERMI_DB.prepare('UPDATE sessions SET summary = ?1 WHERE id = ?2')
			.bind('talked about teal', first)
			.run()
		const history = await getConversationHistory(env.FERMI_DB, 'tg', '99')
		expect(history.prior_summary).toBe('talked about teal')
	})
})
