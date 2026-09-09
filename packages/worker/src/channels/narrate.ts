import { CHANNELS, type Channel, sendChannelMessage } from './dispatch.ts'

/**
 * Ephemeral progress narration: deliver a one-line "what the executor is doing"
 * update to a channel WITHOUT logging it to conversation history (narration is
 * process noise and must not pollute the transcript/memory). Bearer-authed.
 */
export async function handleNarrate(request: Request, env: Env): Promise<Response> {
	const auth = request.headers.get('authorization') ?? ''
	const token = env.FERMI_BEARER_TOKEN
	if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })

	const body = (await request.json().catch(() => ({}))) as {
		channel?: string
		chat_id?: string
		text?: string
	}
	if (!body.channel || !CHANNELS.includes(body.channel as Channel) || !body.chat_id || !body.text) {
		return new Response('Bad Request', { status: 400 })
	}

	await sendChannelMessage(env, body.channel as Channel, body.chat_id, body.text)
	return Response.json({ ok: true })
}
