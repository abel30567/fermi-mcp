export const PROFILE_BUDGETS: Record<ProfileTarget, number> = {
	agent: 2200,
	user: 1375,
}

export type ProfileTarget = 'agent' | 'user'
export type ProfileAction = 'add' | 'replace' | 'remove'

export interface ProfileDoc {
	body: string
	usage: number
	limit: number
}

export type ProfileUpdateResult =
	| { ok: true; usage: number; limit: number }
	| { ok: false; error: string; usage?: number; limit?: number }

export async function getProfileDocs(db: D1Database): Promise<Record<ProfileTarget, ProfileDoc>> {
	const { results } = await db
		.prepare('SELECT name, body FROM profile_docs')
		.all<{ name: ProfileTarget; body: string }>()
	const bodies: Record<ProfileTarget, string> = { agent: '', user: '' }
	for (const row of results) bodies[row.name] = row.body
	return {
		agent: { body: bodies.agent, usage: bodies.agent.length, limit: PROFILE_BUDGETS.agent },
		user: { body: bodies.user, usage: bodies.user.length, limit: PROFILE_BUDGETS.user },
	}
}

/**
 * Curated add/replace/remove editing with a hard budget: an over-budget write
 * returns an error (never truncates) so the agent consolidates and retries.
 */
export async function updateProfileDoc(
	db: D1Database,
	input: { target: ProfileTarget; action: ProfileAction; content?: string; match?: string },
): Promise<ProfileUpdateResult> {
	const limit = PROFILE_BUDGETS[input.target]
	const row = await db
		.prepare('SELECT body FROM profile_docs WHERE name = ?1')
		.bind(input.target)
		.first<{ body: string }>()
	const current = row?.body ?? ''

	let next: string
	if (input.action === 'add') {
		const content = input.content?.trim()
		if (!content) return { ok: false, error: 'content_required' }
		if (current.split('\n').includes(content)) return { ok: false, error: 'duplicate_entry' }
		next = current ? `${current}\n${content}` : content
	} else {
		const match = input.match
		if (!match) return { ok: false, error: 'match_required' }
		if (!current.includes(match)) return { ok: false, error: 'match_not_found' }
		if (input.action === 'replace') {
			const content = input.content?.trim()
			if (!content) return { ok: false, error: 'content_required' }
			// Replace the whole matched line (entry), not the substring itself
			let replaced = false
			next = current
				.split('\n')
				.map((line) => {
					if (!replaced && line.includes(match)) {
						replaced = true
						return content
					}
					return line
				})
				.join('\n')
		} else {
			next = current
				.split('\n')
				.filter((line) => !line.includes(match))
				.join('\n')
		}
	}

	next = next.trim()
	if (next.length > limit) {
		return { ok: false, error: 'over_budget', usage: next.length, limit }
	}

	await db
		.prepare(
			`INSERT INTO profile_docs (name, body, updated_at) VALUES (?1, ?2, ?3)
			 ON CONFLICT(name) DO UPDATE SET body = ?2, updated_at = ?3`,
		)
		.bind(input.target, next, Date.now())
		.run()
	return { ok: true, usage: next.length, limit }
}
