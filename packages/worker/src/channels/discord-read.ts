const API = 'https://discord.com/api/v10'

interface DiscordMessageRow {
	author: string
	author_id: string
	content: string
	timestamp: string
}

async function discordGet(env: Env, path: string): Promise<unknown> {
	const token = env.DISCORD_BOT_TOKEN
	if (!token) throw new Error('DISCORD_BOT_TOKEN not configured')
	const res = await fetch(`${API}${path}`, {
		headers: { Authorization: `Bot ${token}` },
	})
	if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text()).slice(0, 120)}`)
	return res.json()
}

/** Resolve a text-channel id by name within a guild (case-insensitive). */
async function resolveChannelId(
	env: Env,
	guildId: string,
	channelName: string,
): Promise<string | null> {
	const chans = (await discordGet(env, `/guilds/${guildId}/channels`)) as Array<{
		id: string
		name: string
		type: number
	}>
	const want = channelName.replace(/^#/, '').toLowerCase()
	const match = chans.find((c) => c.type === 0 && c.name.toLowerCase() === want)
	return match?.id ?? null
}

/**
 * Read recent messages from a Discord channel the bot can see, for use as
 * context (bot token stays server-side). Provide channel_id directly, or a
 * guild_id + channel_name to resolve it. Optional keyword filter.
 */
export async function readDiscordChannel(
	env: Env,
	input: {
		channelId?: string
		guildId?: string
		channelName?: string
		limit?: number
		query?: string
	},
): Promise<{ channel_id: string; messages: DiscordMessageRow[] }> {
	let channelId = input.channelId
	if (!channelId && input.guildId && input.channelName) {
		const resolved = await resolveChannelId(env, input.guildId, input.channelName)
		if (!resolved) throw new Error(`channel '${input.channelName}' not found in guild`)
		channelId = resolved
	}
	if (!channelId) throw new Error('provide channel_id, or guild_id + channel_name')

	const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
	const raw = (await discordGet(env, `/channels/${channelId}/messages?limit=${limit}`)) as Array<{
		content: string
		timestamp: string
		author: { id: string; global_name?: string | null; username: string }
	}>

	let rows: DiscordMessageRow[] = raw.map((m) => ({
		author: m.author.global_name ?? m.author.username,
		author_id: m.author.id,
		content: m.content,
		timestamp: m.timestamp,
	}))
	if (input.query) {
		const q = input.query.toLowerCase()
		rows = rows.filter((r) => r.content.toLowerCase().includes(q))
	}
	// Discord returns newest-first; present chronological for readability.
	rows.reverse()
	return { channel_id: channelId, messages: rows }
}
