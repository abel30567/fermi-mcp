import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PROFILE_BUDGETS, getProfileDocs, updateProfileDoc } from '../src/lib/profile-store.ts'
import { clearProfile, setupProfileSchema } from './setup-d1.ts'

describe('profile-store', () => {
	beforeAll(async () => {
		await setupProfileSchema()
	})

	beforeEach(async () => {
		await clearProfile()
	})

	it('adds, replaces, and removes lines', async () => {
		expect(
			(
				await updateProfileDoc(env.FERMI_DB, {
					target: 'user',
					action: 'add',
					content: 'likes teal',
				})
			).ok,
		).toBe(true)
		await updateProfileDoc(env.FERMI_DB, { target: 'user', action: 'add', content: 'uses zsh' })

		await updateProfileDoc(env.FERMI_DB, {
			target: 'user',
			action: 'replace',
			match: 'teal',
			content: 'likes crimson',
		})
		let docs = await getProfileDocs(env.FERMI_DB)
		expect(docs.user.body).toContain('likes crimson')
		expect(docs.user.body).not.toContain('teal')

		await updateProfileDoc(env.FERMI_DB, { target: 'user', action: 'remove', match: 'zsh' })
		docs = await getProfileDocs(env.FERMI_DB)
		expect(docs.user.body).toBe('likes crimson')
	})

	it('enforces the budget with over_budget instead of truncating', async () => {
		const limit = PROFILE_BUDGETS.user
		const fits = 'x'.repeat(limit)
		expect(
			(await updateProfileDoc(env.FERMI_DB, { target: 'user', action: 'add', content: fits })).ok,
		).toBe(true)

		const overflow = await updateProfileDoc(env.FERMI_DB, {
			target: 'user',
			action: 'add',
			content: 'one more line',
		})
		expect(overflow).toMatchObject({ ok: false, error: 'over_budget', limit })
		const docs = await getProfileDocs(env.FERMI_DB)
		expect(docs.user.body).toBe(fits)
	})

	it('applies separate budgets per doc', async () => {
		const agentSized = 'x'.repeat(PROFILE_BUDGETS.user + 1)
		expect(
			(
				await updateProfileDoc(env.FERMI_DB, {
					target: 'agent',
					action: 'add',
					content: agentSized,
				})
			).ok,
		).toBe(true)
	})

	it('rejects duplicate adds and unknown matches', async () => {
		await updateProfileDoc(env.FERMI_DB, {
			target: 'agent',
			action: 'add',
			content: 'repo uses bun',
		})
		expect(
			await updateProfileDoc(env.FERMI_DB, {
				target: 'agent',
				action: 'add',
				content: 'repo uses bun',
			}),
		).toEqual({ ok: false, error: 'duplicate_entry' })
		expect(
			await updateProfileDoc(env.FERMI_DB, {
				target: 'agent',
				action: 'replace',
				match: 'nope',
				content: 'x',
			}),
		).toEqual({ ok: false, error: 'match_not_found' })
		expect(
			await updateProfileDoc(env.FERMI_DB, { target: 'agent', action: 'remove', match: 'nope' }),
		).toEqual({ ok: false, error: 'match_not_found' })
	})
})
