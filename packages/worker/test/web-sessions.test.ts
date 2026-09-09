import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	captureWebSession,
	getWebSessionMeta,
	invalidateWebSession,
	leaseWebSession,
	releaseWebSession,
} from '../src/lib/web-session-store.ts'
import { clearWebSessions, setupWebSessionSchema } from './setup-d1.ts'

const STATE = JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }], origins: [] })

describe('web session vault', () => {
	beforeAll(async () => {
		await setupWebSessionSchema()
	})
	beforeEach(async () => {
		await clearWebSessions()
	})

	it('captures encrypted (metadata never leaks the state) and leases decrypt it', async () => {
		await captureWebSession(env, {
			name: 'chatgpt',
			site: 'https://chatgpt.com',
			storageState: STATE,
			maxConcurrent: 2,
		})
		const meta = await getWebSessionMeta(env, 'chatgpt')
		expect(meta).toMatchObject({ name: 'chatgpt', max_concurrent: 2, active_leases: 0 })
		expect(JSON.stringify(meta)).not.toContain('abc') // ciphertext only at rest

		const lease = await leaseWebSession(env, 'chatgpt', 'box-a')
		expect(lease.ok).toBe(true)
		expect(lease.storage_state).toBe(STATE)
		expect(lease.site).toBe('https://chatgpt.com')
	})

	it('enforces max_concurrent across boxes and frees a slot on release', async () => {
		await captureWebSession(env, { name: 's', site: 'x', storageState: STATE, maxConcurrent: 2 })
		const a = await leaseWebSession(env, 's', 'box-a')
		const b = await leaseWebSession(env, 's', 'box-b')
		expect(a.ok && b.ok).toBe(true)
		const c = await leaseWebSession(env, 's', 'box-c')
		expect(c).toMatchObject({ ok: false, error: 'concurrency_cap_reached' })

		expect((await releaseWebSession(env, a.lease_id as string)).ok).toBe(true)
		const cRetry = await leaseWebSession(env, 's', 'box-c')
		expect(cRetry.ok).toBe(true)
	})

	it('re-leases idempotently for a box already holding a live lease', async () => {
		await captureWebSession(env, { name: 's', site: 'x', storageState: STATE, maxConcurrent: 1 })
		const first = await leaseWebSession(env, 's', 'box-a')
		const again = await leaseWebSession(env, 's', 'box-a')
		expect(again.ok).toBe(true)
		expect(again.lease_id).toBe(first.lease_id)
		expect(await getWebSessionMeta(env, 's').then((m) => m?.active_leases)).toBe(1)
	})

	it('respects allowed_boxes scoping', async () => {
		await captureWebSession(env, {
			name: 's',
			site: 'x',
			storageState: STATE,
			allowedBoxes: ['box-ok'],
		})
		expect((await leaseWebSession(env, 's', 'box-nope')).error).toBe('box_not_allowed')
		expect((await leaseWebSession(env, 's', 'box-ok')).ok).toBe(true)
	})

	it('invalidate revokes and cascades: active leases released, future leases refused', async () => {
		await captureWebSession(env, { name: 's', site: 'x', storageState: STATE, maxConcurrent: 3 })
		await leaseWebSession(env, 's', 'box-a')
		await leaseWebSession(env, 's', 'box-b')
		expect(await getWebSessionMeta(env, 's').then((m) => m?.active_leases)).toBe(2)

		expect((await invalidateWebSession(env, 's')).ok).toBe(true)
		expect(await getWebSessionMeta(env, 's').then((m) => m?.active_leases)).toBe(0) // cascade released
		expect((await leaseWebSession(env, 's', 'box-c')).error).toBe('revoked')
	})

	it('refuses expired sessions', async () => {
		await captureWebSession(env, { name: 's', site: 'x', storageState: STATE, ttlSeconds: 1 })
		await env.FERMI_DB.prepare('UPDATE web_sessions SET expires_at = ?1 WHERE name = ?2')
			.bind(Date.now() - 1000, 's')
			.run()
		expect((await leaseWebSession(env, 's', 'box-a')).error).toBe('expired')
	})

	it('re-capture (refresh) clears revocation and replaces state', async () => {
		await captureWebSession(env, { name: 's', site: 'x', storageState: STATE })
		await invalidateWebSession(env, 's')
		const fresh = JSON.stringify({ cookies: [{ name: 'sid', value: 'xyz' }] })
		await captureWebSession(env, { name: 's', site: 'x', storageState: fresh })
		const lease = await leaseWebSession(env, 's', 'box-a')
		expect(lease.ok).toBe(true)
		expect(lease.storage_state).toBe(fresh)
	})
})
