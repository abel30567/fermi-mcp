import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	ackOutbox,
	enqueueOutbound,
	listPendingOutbox,
	pruneSentOutbox,
} from '../src/lib/outbox-store.ts'
import { clearOutbox, setupOutboxSchema } from './setup-d1.ts'

const db = env.FERMI_DB

beforeAll(async () => {
	await setupOutboxSchema()
})

beforeEach(async () => {
	await clearOutbox()
})

describe('enqueueOutbound', () => {
	it('inserts a pending row', async () => {
		const { id, created_at } = await enqueueOutbound(db, {
			channel: 'wa',
			chatId: '123',
			body: 'hello',
		})
		expect(id).toBeTruthy()
		expect(created_at).toBeTypeOf('number')
		const row = await db
			.prepare('SELECT channel, chat_id, body, status, sent_at FROM outbox WHERE id = ?1')
			.bind(id)
			.first<{
				channel: string
				chat_id: string
				body: string
				status: string
				sent_at: number | null
			}>()
		expect(row).toMatchObject({
			channel: 'wa',
			chat_id: '123',
			body: 'hello',
			status: 'pending',
			sent_at: null,
		})
	})
})

describe('listPendingOutbox', () => {
	it('returns pending rows oldest-first, channel-filtered, excluding sent', async () => {
		const a = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'first' })
		await new Promise((r) => setTimeout(r, 2))
		const b = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'second' })
		await enqueueOutbound(db, { channel: 'tg', chatId: '9', body: 'other channel' })
		// Mark one sent so it is excluded.
		const c = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'already sent' })
		await ackOutbox(db, [c.id])

		const pending = await listPendingOutbox(db, 'wa', 10)
		expect(pending.map((p) => p.id)).toEqual([a.id, b.id])
		expect(pending[0]).toMatchObject({ chat_id: '1', body: 'first' })
	})

	it('clamps the limit', async () => {
		for (let i = 0; i < 5; i++) {
			await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: `m${i}` })
		}
		const pending = await listPendingOutbox(db, 'wa', 2)
		expect(pending).toHaveLength(2)
	})
})

describe('ackOutbox', () => {
	it('flips pending rows to sent and stamps sent_at', async () => {
		const a = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'x' })
		const { acked } = await ackOutbox(db, [a.id])
		expect(acked).toBe(1)
		const row = await db
			.prepare('SELECT status, sent_at FROM outbox WHERE id = ?1')
			.bind(a.id)
			.first<{ status: string; sent_at: number | null }>()
		expect(row?.status).toBe('sent')
		expect(row?.sent_at).toBeTypeOf('number')
	})

	it('is a no-op for unknown or already-sent ids', async () => {
		const a = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'x' })
		await ackOutbox(db, [a.id])
		const again = await ackOutbox(db, [a.id])
		expect(again.acked).toBe(0)
		const unknown = await ackOutbox(db, ['does-not-exist'])
		expect(unknown.acked).toBe(0)
	})
})

describe('pruneSentOutbox', () => {
	it('deletes only old sent rows', async () => {
		const oldSent = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'old' })
		const recentSent = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'recent' })
		const pending = await enqueueOutbound(db, { channel: 'wa', chatId: '1', body: 'pending' })
		await ackOutbox(db, [oldSent.id, recentSent.id])
		// Backdate the old sent row well past the retention window.
		await db
			.prepare('UPDATE outbox SET sent_at = ?1 WHERE id = ?2')
			.bind(Date.now() - 8 * 86_400_000, oldSent.id)
			.run()

		await pruneSentOutbox(db)

		const remaining = await db
			.prepare('SELECT id FROM outbox ORDER BY created_at ASC')
			.all<{ id: string }>()
		expect(remaining.results.map((r) => r.id).sort()).toEqual([recentSent.id, pending.id].sort())
	})
})
