import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { Config } from './config.ts'
import { log } from './log.ts'

const RETRY_DELAYS_MS = [1000, 3000, 9000]

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// Kick the Fermi daemon so it drains the freshly-queued inbound message
// promptly. poll.sh holds its own lock, so a duplicate spawn is harmless.
function pokeDaemon(config: Config): void {
	try {
		const pollScript = join(config.DAEMON_HOME, 'poll.sh')
		spawn(pollScript, [], { detached: true, stdio: 'ignore' }).unref()
	} catch (err) {
		log(`warn: failed to spawn poll.sh: ${String(err)}`)
	}
}

export type InboundHandler = (sender: string, chatId: string, text: string) => Promise<void>

export function makeInboundHandler(config: Config): InboundHandler {
	const url = `${config.FERMI_URL}/wa/webhook`
	return async (sender, chatId, text) => {
		const body = JSON.stringify({ sender, chat_id: chatId, text })
		for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
			try {
				const res = await fetch(url, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-wa-bridge-secret': config.WA_WEBHOOK_SECRET,
					},
					body,
				})
				if (res.ok) {
					pokeDaemon(config)
					return
				}
				log(`webhook non-2xx (attempt ${attempt + 1}): ${res.status}`)
			} catch (err) {
				log(`webhook network error (attempt ${attempt + 1}): ${String(err)}`)
			}
			const delay = RETRY_DELAYS_MS[attempt]
			if (delay !== undefined) await sleep(delay)
		}
		log(
			`DROPPED inbound message from ${sender} (chat ${chatId}) after ${RETRY_DELAYS_MS.length + 1} attempts`,
		)
	}
}
