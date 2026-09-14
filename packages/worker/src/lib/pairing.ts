import { addToAllowlist } from './allowlist-store.ts'

interface PairingRecord {
	channel: string
	senderId: string
	chatId: string
}

export type PairingResult =
	| { ok: true; channel: string; senderId: string; chatId: string }
	| { ok: false; error: string }

/**
 * Consume a pairing code (written by a channel webhook for an unknown sender)
 * and add the sender to that channel's D1 allowlist. The pairing code record
 * itself still lives in KV.
 */
export async function approvePairing(env: Env, code: string): Promise<PairingResult> {
	const key = `pairing:${code.trim().toUpperCase()}`
	const raw = await env.FERMI_KV.get(key)
	if (!raw) return { ok: false, error: 'invalid_or_expired_code' }

	const record = JSON.parse(raw) as PairingRecord
	if (
		record.channel !== 'tg' &&
		record.channel !== 'wa' &&
		record.channel !== 'dc' &&
		record.channel !== 'sl'
	) {
		return { ok: false, error: `unknown_channel:${record.channel}` }
	}

	await addToAllowlist(env.FERMI_DB, {
		channel: record.channel,
		senderId: record.senderId,
		addedBy: 'pairing',
	})
	await env.FERMI_KV.delete(key)
	return { ok: true, channel: record.channel, senderId: record.senderId, chatId: record.chatId }
}
