const HKDF_INFO = new TextEncoder().encode('fermi:secrets:v1')
const HKDF_SALT = new TextEncoder().encode('fermi-secrets-store')

function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) throw new Error('FERMI_SECRETS_KEY must be hex')
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return bytes
}

async function deriveAesKey(env: Env): Promise<CryptoKey> {
	if (!env.FERMI_SECRETS_KEY) {
		throw new Error('FERMI_SECRETS_KEY is not configured')
	}
	const masterBytes = hexToBytes(env.FERMI_SECRETS_KEY)
	if (masterBytes.length < 16) {
		throw new Error('FERMI_SECRETS_KEY must be at least 16 bytes (32 hex chars)')
	}
	const baseKey = await crypto.subtle.importKey('raw', masterBytes as BufferSource, 'HKDF', false, [
		'deriveKey',
	])
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	)
}

export async function encryptSecret(
	plaintext: string,
	env: Env,
): Promise<{ encrypted: ArrayBuffer; iv: ArrayBuffer }> {
	const key = await deriveAesKey(env)
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(plaintext),
	)
	return { encrypted, iv: iv.buffer }
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
	}
	if (Array.isArray(value)) return new Uint8Array(value)
	const ctor =
		value && typeof value === 'object'
			? (value as { constructor?: { name?: string } }).constructor?.name
			: '?'
	throw new Error(`Cannot coerce value to Uint8Array (type: ${typeof value}, ctor: ${ctor})`)
}

export async function decryptSecret(
	record: { encrypted_value: ArrayBuffer | Uint8Array; iv: ArrayBuffer | Uint8Array },
	env: Env,
): Promise<string> {
	const key = await deriveAesKey(env)
	const iv = toBytes(record.iv)
	const ciphertext = toBytes(record.encrypted_value)
	const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
	return new TextDecoder().decode(decrypted)
}
