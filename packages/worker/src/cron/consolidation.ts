import { writeMemory } from '../lib/memory-store.ts'
import { pruneSentOutbox } from '../lib/outbox-store.ts'

const DAY_MS = 86_400_000
const DECAY_DAYS = 90
const SIMILARITY_THRESHOLD = 0.95
const CHANNEL_SESSION_IDLE_MS = 2 * 3_600_000

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0
	let magA = 0
	let magB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		magA += a[i] * a[i]
		magB += b[i] * b[i]
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB)
	return denom === 0 ? 0 : dot / denom
}

export async function handleConsolidation(env: Env) {
	const db = env.FERMI_DB
	const now = Date.now()
	const oneDayAgo = now - DAY_MS

	// 0. Daily reset: close idle open channel sessions so step 1 summarizes
	// them and the next inbound message starts a fresh session.
	await db
		.prepare(
			`UPDATE sessions SET ended_at = ?1
			 WHERE ended_at IS NULL AND (host LIKE 'tg:%' OR host LIKE 'wa:%' OR host LIKE 'dc:%')
			   AND id IN (SELECT session_id FROM messages GROUP BY session_id HAVING MAX(created_at) < ?2)`,
		)
		.bind(now, now - CHANNEL_SESSION_IDLE_MS)
		.run()

	// 1. Summarize sessions ended in the last 24h without a summary
	const unsummarized = await db
		.prepare(
			`SELECT s.id, s.host, s.started_at, s.ended_at
			 FROM sessions s
			 WHERE s.ended_at IS NOT NULL
			   AND s.ended_at > ?1
			   AND s.summary IS NULL`,
		)
		.bind(oneDayAgo)
		.all<{ id: string; host: string; started_at: number; ended_at: number }>()

	for (const session of unsummarized.results) {
		const messages = await db
			.prepare('SELECT role, body FROM messages WHERE session_id = ?1 ORDER BY created_at ASC')
			.bind(session.id)
			.all<{ role: string; body: string }>()

		if (messages.results.length === 0) continue

		let summary: string | null = null
		try {
			const transcript = messages.results
				.map((m) => `${m.role}: ${m.body}`)
				.join('\n')
				.slice(0, 4000)

			const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
				messages: [
					{
						role: 'system',
						content:
							'Summarize this conversation in 2-3 sentences. Focus on key decisions, facts learned, and action items.',
					},
					{ role: 'user', content: transcript },
				],
			})
			if (aiResult && typeof aiResult === 'object' && 'response' in aiResult) {
				summary = aiResult.response as string
			}
		} catch {
			// AI binding unavailable (local dev) - skip summarization
		}

		if (summary) {
			await db
				.prepare('UPDATE sessions SET summary = ?1 WHERE id = ?2')
				.bind(summary, session.id)
				.run()
		}

		// Distill durable facts from channel conversations into long-term memory
		// (unpinned — normal decay/dedup below acts as the promotion gate).
		if (
			session.host.startsWith('tg:') ||
			session.host.startsWith('wa:') ||
			session.host.startsWith('dc:')
		) {
			try {
				const transcript = messages.results
					.map((m) => `${m.role}: ${m.body}`)
					.join('\n')
					.slice(0, 4000)
				const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
					messages: [
						{
							role: 'system',
							content:
								'Extract 0-3 durable facts about the user from this conversation: preferences, corrections, and recurring patterns only. Skip trivia, one-off task details, and anything ephemeral. Return a JSON array of strings, [] if nothing qualifies. Return ONLY the JSON array.',
						},
						{ role: 'user', content: transcript },
					],
				})
				if (aiResult && typeof aiResult === 'object' && 'response' in aiResult) {
					const match = /\[[\s\S]*\]/.exec(String(aiResult.response))
					const facts = match ? (JSON.parse(match[0]) as string[]) : []
					for (const body of facts.slice(0, 3)) {
						if (typeof body === 'string' && body.trim()) {
							await writeMemory({ kind: 'fact', body: body.trim() }, env)
						}
					}
				}
			} catch {
				// AI unavailable or unparseable output - skip distillation for this session
			}
		}
	}

	// 2. Dedup memories by embedding cosine similarity
	const withEmbeddings = await db
		.prepare('SELECT id, embedding FROM memory WHERE embedding IS NOT NULL AND decayed_at IS NULL')
		.all<{ id: number; embedding: ArrayBuffer }>()

	const entries = withEmbeddings.results
		.map((row) => ({
			id: row.id,
			vec: new Float32Array(row.embedding),
		}))
		.filter((e) => e.vec.length > 0)

	const decayedIds = new Set<number>()
	for (let i = 0; i < entries.length; i++) {
		if (decayedIds.has(entries[i].id)) continue
		for (let j = i + 1; j < entries.length; j++) {
			if (decayedIds.has(entries[j].id)) continue
			const sim = cosineSimilarity(entries[i].vec, entries[j].vec)
			if (sim >= SIMILARITY_THRESHOLD) {
				decayedIds.add(entries[j].id)
			}
		}
	}

	if (decayedIds.size > 0) {
		const placeholders = [...decayedIds].map((_, i) => `?${i + 2}`).join(', ')
		await db
			.prepare(`UPDATE memory SET decayed_at = ?1 WHERE id IN (${placeholders}) AND pinned = 0`)
			.bind(now, ...[...decayedIds])
			.run()
	}

	// 3. Decay old non-pinned memories (> 90 days)
	const cutoff = now - DECAY_DAYS * DAY_MS
	await db
		.prepare(
			'UPDATE memory SET decayed_at = ?1 WHERE pinned = 0 AND decayed_at IS NULL AND created_at < ?2',
		)
		.bind(now, cutoff)
		.run()

	// 4. Prune outbox rows the bridge already delivered.
	await pruneSentOutbox(db)
}
