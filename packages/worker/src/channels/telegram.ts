import { runAgentTurn } from './inference.ts'

interface TelegramMessage {
	message_id: number
	from: { id: number; first_name?: string }
	chat: { id: number }
	text?: string
}

interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
	const body = (await request.json()) as TelegramUpdate
	const message = body.message
	if (!message?.text) return new Response('ok')

	const senderId = String(message.from.id)
	const chatId = String(message.chat.id)
	const text = message.text

	// Check allowlist
	const allowlistRaw = await env.FERMI_KV.get('channel:tg:allowlist')
	const allowlist: string[] = allowlistRaw ? JSON.parse(allowlistRaw) : []

	if (!allowlist.includes(senderId)) {
		// DM pairing: generate code, store, reply with instructions
		const code = crypto.randomUUID().slice(0, 8).toUpperCase()
		await env.FERMI_KV.put(`pairing:${code}`, JSON.stringify({ channel: 'tg', senderId, chatId }), {
			expirationTtl: 3600,
		})
		await sendTelegramMessage(
			env,
			chatId,
			`Pairing code: ${code}\nAsk the owner to approve this code.`,
		)
		return new Response('ok')
	}

	// Run inference
	const response = await runAgentTurn(text, env, { channel: 'tg', chatId })
	await sendTelegramMessage(env, chatId, response)
	return new Response('ok')
}

function chunkText(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text]
	const chunks: string[] = []
	let remaining = text
	while (remaining.length > 0) {
		chunks.push(remaining.slice(0, maxLength))
		remaining = remaining.slice(maxLength)
	}
	return chunks
}

export async function sendTelegramMessage(env: Env, chatId: string, text: string): Promise<void> {
	const token = env.TELEGRAM_BOT_TOKEN
	if (!token) return

	const chunks = chunkText(text, 4000)
	for (const chunk of chunks) {
		await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }),
		})
	}
}
