import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isAllowed } from '../src/lib/allowlist-store.ts'
import { approvePairing } from '../src/lib/pairing.ts'
import { clearAllowlist, setupAllowlistSchema, setupTasksSchema } from './setup-d1.ts'

const KV_ALLOWLIST_KEY = 'channel:tg:allowlist'
const workerEnv = env as unknown as Env

beforeAll(async () => {
	await setupTasksSchema()
	await setupAllowlistSchema()
})

describe('approvePairing', () => {
	beforeEach(async () => {
		await clearAllowlist()
		await env.FERMI_KV.delete(KV_ALLOWLIST_KEY)
	})

	it('adds the sender to the D1 allowlist and consumes the code', async () => {
		await env.FERMI_KV.put(
			'pairing:ABCD1234',
			JSON.stringify({ channel: 'tg', senderId: '42', chatId: '99' }),
		)
		const result = await approvePairing(workerEnv, 'abcd1234')
		expect(result).toEqual({ ok: true, channel: 'tg', senderId: '42', chatId: '99' })
		expect(await isAllowed(env.FERMI_DB, 'tg', '42')).toBe(true)
		expect(await env.FERMI_KV.get('pairing:ABCD1234')).toBeNull()
		// The legacy KV allowlist key is no longer written.
		expect(await env.FERMI_KV.get(KV_ALLOWLIST_KEY)).toBeNull()
	})

	it('adds a wa sender to the wa allowlist', async () => {
		await env.FERMI_KV.put(
			'pairing:WACODE01',
			JSON.stringify({ channel: 'wa', senderId: '15557778888', chatId: '15557778888' }),
		)
		const result = await approvePairing(workerEnv, 'wacode01')
		expect(result).toEqual({
			ok: true,
			channel: 'wa',
			senderId: '15557778888',
			chatId: '15557778888',
		})
		expect(await isAllowed(env.FERMI_DB, 'wa', '15557778888')).toBe(true)
		expect(await isAllowed(env.FERMI_DB, 'tg', '15557778888')).toBe(false)
		expect(await env.FERMI_KV.get('pairing:WACODE01')).toBeNull()
	})

	it('rejects an unknown or expired code', async () => {
		const result = await approvePairing(workerEnv, 'NOPE0000')
		expect(result).toEqual({ ok: false, error: 'invalid_or_expired_code' })
	})

	it('is idempotent for an already-allowlisted sender', async () => {
		await env.FERMI_KV.put(
			'pairing:CODE0001',
			JSON.stringify({ channel: 'tg', senderId: '42', chatId: '99' }),
		)
		await approvePairing(workerEnv, 'CODE0001')
		await env.FERMI_KV.put(
			'pairing:CODE0002',
			JSON.stringify({ channel: 'tg', senderId: '42', chatId: '99' }),
		)
		const result = await approvePairing(workerEnv, 'CODE0002')
		expect(result.ok).toBe(true)
		const row = await env.FERMI_DB.prepare(
			'SELECT COUNT(*) AS n FROM allowlist WHERE channel = ? AND sender_id = ?',
		)
			.bind('tg', '42')
			.first<{ n: number }>()
		expect(row?.n).toBe(1)
	})
})
