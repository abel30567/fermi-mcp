import type { Config } from './config.ts'
import { log } from './log.ts'
import type { SocketState } from './socket.ts'

type OutboxMessage = {
	id: string
	chat_id: string
	body: string
	created_at: number
}

const MAX_CHUNK = 4000

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunkBody(body: string): string[] {
	if (body.length <= MAX_CHUNK) return [body]
	const chunks: string[] = []
	for (let i = 0; i < body.length; i += MAX_CHUNK) {
		chunks.push(body.slice(i, i + MAX_CHUNK))
	}
	return chunks
}

async function ack(config: Config, ids: string[]): Promise<void> {
	try {
		const res = await fetch(`${config.FERMI_URL}/wa/outbox/ack`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${config.FERMI_BEARER_TOKEN}`,
			},
			body: JSON.stringify({ ids }),
		})
		if (!res.ok) log(`ack non-2xx for ${ids.join(',')}: ${res.status}`)
	} catch (err) {
		log(`ack network error for ${ids.join(',')}: ${String(err)}`)
	}
}

// Sequential loop — never overlaps a cycle with the previous one.
export async function runOutboxLoop(config: Config, socketState: SocketState): Promise<void> {
	const outboxUrl = `${config.FERMI_URL}/wa/outbox`
	while (true) {
		if (!socketState.isOpen()) {
			await sleep(config.POLL_MS)
			continue
		}

		let messages: OutboxMessage[]
		try {
			const res = await fetch(outboxUrl, {
				headers: { authorization: `Bearer ${config.FERMI_BEARER_TOKEN}` },
			})
			if (!res.ok) {
				log(`outbox fetch non-2xx: ${res.status}`)
				await sleep(config.POLL_MS)
				continue
			}
			const data = (await res.json()) as { messages?: OutboxMessage[] }
			messages = data.messages ?? []
		} catch (err) {
			log(`outbox fetch error: ${String(err)}`)
			await sleep(config.POLL_MS)
			continue
		}

		for (const msg of messages) {
			const sock = socketState.currentSocket()
			if (!sock || !socketState.isOpen()) break
			// Group chat_ids arrive as full jids (contain '@g.us'); DMs are bare numbers.
			const jid = msg.chat_id.includes('@') ? msg.chat_id : `${msg.chat_id}@s.whatsapp.net`
			try {
				for (const chunk of chunkBody(msg.body)) {
					// Human-like pacing between chunks to reduce ban risk.
					await sleep(2000 + Math.random() * 3000)
					await sock.sendMessage(jid, { text: chunk })
				}
			} catch (err) {
				log(`send failed for message ${msg.id} (chat ${msg.chat_id}): ${String(err)}`)
				continue
			}
			// Ack per-message: a crash between send and ack may re-send this one.
			await ack(config, [msg.id])
		}

		await sleep(config.POLL_MS)
	}
}
