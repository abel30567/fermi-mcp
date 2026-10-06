import { isAllowed } from '../lib/allowlist-store.ts'
import { logChannelMessage } from '../lib/conversation.ts'
import { timingSafeEqual } from '../lib/crypto.ts'
import { wakeMacDaemon } from '../lib/mac-wake.ts'
import { approvePairing } from '../lib/pairing.ts'
import { enqueueTask } from '../lib/task-store.ts'
import { type MediaKind, type OutboundMedia, mediaCaption } from './media.ts'

interface TelegramMessage {
	message_id: number
	from: { id: number; first_name?: string }
	chat: { id: number; type?: string }
	sender_chat?: unknown
	text?: string
}

interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

const APPROVE_COMMAND = /^\/approve\s+(\S+)/i

export async function handleTelegramWebhook(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	// Fail closed: reject when the webhook secret is unset or the header mismatches.
	const secret = env.TELEGRAM_WEBHOOK_SECRET
	const header = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
	if (!secret || !timingSafeEqual(header, secret)) {
		return new Response('Unauthorized', { status: 401 })
	}

	const body = (await request.json()) as TelegramUpdate
	const message = body.message
	if (!message?.text) return new Response('ok')

	// Anonymous group admins / channel posts arrive without a real from user;
	// there's no sender to allowlist or attribute, so skip them.
	if (message.sender_chat) return new Response('ok')

	const senderId = String(message.from.id)
	const chatId = String(message.chat.id)
	const text = message.text
	const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup'

	if (!(await isAllowed(env.FERMI_DB, 'tg', senderId))) {
		// Groups: stay silent — no pairing spam in shared chats.
		if (isGroup) return new Response('ok')
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

	if (isGroup) {
		// Group turn: attribute the speaker, enqueue, no /approve, no ack.
		const attribution = `[${message.from.first_name ?? senderId}] `
		await logChannelMessage(env.FERMI_DB, 'tg', chatId, 'user', attribution + text)
		await enqueueTask(env.FERMI_DB, {
			channel: 'tg',
			sender: senderId,
			chatId,
			payload: attribution + text,
		})
		if (ctx) ctx.waitUntil(wakeMacDaemon(env))
		else await wakeMacDaemon(env)
		return new Response('ok')
	}

	// Allowlisted sender approving a pairing code (DM only)
	const approveMatch = APPROVE_COMMAND.exec(text)
	if (approveMatch) {
		const result = await approvePairing(env, approveMatch[1])
		if (result.ok) {
			await sendTelegramMessage(env, chatId, `Approved sender ${result.senderId}.`)
			await sendTelegramMessage(env, result.chatId, "You're approved. Send me a message anytime.")
		} else {
			await sendTelegramMessage(env, chatId, `Approval failed: ${result.error}`)
		}
		return new Response('ok')
	}

	// Gateway: log the turn, enqueue for the local daemon, ack, and push-wake
	// the daemon so pickup doesn't wait for the next 60s poll.
	await logChannelMessage(env.FERMI_DB, 'tg', chatId, 'user', text)
	await enqueueTask(env.FERMI_DB, { channel: 'tg', sender: senderId, chatId, payload: text })
	await sendTelegramMessage(env, chatId, 'Got it — working on it.')
	if (ctx) ctx.waitUntil(wakeMacDaemon(env))
	else await wakeMacDaemon(env)
	return new Response('ok')
}

/** Register this Worker as the bot's webhook, binding the shared secret token. */
export async function setTelegramWebhook(
	env: Env,
	webhookUrl: string,
): Promise<{ ok: boolean; error?: string; telegram?: unknown }> {
	const token = env.TELEGRAM_BOT_TOKEN
	if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }
	if (!env.TELEGRAM_WEBHOOK_SECRET) {
		return { ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not configured' }
	}

	const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url: webhookUrl, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
	})
	const telegram = await res.json()
	return { ok: res.ok, telegram }
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

const TELEGRAM_MEDIA_METHOD: Record<MediaKind, { method: string; field: string }> = {
	image: { method: 'sendPhoto', field: 'photo' },
	video: { method: 'sendVideo', field: 'video' },
	audio: { method: 'sendAudio', field: 'audio' },
	document: { method: 'sendDocument', field: 'document' },
}

/**
 * Send one attachment by URL (Telegram fetches it). Throws on a Telegram error
 * so the caller learns the attachment did not go out.
 */
export async function sendTelegramMedia(
	env: Env,
	chatId: string,
	text: string,
	media: OutboundMedia,
): Promise<void> {
	const token = env.TELEGRAM_BOT_TOKEN
	if (!token) return
	if (!media.url) throw new Error('tg media requires url')

	const { method, field } = TELEGRAM_MEDIA_METHOD[media.kind]
	const payload: Record<string, string> = { chat_id: chatId, [field]: media.url }
	const caption = mediaCaption(media, text)
	if (caption) payload.caption = caption

	const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})
	const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
	if (!res.ok || body.ok === false) {
		throw new Error(`telegram ${method} failed: ${body.description ?? `http ${res.status}`}`)
	}
}
