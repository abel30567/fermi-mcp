import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleConsolidation } from '../src/cron/consolidation.ts'
import { logChannelMessage } from '../src/lib/conversation.ts'
import {
	clearMemory,
	clearSessions,
	setupMemorySchema,
	setupOutboxSchema,
	setupSessionsSchema,
} from './setup-d1.ts'

// env.AI is absent in miniflare tests; stub it so both the summarize and
// fact-extraction calls return a parseable response.
const stubEnv = {
	...env,
	AI: { run: async () => ({ response: '["User prefers teal"]' }) },
} as unknown as Env

describe('consolidation channel-session distillation', () => {
	beforeAll(async () => {
		await setupSessionsSchema()
		await setupMemorySchema()
		await setupOutboxSchema()
	})

	beforeEach(async () => {
		await clearSessions()
		await clearMemory()
	})

	it('closes idle channel sessions, summarizes, and distills facts', async () => {
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'user', 'my favorite color is teal')
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'assistant', 'noted!')
		// Age the messages past the 2h idle window
		await env.FERMI_DB.prepare('UPDATE messages SET created_at = ?1')
			.bind(Date.now() - 3 * 3_600_000)
			.run()

		await handleConsolidation(stubEnv)

		const session = await env.FERMI_DB.prepare(
			"SELECT ended_at, summary FROM sessions WHERE host = 'tg:99'",
		).first<{ ended_at: number | null; summary: string | null }>()
		expect(session?.ended_at).toBeTypeOf('number')
		expect(session?.summary).toBeTruthy()

		const memories = await env.FERMI_DB.prepare('SELECT kind, body FROM memory').all<{
			kind: string
			body: string
		}>()
		expect(memories.results).toContainEqual({ kind: 'fact', body: 'User prefers teal' })
	})

	it('leaves active channel sessions open', async () => {
		await logChannelMessage(env.FERMI_DB, 'tg', '99', 'user', 'just now')

		await handleConsolidation(stubEnv)

		const session = await env.FERMI_DB.prepare(
			"SELECT ended_at FROM sessions WHERE host = 'tg:99'",
		).first<{ ended_at: number | null }>()
		expect(session?.ended_at).toBeNull()
	})
})
