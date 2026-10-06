import { enqueueOutbound } from '../lib/outbox-store.ts'
import { sendDiscordMessage } from './discord.ts'
import type { OutboundMedia } from './media.ts'
import { sendSlackMessage } from './slack.ts'
import { sendTelegramMedia, sendTelegramMessage } from './telegram.ts'
import { sendWhatsAppMessage } from './whatsapp.ts'

export const CHANNELS = ['tg', 'wa', 'dc', 'sl'] as const
export type Channel = (typeof CHANNELS)[number]

/**
 * Route an outbound message to the right channel transport. With `media`, the
 * message is a single attachment (caption = media.caption, else text):
 * wa/dc/sl rows go to the outbox so the Mac-local bridge can read local
 * files; tg is sent from here by URL.
 */
export async function sendChannelMessage(
	env: Env,
	channel: Channel,
	chatId: string,
	text: string,
	media?: OutboundMedia,
): Promise<void> {
	if (channel === 'wa') {
		await sendWhatsAppMessage(env, chatId, text, media)
		return
	}
	if (channel === 'dc' || channel === 'sl') {
		if (media) {
			await enqueueOutbound(env.FERMI_DB, { channel, chatId, body: text, media })
			return
		}
		if (channel === 'dc') await sendDiscordMessage(env, chatId, text)
		else await sendSlackMessage(env, chatId, text)
		return
	}
	if (media) {
		await sendTelegramMedia(env, chatId, text, media)
		return
	}
	await sendTelegramMessage(env, chatId, text)
}
