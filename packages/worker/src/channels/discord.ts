import { isAllowed } from '../lib/allowlist-store.ts'
import { logChannelMessage } from '../lib/conversation.ts'
import { timingSafeEqual } from '../lib/crypto.ts'
import { approvePairing } from '../lib/pairing.ts'
import { enqueueTask } from '../lib/task-store.ts'

interface DiscordInbound {
	author_id?: string
	display_name?: string
	channel_id?: string
	guild_id?: string | null
	text?: string
}

const APPROVE_COMMAND = /^\/approve\s+(\S+)/i
const DISCORD_MAX_LENGTH = 2000

export async function handleDiscordWebhook(request: Request, env: Env): Promise<Response> {
	// Fail closed: reject when the bridge secret is unset or the header mismatches.
	const secret = env.DISCORD_BRIDGE_SECRET
	const header = request.headers.get('x-dc-bridge-secret') ?? ''
	if (!secret || !timingSafeEqual(header, secret)) {
		return new Response('Unauthorized', { status: 401 })
	}

	const body = (await request.json()) as DiscordInbound
	const authorId = body.author_id
	const chatId = body.channel_id
	const text = body.text
	if (!authorId || !chatId || !text) return new Response('ok')

	// The server is the trust boundary: any member of an approved guild may use
	// the bot. DMs (guild_id null) fall back to per-user pairing.
	const isGuild = body.guild_id != null && body.guild_id !== ''

	if (isGuild) {
		// Silent unless the guild itself is allowlisted.
		if (!(await isAllowed(env.FERMI_DB, 'dc', body.guild_id as string))) {
			return new Response('ok')
		}
		// Guild turn: attribute the speaker, enqueue, no ack. The bridge wakes its
		// own daemon on 200, so no push-wake is needed here.
		const attribution = `[${body.display_name ?? authorId}] `
		await logChannelMessage(env.FERMI_DB, 'dc', chatId, 'user', attribution + text)
		await enqueueTask(env.FERMI_DB, {
			channel: 'dc',
			sender: authorId,
			chatId,
			payload: attribution + text,
		})
		return new Response('ok')
	}

	if (!(await isAllowed(env.FERMI_DB, 'dc', authorId))) {
		// DM pairing: generate code, store, reply with instructions.
		const code = crypto.randomUUID().slice(0, 8).toUpperCase()
		await env.FERMI_KV.put(
			`pairing:${code}`,
			JSON.stringify({ channel: 'dc', senderId: authorId, chatId }),
			{ expirationTtl: 3600 },
		)
		await sendDiscordMessage(
			env,
			chatId,
			`Pairing code: ${code}\nAsk the owner to approve this code.`,
		)
		return new Response('ok')
	}

	// Allowlisted sender approving a pairing code (DM only).
	const approveMatch = APPROVE_COMMAND.exec(text)
	if (approveMatch) {
		const result = await approvePairing(env, approveMatch[1])
		if (result.ok) {
			await sendDiscordMessage(env, chatId, `Approved sender ${result.senderId}.`)
			await sendDiscordMessage(env, result.chatId, "You're approved. Send me a message anytime.")
		} else {
			await sendDiscordMessage(env, chatId, `Approval failed: ${result.error}`)
		}
		return new Response('ok')
	}

	// Gateway: log the turn, enqueue for the local daemon, ack.
	await logChannelMessage(env.FERMI_DB, 'dc', chatId, 'user', text)
	await enqueueTask(env.FERMI_DB, { channel: 'dc', sender: authorId, chatId, payload: text })
	await sendDiscordMessage(env, chatId, 'Got it — working on it.')
	return new Response('ok')
}

function chunkText(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text]
	const chunks: string[] = []
	let remaining = text
	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining)
			break
		}
		// Prefer a newline boundary within the window, else hard slice.
		const window = remaining.slice(0, maxLength)
		const nl = window.lastIndexOf('\n')
		const cut = nl > 0 ? nl : maxLength
		chunks.push(remaining.slice(0, cut))
		remaining = remaining.slice(cut).replace(/^\n/, '')
	}
	return chunks
}

/** Send a message to a Discord channel (guild channel or DM channel) via REST. */
export async function sendDiscordMessage(env: Env, channelId: string, text: string): Promise<void> {
	const token = env.DISCORD_BOT_TOKEN
	if (!token) return

	for (const chunk of chunkText(text, DISCORD_MAX_LENGTH)) {
		const url = `https://discord.com/api/v10/channels/${channelId}/messages`
		const init: RequestInit = {
			method: 'POST',
			headers: {
				Authorization: `Bot ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ content: chunk }),
		}
		const res = await fetch(url, init)
		if (res.status === 429) {
			const retry = (await res.json().catch(() => ({}))) as { retry_after?: number }
			const waitMs = Math.ceil((retry.retry_after ?? 1) * 1000)
			await new Promise((resolve) => setTimeout(resolve, waitMs))
			await fetch(url, init)
		}
	}
}
