import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getOrCreateChannelSession, logChannelMessage } from '../src/lib/conversation.ts'
import { parseChannelHost, searchMessages } from '../src/lib/session-store.ts'
import { endSession } from '../src/lib/session.ts'
import { clearSessions, setupFtsSchema } from './setup-d1.ts'

const workerEnv = env as unknown as Env

describe('searchMessages', () => {
	beforeAll(async () => {
		await setupFtsSchema()
	})

	beforeEach(async () => {
		await clearSessions()
	})

	it('finds a message in an older session of the same chat and attributes it', async () => {
		const old = await getOrCreateChannelSession(env.FERMI_DB, 'wa', '123@g.us')
		await logChannelMessage(
			env.FERMI_DB,
			'wa',
			'123@g.us',
			'assistant',
			'the lighthouse is closed on Mondays',
		)
		await endSession(env.FERMI_DB, old)
		await logChannelMessage(env.FERMI_DB, 'wa', '123@g.us', 'user', 'unrelated chatter')
		await logChannelMessage(env.FERMI_DB, 'tg', '77', 'assistant', 'another lighthouse remark')

		const all = await searchMessages('lighthouse', 10, workerEnv)
		expect(all).toHaveLength(2)

		const scoped = await searchMessages('lighthouse', 10, workerEnv, {
			channel: 'wa',
			chatId: '123@g.us',
		})
		expect(scoped).toHaveLength(1)
		expect(scoped[0]).toMatchObject({
			session_id: old,
			role: 'assistant',
			host: 'wa:123@g.us',
			channel: 'wa',
			chat_id: '123@g.us',
		})
		expect(scoped[0].created_at).toBeTypeOf('number')
	})

	it('parses channel hosts and leaves other hosts unattributed', () => {
		expect(parseChannelHost('wa:123@g.us')).toEqual({ channel: 'wa', chat_id: '123@g.us' })
		expect(parseChannelHost('sl:C0C1DAL1H0F')).toEqual({ channel: 'sl', chat_id: 'C0C1DAL1H0F' })
		expect(parseChannelHost('claude-code')).toEqual({ channel: null, chat_id: null })
	})
})
