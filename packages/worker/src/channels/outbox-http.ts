import { ackOutbox, listPendingOutbox } from '../lib/outbox-store.ts'
import type { Channel } from './dispatch.ts'

/** Channels whose Mac-local bridge polls the outbox. */
export const OUTBOX_CHANNELS = ['wa', 'dc', 'sl'] as const satisfies readonly Channel[]
export type OutboxChannel = (typeof OUTBOX_CHANNELS)[number]

function authorized(request: Request, env: Env): boolean {
	const auth = request.headers.get('authorization') ?? ''
	const token = env.FERMI_BEARER_TOKEN
	return Boolean(token) && auth === `Bearer ${token}`
}

/** GET /<channel>/outbox — pending rows for the bridge to deliver. */
export async function handleOutboxGet(
	request: Request,
	env: Env,
	channel: OutboxChannel,
): Promise<Response> {
	if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 })
	return Response.json({ messages: await listPendingOutbox(env.FERMI_DB, channel, 10) })
}

/** POST /<channel>/outbox/ack — { ids: string[] } delivered by the bridge. */
export async function handleOutboxAck(request: Request, env: Env): Promise<Response> {
	if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 })

	const body = (await request.json().catch(() => ({}))) as { ids?: unknown }
	const ids = body.ids
	if (!Array.isArray(ids) || ids.length > 50 || !ids.every((id) => typeof id === 'string')) {
		return new Response('Bad Request', { status: 400 })
	}
	const { acked } = await ackOutbox(env.FERMI_DB, ids as string[])
	return Response.json({ ok: true, acked })
}
