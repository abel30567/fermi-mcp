import { registerAllCapabilities } from '../capabilities/index.ts'
import { getCapabilityRegistry } from '../lib/capability.ts'
import { embedText } from '../lib/embeddings.ts'
import { listActiveSkills } from '../lib/skills-store.ts'

export interface ReindexResult {
	upserted: number
	failed: number
	offline: boolean
	failures: Array<{ name: string; error: string }>
}

export async function handleCapabilityReindex(env: Env): Promise<ReindexResult> {
	registerAllCapabilities()
	const result: ReindexResult = { upserted: 0, failed: 0, offline: false, failures: [] }
	if (!env.FERMI_VECTORIZE) {
		result.failed = getCapabilityRegistry().length
		result.failures.push({ name: '*', error: 'FERMI_VECTORIZE binding not configured' })
		return result
	}

	const vectors: VectorizeVector[] = []
	for (const cap of getCapabilityRegistry()) {
		const text = [
			cap.name,
			cap.domain,
			cap.description,
			...(cap.keywords ?? []),
			...(cap.tags ?? []),
		]
			.filter(Boolean)
			.join(' ')
		const { vector, offline, error } = await embedText(text, env)
		if (offline) {
			result.offline = true
			if (error) result.failures.push({ name: cap.name, error })
		}
		vectors.push({
			id: `capability:${cap.name}`,
			values: vector,
			metadata: {
				name: cap.name,
				domain: cap.domain,
				risk: cap.risk,
				readOnly: cap.readOnly ?? false,
				description: cap.description,
			},
		})
	}

	// Backfill skill vectors alongside capabilities (write-time indexing in
	// upsertSkill is best-effort; this cron repairs any gaps).
	try {
		for (const skill of await listActiveSkills(env)) {
			const text = [skill.name, skill.description ?? '', ...skill.keywords]
				.filter(Boolean)
				.join(' ')
			const { vector, offline, error } = await embedText(text, env)
			if (offline) {
				result.offline = true
				if (error) result.failures.push({ name: `skill:${skill.slug}`, error })
			}
			vectors.push({
				id: `skill:${skill.slug}`,
				values: vector,
				metadata: {
					slug: skill.slug,
					name: skill.name,
					description: skill.description ?? '',
				},
			})
		}
	} catch (err) {
		result.failures.push({
			name: 'skills:*',
			error: err instanceof Error ? err.message : 'skill_listing_failed',
		})
	}

	if (vectors.length === 0) return result
	try {
		await env.FERMI_VECTORIZE.upsert(vectors)
		result.upserted = vectors.length
	} catch (err) {
		result.failed = vectors.length
		result.failures.push({
			name: '*',
			error: err instanceof Error ? err.message : 'upsert_failed',
		})
	}
	return result
}
