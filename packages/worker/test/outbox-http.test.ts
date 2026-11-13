import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleOutboxAck, handleOutboxGet } from '../src/channels/outbox-http.ts'
import { enqueueOutbound } from '../src/lib/outbox-store.ts'
import { clearOutbox, setupOutboxSchema } from './setup-d1.ts'

const bearerEnv = { ...(env as unknown as Env), FERMI_BEARER_TOKEN: 'test-bearer' }

function get(channel: string, auth?: string): Request {
	const headers: Record<string, string> = {}
	if (auth) headers.authorization = auth
	return new Request(`https://fermi.example.com/${channel}/outbox`, { headers })
}

function ack(channel: string, ids: unknown, auth?: string): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (auth) headers.authorization = auth
	return new Request(`https://fermi.example.com/${channel}/outbox/ack`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ ids }),
	})
}

beforeAll(async () => {
	await setupOutboxSchema()
})

beforeEach(async () => {
	await clearOutbox()
})

describe('bridge outbox endpoints for dc/sl', () => {
	it('rejects unauthenticated requests', async () => {
		expect((await handleOutboxGet(get('dc'), bearerEnv, 'dc')).status).toBe(401)
		expect((await handleOutboxAck(ack('sl', []), bearerEnv)).status).toBe(401)
	})

	it('returns each channel its own pending rows with the media payload', async () => {
		const media = { kind: 'image' as const, path: '/Users/me/fermi-daemon/media/out/a.png' }
		const dc = await enqueueOutbound(env.FERMI_DB, {
			channel: 'dc',
			chatId: '1',
			body: 'cap',
			media,
		})
		await enqueueOutbound(env.FERMI_DB, { channel: 'sl', chatId: 'C1', body: 'other' })

		const res = await handleOutboxGet(get('dc', 'Bearer test-bearer'), bearerEnv, 'dc')
		expect(res.status).toBe(200)
		const { messages } = (await res.json()) as { messages: Record<string, unknown>[] }
		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatchObject({ id: dc.id, chat_id: '1', body: 'cap', media })

		const ackRes = await handleOutboxAck(ack('dc', [dc.id], 'Bearer test-bearer'), bearerEnv)
		expect(await ackRes.json()).toEqual({ ok: true, acked: 1 })

		const sl = await handleOutboxGet(get('sl', 'Bearer test-bearer'), bearerEnv, 'sl')
		const slBody = (await sl.json()) as { messages: Record<string, unknown>[] }
		expect(slBody.messages).toHaveLength(1)
		expect(slBody.messages[0]).toMatchObject({ chat_id: 'C1', body: 'other', media: null })
	})
})
