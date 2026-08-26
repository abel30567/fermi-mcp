import { sendSlackMessage } from '../channels/slack.ts'
import { sendTelegramMessage } from '../channels/telegram.ts'

export async function handleDailyBrief(env: Env) {
	const oneDayAgo = Date.now() - 86_400_000

	// Get last 24h memories
	const memories = await env.FERMI_DB.prepare(
		`SELECT body FROM memory
		 WHERE created_at > ?1 AND decayed_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 10`,
	)
		.bind(oneDayAgo)
		.all<{ body: string }>()

	if (memories.results.length === 0) return

	const memoryText = memories.results.map((r) => `- ${r.body}`).join('\n')

	// Summarize with Workers AI
	let summary: string
	try {
		const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{
					role: 'system',
					content:
						'Summarize these recent memories as a concise daily briefing. Use bullet points.',
				},
				{
					role: 'user',
					content: `Recent memories:\n${memoryText}`,
				},
			],
		})
		if (result && typeof result === 'object' && 'response' in result) {
			summary = result.response as string
		} else {
			return
		}
	} catch {
		return
	}

	const briefText = `Daily Brief:\n${summary}`

	// Post to configured channel
	const channel = (await env.FERMI_KV.get('config:daily_brief:channel')) || 'tg'
	const chatId = await env.FERMI_KV.get('config:daily_brief:chat_id')

	if (channel === 'tg' && chatId) {
		await sendTelegramMessage(env, chatId, briefText)
	} else if (channel === 'slack') {
		const slackChannel = await env.FERMI_KV.get('config:daily_brief:slack_channel')
		if (slackChannel) {
			await sendSlackMessage(env, slackChannel, briefText)
		}
	}
}
