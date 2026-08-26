import { upsertSkill } from '../lib/skills-store.ts'

const WEEK_MS = 7 * 86_400_000
const MIN_SESSIONS = 3

export async function handleSkillDistillation(env: Env) {
	const sessions = await env.FERMI_DB.prepare(
		'SELECT id, summary FROM sessions WHERE ended_at > ? AND summary IS NOT NULL',
	)
		.bind(Date.now() - WEEK_MS)
		.all<{ id: string; summary: string }>()

	if (sessions.results.length < MIN_SESSIONS) return

	const summaries = sessions.results.map((s) => s.summary).join('\n---\n')

	let response: string | null = null
	try {
		const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{
					role: 'user',
					content: `Analyze these session summaries and identify repeated patterns that could become reusable skills. For each pattern, output a skill name and description:\n\n${summaries}`,
				},
			],
		})
		if (result && typeof result === 'object' && 'response' in result) {
			response = result.response as string
		}
	} catch {
		// Workers AI unavailable
	}

	if (!response) return

	const slug = `skill-${Date.now()}`
	await upsertSkill(
		{
			slug,
			body: `# Proposed Skill\n\n${response}`,
			metadata: {
				name: 'Auto-proposed skill',
				description: response.slice(0, 200),
			},
			source: 'hermes',
		},
		env,
	)
}
