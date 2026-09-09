import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js'
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

// Gateway close codes that are permanent config errors: a human must fix the
// bot token or the portal intent toggles. Exiting (instead of letting
// discord.js reconnect) avoids hammering a doomed login under launchd KeepAlive.
const FATAL_CLOSE_CODES = new Set([4004, 4013, 4014])

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

type Inbound = {
	author_id: string
	display_name: string
	channel_id: string
	guild_id: string | null
	text: string
}

async function forwardToWorker(config: Config, msg: Inbound): Promise<void> {
	const url = `${config.FERMI_URL}/dc/webhook`
	const body = JSON.stringify(msg)
	for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-dc-bridge-secret': config.DISCORD_BRIDGE_SECRET,
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

async function main(): Promise<void> {
	const config = loadConfig()
	log('starting dc-bridge')

	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
		],
		// Required to receive DMs: DM channels arrive uncached as partials.
		partials: [Partials.Channel],
	})

	client.once(Events.ClientReady, (c) => {
		log(`connected as ${c.user.tag} (${c.user.id})`)
	})

	client.on(Events.MessageCreate, (message) => {
		// Ignore self and other bots.
		if (message.author.bot) return
		const text = message.content
		// Empty when the Message Content intent is off in the portal, or for
		// attachment-only messages — nothing to forward either way.
		if (!text) return

		const displayName =
			message.member?.displayName ?? message.author.displayName ?? message.author.username

		forwardToWorker(config, {
			author_id: message.author.id,
			display_name: displayName,
			channel_id: message.channel.id,
			guild_id: message.guild?.id ?? null,
			text,
		}).catch((err) => {
			log(`forwardToWorker error: ${String(err)}`)
		})
	})

	// discord.js reconnects transiently on its own; only surface these.
	client.on(Events.Error, (err) => {
		log(`client error: ${String(err)}`)
	})
	client.on(Events.ShardError, (err) => {
		log(`shard error: ${String(err)}`)
	})
	client.on(Events.ShardDisconnect, (event) => {
		if (FATAL_CLOSE_CODES.has(event.code)) {
			log(
				`FATAL gateway close ${event.code} — bad token or intents not enabled in the portal; exiting.`,
			)
			process.exit(1)
		}
		log(`shard disconnected (code ${event.code}) — discord.js will reconnect.`)
	})

	try {
		await client.login(config.DISCORD_BOT_TOKEN)
	} catch (err) {
		log(`FATAL login failed: ${String(err)}`)
		process.exit(1)
	}
}

main().catch((err) => {
	log(`FATAL: ${String(err)}`)
	process.exit(1)
})
