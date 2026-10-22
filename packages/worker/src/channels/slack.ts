import { isAllowed } from '../lib/allowlist-store.ts'
import { apiBase } from '../lib/api-base.ts'
import { logChannelMessage } from '../lib/conversation.ts'
import { timingSafeEqual } from '../lib/crypto.ts'
import { approvePairing } from '../lib/pairing.ts'
import { enqueueTask } from '../lib/task-store.ts'

interface SlackInbound {
	author_id?: string
	display_name?: string
	channel_id?: string
	team_id?: string | null
	is_im?: boolean
	text?: string
	message_id?: string
}

interface SlackEventsPayload {
	type?: string
	challenge?: string
}

const APPROVE_COMMAND = /^\/approve\s+(\S+)/i
const SLACK_MAX_LENGTH = 4000
const SEEN_TTL_SECONDS = 600

/**
 * Socket Mode ingress from sl-bridge. Fail-closed on the shared secret.
 * Workspace (`team_id`) is the trust boundary for channels; DMs pair per-user.
 */
export async function handleSlackBridgeWebhook(request: Request, env: Env): Promise<Response> {
	const secret = env.SLACK_BRIDGE_SECRET
	const header = request.headers.get('x-sl-bridge-secret') ?? ''
	if (!secret || !timingSafeEqual(header, secret)) {
		return new Response('Unauthorized', { status: 401 })
	}

	const body = (await request.json()) as SlackInbound
	const authorId = body.author_id
	const chatId = body.channel_id
	const text = body.text
	if (!authorId || !chatId || !text) return new Response('ok')

	// sl-bridge retries a POST it thinks failed; drop one we already enqueued.
	const seenKey = body.message_id
		? `sl:seen:${body.team_id ?? ''}:${chatId}:${body.message_id}`
		: null
	if (seenKey && (await env.FERMI_KV.get(seenKey))) return new Response('ok')
	const markSeen = async () => {
		if (seenKey) await env.FERMI_KV.put(seenKey, '1', { expirationTtl: SEEN_TTL_SECONDS })
	}

	const isIm = body.is_im === true

	if (!isIm) {
		const teamId = body.team_id
		if (!teamId) return new Response('ok')
		if (!(await isAllowed(env.FERMI_DB, 'sl', teamId))) {
			return new Response('ok')
		}
		const attribution = `[${body.display_name ?? authorId}] `
		await logChannelMessage(env.FERMI_DB, 'sl', chatId, 'user', attribution + text)
		await enqueueTask(env.FERMI_DB, {
			channel: 'sl',
			sender: authorId,
			chatId,
			payload: attribution + text,
		})
		await markSeen()
		return new Response('ok')
	}

	if (!(await isAllowed(env.FERMI_DB, 'sl', authorId))) {
		const code = crypto.randomUUID().slice(0, 8).toUpperCase()
		await env.FERMI_KV.put(
			`pairing:${code}`,
			JSON.stringify({ channel: 'sl', senderId: authorId, chatId }),
			{ expirationTtl: 3600 },
		)
		await replyBestEffort(env, chatId, `Pairing code: ${code}\nAsk the owner to approve this code.`)
		return new Response('ok')
	}

	const approveMatch = APPROVE_COMMAND.exec(text)
	if (approveMatch) {
		const result = await approvePairing(env, approveMatch[1])
		if (result.ok) {
			await replyBestEffort(env, chatId, `Approved sender ${result.senderId}.`)
			await replyBestEffort(env, result.chatId, "You're approved. Send me a message anytime.")
		} else {
			await replyBestEffort(env, chatId, `Approval failed: ${result.error}`)
		}
		return new Response('ok')
	}

	await logChannelMessage(env.FERMI_DB, 'sl', chatId, 'user', text)
	await enqueueTask(env.FERMI_DB, { channel: 'sl', sender: authorId, chatId, payload: text })
	await markSeen()
	await replyBestEffort(env, chatId, 'Got it — working on it.')
	return new Response('ok')
}

/**
 * Webhook replies must not fail the request: sl-bridge retries any non-2xx,
 * which would enqueue the same inbound message again.
 */
async function replyBestEffort(env: Env, channel: string, text: string): Promise<void> {
	try {
		await sendSlackMessage(env, channel, text)
	} catch (err) {
		console.warn(`sl webhook: reply to ${channel} failed (${String(err)})`)
	}
}

/**
 * Legacy Events API URL. Socket Mode is the real ingress (`/sl/webhook`); this
 * only answers Slack's url_verification challenge so an old Request URL does
 * not fail. Event payloads are ignored to avoid double-enqueue.
 */
export async function handleSlackWebhook(request: Request, _env: Env): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as SlackEventsPayload
	if (body.type === 'url_verification') {
		return Response.json({ challenge: body.challenge })
	}
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
		const window = remaining.slice(0, maxLength)
		const nl = window.lastIndexOf('\n')
		const cut = nl > 0 ? nl : maxLength
		chunks.push(remaining.slice(0, cut))
		remaining = remaining.slice(cut).replace(/^\n/, '')
	}
	return chunks
}

function slackBotTokens(env: Env): string[] {
	return (env.SLACK_BOT_TOKEN ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)
}

/** Send a message to a Slack channel or DM via chat.postMessage. */
export async function sendSlackMessage(env: Env, channel: string, text: string): Promise<void> {
	const tokens = slackBotTokens(env)
	if (tokens.length === 0) throw new Error('slack: SLACK_BOT_TOKEN not configured')
	const url = `${apiBase(env, 'SLACK_API_BASE')}/api/chat.postMessage`

	for (const chunk of chunkText(text, SLACK_MAX_LENGTH)) {
		const errors: string[] = []
		let sent = false
		for (const token of tokens) {
			const init: RequestInit = {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ channel, text: chunk }),
			}
			const res = await fetch(url, init)
			if (res.status === 429) {
				const retryAfter = Number(res.headers.get('retry-after') ?? '1')
				const waitMs = Math.ceil((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000)
				await new Promise((resolve) => setTimeout(resolve, waitMs))
				const retry = await fetch(url, init)
				const body = (await retry.json().catch(() => ({}))) as { ok?: boolean; error?: string }
				if (body.ok) {
					sent = true
					break
				}
				errors.push(body.error ?? `http ${retry.status}`)
				continue
			}
			const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
			if (body.ok) {
				sent = true
				break
			}
			errors.push(body.error ?? `http ${res.status}`)
		}
		if (!sent) throw new Error(`slack chat.postMessage failed for ${channel}: ${errors.join(', ')}`)
	}
}
