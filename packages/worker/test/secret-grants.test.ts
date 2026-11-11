import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerBox, updateBox } from '../src/lib/fleet-store.ts'
import { isSecretGrantedToBox } from '../src/lib/secret-grants.ts'
import { applyMigrations, clearFleet } from './setup-d1.ts'

// Edge-case matrix for MCP-28: per-box / per-mission grants for secret_resolve.

const db = () => env.FERMI_DB

async function grant(name: string, to: { boxId?: string; agentId?: string }, scope = 'app') {
	await db()
		.prepare(
			'INSERT INTO secret_grants (secret_name, scope, box_id, agent_id, created_at) VALUES (?1, ?2, ?3, ?4, 0)',
		)
		.bind(name, scope, to.boxId ?? null, to.agentId ?? null)
		.run()
}

async function setMission(boxId: string, agentId: string) {
	await db()
		.prepare('UPDATE boxes SET meta = ?1 WHERE box_id = ?2')
		.bind(JSON.stringify({ agent_id: agentId }), boxId)
		.run()
}

describe('secret grants', () => {
	beforeAll(applyMigrations)
	beforeEach(async () => {
		await clearFleet()
		await db().prepare('DELETE FROM secret_grants').run()
		await registerBox(db(), { boxId: 'box-a', meta: { agent_id: 'mission-1' } })
		await registerBox(db(), { boxId: 'box-b', meta: { agent_id: 'mission-2' } })
	})

	it('no grant rows: migrations seed none and every box is denied', async () => {
		const row = await db().prepare('SELECT COUNT(*) AS n FROM secret_grants').first<{ n: number }>()
		expect(row?.n).toBe(0)
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(false)
	})

	it('grants by box id to that box only', async () => {
		await grant('EXAMPLE_SECRET', { boxId: 'box-a' })
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(true)
		expect(await isSecretGrantedToBox(db(), 'box-b', 'EXAMPLE_SECRET', 'app')).toBe(false)
		// the grant is per scope
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'user')).toBe(false)
	})

	it('unauthenticated (no box id) or unknown box is denied', async () => {
		await grant('EXAMPLE_SECRET', { boxId: 'box-a' })
		expect(await isSecretGrantedToBox(db(), null, 'EXAMPLE_SECRET', 'app')).toBe(false)
		expect(await isSecretGrantedToBox(db(), '', 'EXAMPLE_SECRET', 'app')).toBe(false)
		expect(await isSecretGrantedToBox(db(), 'box-ghost', 'EXAMPLE_SECRET', 'app')).toBe(false)
	})

	it('destroyed box: a granted box loses access once destroyed', async () => {
		await grant('EXAMPLE_SECRET', { boxId: 'box-a' })
		await grant('EXAMPLE_SECRET', { agentId: 'mission-1' })
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(true)
		await updateBox(db(), 'box-a', { status: 'destroyed', destroyedAt: Date.now() })
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(false)
	})

	it('secret renamed: a grant on the old name does not cover the new name', async () => {
		await grant('EXAMPLE_OLD', { boxId: 'box-a' })
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_NEW', 'app')).toBe(false)
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_OLD', 'app')).toBe(true)
	})

	it('mission changed mid-session: access follows the current mission', async () => {
		await grant('EXAMPLE_SECRET', { agentId: 'mission-1' })
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(true)
		expect(await isSecretGrantedToBox(db(), 'box-b', 'EXAMPLE_SECRET', 'app')).toBe(false)
		await setMission('box-a', 'mission-3')
		expect(await isSecretGrantedToBox(db(), 'box-a', 'EXAMPLE_SECRET', 'app')).toBe(false)
		await setMission('box-b', 'mission-1')
		expect(await isSecretGrantedToBox(db(), 'box-b', 'EXAMPLE_SECRET', 'app')).toBe(true)
	})

	it('a grant row names exactly one principal', async () => {
		await expect(grant('EXAMPLE_SECRET', {})).rejects.toThrow()
		await expect(
			grant('EXAMPLE_SECRET', { boxId: 'box-a', agentId: 'mission-1' }),
		).rejects.toThrow()
	})
})
