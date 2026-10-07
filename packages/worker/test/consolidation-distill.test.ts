import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fallbackSummary, handleConsolidation } from '../src/cron/consolidation.ts'
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

	it('writes a fallback summary when the AI binding fails, and retries old unsummarized sessions', async () => {
		await logChannelMessage(
			env.FERMI_DB,
			'wa',
			'g@g.us',
			'user',
			'did you say the museum opens at nine?',
		)
		await logChannelMessage(env.FERMI_DB, 'wa', 'g@g.us', 'assistant', 'yes, nine on weekdays')
		// Ended three days ago, never summarized (outside the old 24h window).
		await env.FERMI_DB.prepare('UPDATE messages SET created_at = ?1')
			.bind(Date.now() - 3 * 86_400_000)
			.run()
		await env.FERMI_DB.prepare('UPDATE sessions SET ended_at = ?1')
			.bind(Date.now() - 3 * 86_400_000)
			.run()

		const brokenAi = {
			...env,
			AI: {
				run: async () => {
					throw new Error('ai down')
				},
			},
		} as unknown as Env
		await handleConsolidation(brokenAi)

		const session = await env.FERMI_DB.prepare(
			"SELECT summary FROM sessions WHERE host = 'wa:g@g.us'",
		).first<{
			summary: string | null
		}>()
		expect(session?.summary).toContain('auto-excerpt')
		expect(session?.summary).toContain('museum opens at nine')
	})

	it('fallbackSummary keeps the last turns, trimmed', () => {
		const text = fallbackSummary(
			Array.from({ length: 10 }, (_, i) => ({
				role: 'user',
				body: `turn ${i} ${'x'.repeat(300)}`,
			})),
			{ started_at: 0, ended_at: 86_400_000 },
		)
		expect(text).toContain('10 messages, 1970-01-01 to 1970-01-02')
		expect(text).toContain('turn 4')
		expect(text).not.toContain('turn 3 ')
		expect(text.length).toBeLessThan(1200)
	})
})
