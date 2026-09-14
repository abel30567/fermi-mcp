import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import { type Config, loadConfig } from './config.ts'
import { log } from './log.ts'

process.on('unhandledRejection', (reason) => {
	log(`FATAL unhandledRejection: ${String(reason)}`)
	process.exit(1)
})
process.on('uncaughtException', (err) => {
	log(`FATAL uncaughtException: ${String(err)}`)
	process.exit(1)
})

const RETRY_DELAYS_MS = [1000, 3000, 9000]

type SlackMessageEvent = {
	type?: string
	subtype?: string
	bot_id?: string
	user?: string
	channel?: string
	channel_type?: string
	team?: string
	text?: string
	hidden?: boolean
}

type SlackEnvelope = {
	team_id?: string
	event?: SlackMessageEvent
}

type Inbound = {
	author_id: string
	display_name: string
	channel_id: string
	team_id: string | null
	is_im: boolean
	text: string
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function pokeDaemon(config: Config): void {
	try {
		const pollScript = join(config.DAEMON_HOME, 'poll.sh')
		spawn(pollScript, [], { detached: true, stdio: 'ignore' }).unref()
	} catch (err) {
		log(`warn: failed to spawn poll.sh: ${String(err)}`)
	}
}

async function forwardToWorker(config: Config, msg: Inbound): Promise<void> {
	const url = `${config.FERMI_URL}/sl/webhook`
	const body = JSON.stringify(msg)
	for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-sl-bridge-secret': config.SLACK_BRIDGE_SECRET,
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
		`DROPPED inbound message from ${msg.author_id} (channel ${msg.channel_id}) after ${RETRY_DELAYS_MS.length + 1} attempts`,
	)
}

function isIm(event: SlackMessageEvent): boolean {
	if (event.channel_type === 'im') return true
	return typeof event.channel === 'string' && event.channel.startsWith('D')
}

async function main(): Promise<void> {
	const config = loadConfig()
	log('starting sl-bridge')

	const web = new WebClient(config.SLACK_BOT_TOKEN)
	const nameCache = new Map<string, string>()

	let botUserId: string | undefined
	try {
		const auth = await web.auth.test()
		if (!auth.ok || typeof auth.user_id !== 'string') {
			throw new Error(auth.error ?? 'auth.test failed')
		}
		botUserId = auth.user_id
		log(`authenticated as ${auth.user ?? auth.user_id} (${auth.user_id})`)
	} catch (err) {
		log(`FATAL auth.test failed: ${String(err)}`)
		process.exit(1)
	}

	async function resolveName(userId: string): Promise<string> {
		const cached = nameCache.get(userId)
		if (cached) return cached
		try {
			const info = await web.users.info({ user: userId })
			const user = info.user
			const name =
				user?.profile?.display_name ||
				user?.profile?.real_name ||
				user?.real_name ||
				user?.name ||
				userId
			nameCache.set(userId, name)
			return name
		} catch (err) {
			log(`warn: users.info failed for ${userId}: ${String(err)}`)
			return userId
		}
	}

	const socket = new SocketModeClient({ appToken: config.SLACK_APP_TOKEN })

	socket.on('connected', () => {
		log('socket mode connected')
	})
	socket.on('disconnected', () => {
		log('socket mode disconnected — client will reconnect')
	})
	socket.on('error', (err: unknown) => {
		log(`client error: ${String(err)}`)
	})

	socket.on(
		'slack_event',
		async ({ ack, body }: { ack: () => Promise<void>; body: SlackEnvelope }) => {
			// Ack first so Slack does not retry while we forward.
			await ack()
			const event = body.event
			if (!event || event.type !== 'message') return
			if (event.bot_id || event.subtype || event.hidden) return
			const text = event.text
			const authorId = event.user
			const channelId = event.channel
			if (!text || !authorId || !channelId) return
			if (botUserId && authorId === botUserId) return

			const displayName = await resolveName(authorId)
			const teamId = body.team_id ?? event.team ?? null
			forwardToWorker(config, {
				author_id: authorId,
				display_name: displayName,
				channel_id: channelId,
				team_id: teamId,
				is_im: isIm(event),
				text,
			}).catch((err) => {
				log(`forwardToWorker error: ${String(err)}`)
			})
		},
	)

	try {
		await socket.start()
	} catch (err) {
		log(`FATAL socket start failed: ${String(err)}`)
		process.exit(1)
	}
}

main().catch((err) => {
	log(`FATAL: ${String(err)}`)
	process.exit(1)
})
