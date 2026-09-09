import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	addToAllowlist,
	isAllowed,
	listAllowlist,
	removeFromAllowlist,
} from '../src/lib/allowlist-store.ts'
import { clearAllowlist, clearTasks, setupAllowlistSchema, setupTasksSchema } from './setup-d1.ts'

const db = env.FERMI_DB

async function seedTask(sender: string, createdAt: number, channel = 'tg') {
	await db
		.prepare(
			'INSERT INTO tasks (id, channel, sender, chat_id, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
		)
		.bind(crypto.randomUUID(), channel, sender, 'chat', 'hi', createdAt)
		.run()
}

beforeAll(async () => {
	await setupTasksSchema()
	await setupAllowlistSchema()
})

describe('allowlist-store', () => {
	beforeEach(async () => {
		await clearAllowlist()
		await clearTasks()
	})

	it('adds idempotently (double add keeps one row)', async () => {
		await addToAllowlist(db, { channel: 'tg', senderId: '42', note: 'first' })
		await addToAllowlist(db, { channel: 'tg', senderId: '42', note: 'second' })
		const row = await db
			.prepare('SELECT COUNT(*) AS n, note FROM allowlist WHERE channel = ? AND sender_id = ?')
			.bind('tg', '42')
			.first<{ n: number; note: string }>()
		expect(row?.n).toBe(1)
		expect(row?.note).toBe('second')
	})

	it('reports membership via isAllowed', async () => {
		await addToAllowlist(db, { channel: 'wa', senderId: '15551234567' })
		expect(await isAllowed(db, 'wa', '15551234567')).toBe(true)
		expect(await isAllowed(db, 'wa', '99999')).toBe(false)
		expect(await isAllowed(db, 'tg', '15551234567')).toBe(false)
	})

	it('allowlists a discord guild id and lists it with usage stats', async () => {
		const now = 2_000_000_000_000
		const guildId = '974519864045756456'
		await addToAllowlist(db, { channel: 'dc', senderId: guildId, note: 'my server' })
		expect(await isAllowed(db, 'dc', guildId)).toBe(true)
		expect(await isAllowed(db, 'dc', 'other-guild')).toBe(false)

		// Guild tasks store the bare author id in tasks.sender, not the guild id,
		// so the entry lists with zero usage until a member is joined by author.
		const entries = await listAllowlist(db, now)
		const dc = entries.find((e) => e.channel === 'dc' && e.sender_id === guildId)
		expect(dc).toMatchObject({ note: 'my server', tasks_total: 0, tasks_7d: 0 })
		expect(dc?.last_used_at).toBeNull()
	})

	it('removes a row and reports not_found otherwise', async () => {
		await addToAllowlist(db, { channel: 'tg', senderId: '42' })
		expect(await removeFromAllowlist(db, 'tg', '42')).toEqual({ ok: true })
		expect(await isAllowed(db, 'tg', '42')).toBe(false)
		expect(await removeFromAllowlist(db, 'tg', '42')).toEqual({ ok: false, error: 'not_found' })
	})

	it('lists entries with usage stats ordered by tasks_total', async () => {
		const now = 2_000_000_000_000
		const dayMs = 86_400_000
		await addToAllowlist(db, { channel: 'tg', senderId: 'heavy', note: 'owner', addedBy: 'seed' })
		await addToAllowlist(db, { channel: 'tg', senderId: 'light' })

		// heavy: 3 tasks, only the newest within 7 days of `now`.
		await seedTask('heavy', now - 20 * dayMs)
		await seedTask('heavy', now - 10 * dayMs)
		await seedTask('heavy', now - 1 * dayMs)
		// light: 1 old task, none within 7 days.
		await seedTask('light', now - 30 * dayMs)

		const entries = await listAllowlist(db, now)
		expect(entries.map((e) => e.sender_id)).toEqual(['heavy', 'light'])

		const heavy = entries[0]
		expect(heavy).toMatchObject({ channel: 'tg', note: 'owner', added_by: 'seed' })
		expect(heavy.tasks_total).toBe(3)
		expect(heavy.tasks_7d).toBe(1)
		expect(heavy.last_used_at).toBe(now - 1 * dayMs)

		const light = entries[1]
		expect(light.tasks_total).toBe(1)
		expect(light.tasks_7d).toBe(0)
		expect(light.last_used_at).toBe(now - 30 * dayMs)
	})
})
