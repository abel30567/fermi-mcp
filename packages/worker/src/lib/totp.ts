// TOTP (RFC 6238) implementation using WebCrypto
// No npm dependencies - pure Cloudflare Workers compatible

const PERIOD = 30
const DIGITS = 6
const ALGORITHM = 'SHA-1'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: Uint8Array): string {
	let bits = ''
	for (const b of bytes) bits += b.toString(2).padStart(8, '0')
	let out = ''
	for (let i = 0; i < bits.length; i += 5) {
		const chunk = bits.slice(i, i + 5).padEnd(5, '0')
		out += BASE32_CHARS[Number.parseInt(chunk, 2)]
	}
	return out
}

function base32Decode(str: string): Uint8Array {
	let bits = ''
	for (const c of str.toUpperCase()) {
		const idx = BASE32_CHARS.indexOf(c)
		if (idx === -1) continue
		bits += idx.toString(2).padStart(5, '0')
	}
	const bytes = new Uint8Array(Math.floor(bits.length / 8))
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)
	}
	return bytes
}

export function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20))
	return base32Encode(bytes)
}

export function generateTotpUri(secret: string, label: string, issuer: string): string {
	const encodedLabel = encodeURIComponent(label)
	const encodedIssuer = encodeURIComponent(issuer)
	return (
		`otpauth://totp/${encodedIssuer}:${encodedLabel}` +
		`?secret=${secret}&issuer=${encodedIssuer}` +
		`&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`
	)
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: ALGORITHM },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
	return new Uint8Array(sig)
}

async function generateCode(secret: Uint8Array, counter: bigint): Promise<string> {
	const counterBytes = new Uint8Array(8)
	let c = counter
	for (let i = 7; i >= 0; i--) {
		counterBytes[i] = Number(c & 0xffn)
		c >>= 8n
	}

	const hmac = await hmacSha1(secret, counterBytes)

	const offset = hmac[hmac.length - 1] & 0x0f
	const binary =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff)

	const otp = binary % 10 ** DIGITS
	return otp.toString().padStart(DIGITS, '0')
}

export async function validateTotp(
	secretBase32: string,
	code: string,
	windowSize = 1,
): Promise<boolean> {
	if (code.length !== DIGITS) return false
	if (!/^\d+$/.test(code)) return false

	const secret = base32Decode(secretBase32)
	const now = Math.floor(Date.now() / 1000)
	const currentCounter = BigInt(Math.floor(now / PERIOD))

	for (let i = -windowSize; i <= windowSize; i++) {
		const counter = currentCounter + BigInt(i)
		const expected = await generateCode(secret, counter)
		if (expected === code) return true
	}

	return false
}
