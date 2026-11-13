import { z } from 'zod'
import { readDiscordChannel } from '../../channels/discord-read.ts'
import { sendChannelMessage } from '../../channels/dispatch.ts'
import {
	MediaValidationError,
	describeOutboundMedia,
	outboundMediaSchema,
	validateOutboundMedia,
} from '../../channels/media.ts'
import { logChannelMessage } from '../../lib/conversation.ts'
import { approvePairing } from '../../lib/pairing.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerChannelTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'channel_send',
		description:
			'Send a message to a channel chat (used by the local daemon to reply to queued tasks). The bot token stays server-side. Pass `media` to send an image/document/audio/video as a real attachment: a media call sends ONE attachment message whose caption is media.caption (else text). Local `path` must be under ~/fermi-daemon/media/out/ and is delivered by the Mac-local bridge (wa/dc/sl); tg only accepts `url`.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc', 'sl']).describe('Channel to send through'),
			chat_id: z.string().describe('Channel-specific chat id (from the task row)'),
			text: z.string().describe('Message text to send (caption fallback when media is set)'),
			media: outboundMediaSchema.optional().describe('Optional attachment to send'),
		},
		scope: ['write:channels', 'network'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			let media: ReturnType<typeof validateOutboundMedia> | undefined
			if (args.media) {
				try {
					media = validateOutboundMedia(args.media, args.channel)
				} catch (err) {
					if (!(err instanceof MediaValidationError)) throw err
					return {
						content: [
							{ type: 'text' as const, text: JSON.stringify({ ok: false, error: err.message }) },
						],
					}
				}
			}
			await sendChannelMessage(env, args.channel, args.chat_id, args.text, media)
			const logged = media
				? [args.text, describeOutboundMedia(media)].filter(Boolean).join(' ')
				: args.text
			await logChannelMessage(env.FERMI_DB, args.channel, args.chat_id, 'assistant', logged)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ ok: true, channel: args.channel }) },
				],
			}
		},
	})

	defineTool(agent, {
		name: 'channel_read',
		description:
			'Read recent messages from a Discord channel the bot can see, to use as context (e.g. "check the announcements channel for a date"). The bot only needs read access to the channel — it does not need to be allowlisted/interactive there. Provide channel_id directly, or guild_id + channel_name to look it up by name. Optional keyword filter.',
		schema: {
			channel: z.enum(['dc']).describe('Only Discord supports reading channel history'),
			channel_id: z.string().optional().describe('Discord channel id to read'),
			guild_id: z
				.string()
				.optional()
				.describe('Server id — with channel_name, resolves the channel by name'),
			channel_name: z
				.string()
				.optional()
				.describe('Channel name (e.g. "announcements") — requires guild_id'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.default(20)
				.describe('How many recent messages'),
			query: z.string().optional().describe('Only return messages containing this text'),
		},
		scope: ['read', 'network'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			try {
				const result = await readDiscordChannel(env, {
					channelId: args.channel_id,
					guildId: args.guild_id,
					channelName: args.channel_name,
					limit: args.limit,
					query: args.query,
				})
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ ...result, total: result.messages.length }),
						},
					],
				}
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
						},
					],
				}
			}
		},
	})

	defineTool(agent, {
		name: 'channel_pair_approve',
		description:
			'Approve a channel pairing code (shown to an unknown sender by the webhook) and add that sender to the channel allowlist.',
		schema: {
			code: z.string().describe('The pairing code the sender received'),
		},
		scope: ['write:channels'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const result = await approvePairing(env, args.code)
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})
}
