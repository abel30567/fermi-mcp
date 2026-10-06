import { isAllowed } from '../lib/allowlist-store.ts'
import { logChannelMessage } from '../lib/conversation.ts'
import { timingSafeEqual } from '../lib/crypto.ts'
import { enqueueOutbound } from '../lib/outbox-store.ts'
import { approvePairing } from '../lib/pairing.ts'
import { enqueueTask } from '../lib/task-store.ts'
import type { OutboundMedia } from './media.ts'
import { handleOutboxAck, handleOutboxGet } from './outbox-http.ts'

interface WhatsAppInbound {
	sender?: string
	chat_id?: string
	text?: string
}

const APPROVE_COMMAND = /^\/approve\s+(\S+)/i

export async function handleWhatsAppWebhook(request: Request, env: Env): Promise<Response> {
	// Fail closed: reject when the webhook secret is unset or the header mismatches.
	const secret = env.WA_WEBHOOK_SECRET
	const header = request.headers.get('x-wa-bridge-secret') ?? ''
	if (!secret || !timingSafeEqual(header, secret)) {
		return new Response('Unauthorized', { status: 401 })
	}

	const body = (await request.json()) as WhatsAppInbound
	const sender = body.sender
	const chatId = body.chat_id
	const text = body.text
	if (!sender || !chatId || !text) return new Response('ok')

	// The bridge passes group jids whole (e.g. 123-456@g.us); DM chat_ids are
	// bare numbers.
	const isGroup = chatId.endsWith('@g.us')

	if (!(await isAllowed(env.FERMI_DB, 'wa', sender))) {
		// Groups: stay silent — no pairing spam in shared chats.
		if (isGroup) return new Response('ok')
		// DM pairing: generate code, store, reply with instructions
		const code = crypto.randomUUID().slice(0, 8).toUpperCase()
		await env.FERMI_KV.put(
			`pairing:${code}`,
			JSON.stringify({ channel: 'wa', senderId: sender, chatId }),
			{ expirationTtl: 3600 },
		)
		await sendWhatsAppMessage(
			env,
			chatId,
			`Pairing code: ${code}\nAsk the owner to approve this code.`,
		)
		return new Response('ok')
	}

	if (isGroup) {
		// Group turn: attribute the speaker, enqueue, no /approve, no ack.
		const attribution = `[${sender}] `
		await logChannelMessage(env.FERMI_DB, 'wa', chatId, 'user', attribution + text)
		await enqueueTask(env.FERMI_DB, {
			channel: 'wa',
			sender,
			chatId,
			payload: attribution + text,
		})
		return new Response('ok')
	}

	// Allowlisted sender approving a pairing code (DM only)
	const approveMatch = APPROVE_COMMAND.exec(text)
	if (approveMatch) {
		const result = await approvePairing(env, approveMatch[1])
		if (result.ok) {
			await sendWhatsAppMessage(env, chatId, `Approved sender ${result.senderId}.`)
			await sendWhatsAppMessage(env, result.chatId, "You're approved. Send me a message anytime.")
		} else {
			await sendWhatsAppMessage(env, chatId, `Approval failed: ${result.error}`)
		}
		return new Response('ok')
	}

	// Gateway: log the turn, enqueue for the local daemon, ack. The bridge wakes
	// its own daemon on 200, so no push-wake is needed here.
	await logChannelMessage(env.FERMI_DB, 'wa', chatId, 'user', text)
	await enqueueTask(env.FERMI_DB, { channel: 'wa', sender, chatId, payload: text })
	await sendWhatsAppMessage(env, chatId, 'Got it — working on it.')
	return new Response('ok')
}

/** Queue an outbound WhatsApp message (optionally an attachment) for the bridge to deliver. */
export async function sendWhatsAppMessage(
	env: Env,
	chatId: string,
	text: string,
	media?: OutboundMedia,
): Promise<void> {
	await enqueueOutbound(env.FERMI_DB, { channel: 'wa', chatId, body: text, media })
}

export function handleWaOutboxGet(request: Request, env: Env): Promise<Response> {
	return handleOutboxGet(request, env, 'wa')
}

export function handleWaOutboxAck(request: Request, env: Env): Promise<Response> {
	return handleOutboxAck(request, env)
}
