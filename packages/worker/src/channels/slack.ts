import { runAgentTurn } from './inference.ts'

interface SlackEvent {
	type: string
	text?: string
	user?: string
	channel?: string
	bot_id?: string
}

interface SlackPayload {
	type: string
	challenge?: string
	event?: SlackEvent
}

export async function handleSlackWebhook(request: Request, env: Env): Promise<Response> {
	const body = (await request.json()) as SlackPayload

	// URL verification challenge
	if (body.type === 'url_verification') {
		return Response.json({ challenge: body.challenge })
	}

	if (body.event?.type === 'message' && !body.event.bot_id && body.event.text) {
		const text = body.event.text
		const userId = body.event.user ?? ''
		const channel = body.event.channel ?? ''

		// Check allowlist
		const allowlistRaw = await env.FERMI_KV.get('channel:slack:allowlist')
		const allowlist: string[] = allowlistRaw ? JSON.parse(allowlistRaw) : []

		if (!allowlist.includes(userId)) {
			// Pairing flow
			const code = crypto.randomUUID().slice(0, 8).toUpperCase()
			await env.FERMI_KV.put(
				`pairing:${code}`,
				JSON.stringify({ channel: 'slack', senderId: userId, slackChannel: channel }),
				{ expirationTtl: 3600 },
			)
			await sendSlackMessage(
				env,
				channel,
				`Pairing code: ${code}\nAsk the owner to approve this code.`,
			)
			return new Response('ok')
		}

		const response = await runAgentTurn(text, env, { channel: 'slack', slackChannel: channel })
		await sendSlackMessage(env, channel, response)
	}

	return new Response('ok')
}

export async function sendSlackMessage(env: Env, channel: string, text: string): Promise<void> {
	const token = env.SLACK_BOT_TOKEN
	if (!token) return

	await fetch('https://slack.com/api/chat.postMessage', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ channel, text }),
	})
}
