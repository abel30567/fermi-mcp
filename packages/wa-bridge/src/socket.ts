import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DisconnectReason, makeWASocket, useMultiFileAuthState } from 'baileys'
import pino from 'pino'
import qrcodeTerminal from 'qrcode-terminal'
import type { Config } from './config.ts'
import { log } from './log.ts'

type WASocket = ReturnType<typeof makeWASocket>

export type Handlers = {
	onTextMessage(sender: string, chatId: string, text: string): Promise<void>
}

// Read by the outbox loop so it only sends while the socket is live.
export type SocketState = {
	currentSocket(): WASocket | null
	isOpen(): boolean
}

const MAX_BACKOFF_MS = 60000
const INITIAL_BACKOFF_MS = 2000
const LOGGED_OUT_HELP = [
	'This device was logged out of WhatsApp (removed from Linked Devices, or logged out remotely).',
	'To recover:',
	'  1. Stop the LaunchAgent:  launchctl bootout gui/$UID/com.fermi.wa-bridge',
	'  2. Delete the auth dir:   rm -rf ~/fermi-daemon/wa-auth',
	'  3. Re-pair:               cd ~/fermi-daemon/wa-bridge && npm run pair -- <E164-digits>',
	'  4. Start the agent again: launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.fermi.wa-bridge.plist',
].join('\n')

function markerPath(config: Config): string {
	return join(config.AUTH_DIR, 'LOGGED_OUT')
}

function printPairingCode(code: string): void {
	const line = '='.repeat(48)
	console.log(`\n${line}`)
	console.log('  WHATSAPP PAIRING CODE (enter on your phone):')
	console.log('  WhatsApp > Settings > Linked Devices > Link a device')
	console.log('  > Link with phone number instead')
	console.log(`\n      ${code}\n`)
	console.log(`${line}\n`)
}

export async function createSocket(
	config: Config,
	handlers: Handlers,
	pairNumber?: string,
): Promise<SocketState> {
	if (existsSync(markerPath(config))) {
		log('refusing to start: LOGGED_OUT marker present.')
		log(LOGGED_OUT_HELP)
		process.exit(1)
	}

	mkdirSync(config.AUTH_DIR, { recursive: true, mode: 0o700 })
	const logger = pino({ level: 'silent' })

	let sock: WASocket | null = null
	let open = false
	let backoff = INITIAL_BACKOFF_MS
	let pairingRequested = false
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null

	async function start(): Promise<void> {
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer)
			reconnectTimer = null
		}
		const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_DIR)
		sock = makeWASocket({ auth: state, logger })
		open = false

		sock.ev.on('creds.update', saveCreds)

		sock.ev.on('messages.upsert', ({ messages, type }) => {
			if (type !== 'notify') return
			for (const m of messages) {
				if (!m.message || m.key.fromMe) continue
				const jid = m.key.remoteJid
				if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue
				const text = m.message.conversation ?? m.message.extendedTextMessage?.text

				if (jid.endsWith('@g.us')) {
					// Groups: sender is the participant (often @lid in lid-addressed
					// groups); participantAlt carries its phone-number JID. chatId is
					// the FULL group jid so the Worker routes replies back to the group.
					const key = m.key as { participant?: string; participantAlt?: string }
					const { participant, participantAlt } = key
					let sender: string | null = null
					if (participant?.endsWith('@s.whatsapp.net')) {
						sender = participant.split('@')[0]
					} else if (participant?.endsWith('@lid') && participantAlt?.endsWith('@s.whatsapp.net')) {
						sender = participantAlt.split('@')[0]
					}
					if (!sender || !text) {
						if (!sender) {
							log(`group sender unresolved: jid=${jid} participant=${participant ?? 'none'}`)
						} else {
							log(
								`inbound skipped: jid=${jid} resolved=${sender} hasText=${Boolean(text)} msgKeys=${Object.keys(m.message).join(',')}`,
							)
						}
						continue
					}
					handlers.onTextMessage(sender, jid, text).catch((err) => {
						log(`onTextMessage error: ${String(err)}`)
					})
					continue
				}

				// DMs arrive as @s.whatsapp.net or (2025+ privacy addressing) @lid.
				// For @lid, senderPn/remoteJidAlt carry the real phone-number JID.
				let phoneJid: string | null = null
				if (jid.endsWith('@s.whatsapp.net')) {
					phoneJid = jid
				} else if (jid.endsWith('@lid')) {
					const key = m.key as { senderPn?: string; remoteJidAlt?: string }
					const alt = key.senderPn ?? key.remoteJidAlt
					if (alt?.endsWith('@s.whatsapp.net')) phoneJid = alt
				}
				if (!phoneJid || !text) {
					log(
						`inbound skipped: jid=${jid} resolved=${phoneJid ?? 'none'} hasText=${Boolean(text)} msgKeys=${Object.keys(m.message).join(',')}`,
					)
					continue
				}
				const sender = phoneJid.split('@')[0]
				handlers.onTextMessage(sender, sender, text).catch((err) => {
					log(`onTextMessage error: ${String(err)}`)
				})
			}
		})

		sock.ev.on('connection.update', (update) => {
			const { connection, lastDisconnect, qr } = update

			if (qr) {
				if (pairNumber && !pairingRequested) {
					pairingRequested = true
					sock
						?.requestPairingCode(pairNumber)
						.then((code) => printPairingCode(code))
						.catch((err) => log(`requestPairingCode failed: ${String(err)}`))
				} else if (pairNumber) {
					// Fallback: show the QR too in case pairing-code entry is unavailable.
					qrcodeTerminal.generate(qr, { small: true })
				} else {
					log(
						'received a QR/pairing request but no saved credentials — re-pair with `npm run pair -- <number>`.',
					)
				}
			}

			if (connection === 'open') {
				open = true
				backoff = INITIAL_BACKOFF_MS
				log(`connected as ${sock?.user?.id ?? 'unknown'} lid=${sock?.user?.lid ?? 'none'}`)
			} else if (connection === 'close') {
				open = false
				const statusCode = (
					lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
				)?.output?.statusCode

				if (statusCode === DisconnectReason.loggedOut) {
					log('logged out by WhatsApp — writing LOGGED_OUT marker and exiting.')
					try {
						writeFileSync(markerPath(config), `${LOGGED_OUT_HELP}\n`)
					} catch (err) {
						log(`failed to write LOGGED_OUT marker: ${String(err)}`)
					}
					process.exit(1)
				} else if (statusCode === DisconnectReason.restartRequired) {
					log('restart required (normal after pairing) — recreating socket.')
					start().catch((err) => log(`restart failed: ${String(err)}`))
				} else {
					log(
						`connection closed (status ${statusCode ?? 'unknown'}) — reconnecting in ${backoff}ms.`,
					)
					reconnectTimer = setTimeout(() => {
						start().catch((err) => log(`reconnect failed: ${String(err)}`))
					}, backoff)
					backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
				}
			}
		})
	}

	await start()
	return {
		currentSocket: () => sock,
		isOpen: () => open,
	}
}
