import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { seedSkills } from '../../scripts/eval-db.mjs'
import fixture from '../fixtures/eval/sample.json'
import { McpClient, resultJson } from './mcp-client.ts'

// eval-seed.mjs runs seedSkills against the running eval worker's /mcp; here it
// runs against the real worker entry over SELF.fetch.
describe('eval seed: skills via skill_set', () => {
	it('seeds the fixture skills so skill_load returns their bodies', async () => {
		await seedSkills(fixture.skills, 'http://fermi.test/mcp', (url: string, init: RequestInit) =>
			SELF.fetch(url, init),
		)

		const client = new McpClient()
		await client.initialize()
		const loaded = resultJson(await client.callTool('skill_load', { slug: 'household-finance' }))
		expect(JSON.stringify(loaded)).toContain('Eval stub. Answer budget and bill questions')
		const row = await env.FERMI_DB.prepare('SELECT name, source FROM skills WHERE slug = ?')
			.bind('household-finance')
			.first()
		expect(row).toEqual({ name: 'Household finance', source: 'manual' })
	})

	it('fails loudly when skill_set rejects a skill', async () => {
		await expect(
			seedSkills([{ slug: 'no-body' }], 'http://fermi.test/mcp', (url: string, init: RequestInit) =>
				SELF.fetch(url, init),
			),
		).rejects.toThrow()
	})
})
