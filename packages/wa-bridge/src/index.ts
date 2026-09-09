import { loadConfig } from './config.ts'
import { makeInboundHandler } from './inbound.ts'
import { log } from './log.ts'
import { runOutboxLoop } from './outbox.ts'
import { createSocket } from './socket.ts'

process.on('unhandledRejection', (reason) => {
	log(`FATAL unhandledRejection: ${String(reason)}`)
	process.exit(1)
})
process.on('uncaughtException', (err) => {
	log(`FATAL uncaughtException: ${String(err)}`)
	process.exit(1)
})

function parsePairNumber(raw: string | undefined): string {
	if (!raw) {
		log('usage: npm run pair -- <E164-digits>   (e.g. 15551234567, no + or spaces)')
		process.exit(1)
	}
	let n = raw.trim()
	if (n.startsWith('+')) {
		log('note: stripping leading "+" — pass E.164 digits only (e.g. 15551234567).')
		n = n.slice(1)
	}
	if (!/^\d{6,15}$/.test(n)) {
		log(`invalid pairing number: "${raw}" — expected 6-15 digits, E.164 without "+".`)
		process.exit(1)
	}
	return n
}

async function main(): Promise<void> {
	const config = loadConfig()
	const [mode, ...rest] = process.argv.slice(2)

	if (mode === 'pair') {
		const number = parsePairNumber(rest[0])
		log(`pairing mode for +${number} — watch for the pairing code below.`)
		// No outbox loop in pair mode; stay alive so creds.update can persist.
		await createSocket(config, { onTextMessage: async () => {} }, number)
		log('waiting for pairing to complete… once you see "connected as …", press Ctrl-C,')
		log(
			'then start the LaunchAgent: launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.fermi.wa-bridge.plist',
		)
		return
	}

	log('starting wa-bridge (run mode)')
	const handler = makeInboundHandler(config)
	const socketState = await createSocket(config, { onTextMessage: handler })
	await runOutboxLoop(config, socketState)
}

main().catch((err) => {
	log(`FATAL: ${String(err)}`)
	process.exit(1)
})
