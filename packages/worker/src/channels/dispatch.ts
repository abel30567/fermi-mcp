import { sendDiscordMessage } from './discord.ts'
import { sendSlackMessage } from './slack.ts'
import { sendTelegramMessage } from './telegram.ts'
import { sendWhatsAppMessage } from './whatsapp.ts'

export const CHANNELS = ['tg', 'wa', 'dc', 'sl'] as const
export type Channel = (typeof CHANNELS)[number]

/** Route an outbound message to the right channel transport. */
export async function sendChannelMessage(
	env: Env,
	channel: Channel,
	chatId: string,
	text: string,
): Promise<void> {
	if (channel === 'wa') {
		await sendWhatsAppMessage(env, chatId, text)
		return
	}
	if (channel === 'dc') {
		await sendDiscordMessage(env, chatId, text)
		return
	}
	if (channel === 'sl') {
		await sendSlackMessage(env, chatId, text)
		return
	}
	await sendTelegramMessage(env, chatId, text)
}
