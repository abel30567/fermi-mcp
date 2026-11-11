// Destination checks shared by the fetch gateway and browser secret substitution.
//
// Limits (documented, MCP-30):
// - The literal check is exact: any IPv4/IPv6 literal in a private, loopback,
//   link-local, CGNAT, multicast or reserved range is refused, as is `localhost`.
// - The DNS check is best-effort. It resolves A/AAAA over DNS-over-HTTPS and refuses
//   a name whose answers include a private address. It cannot stop DNS rebinding
//   (the runtime resolves again when it connects), and a resolver failure is treated
//   as "no private answer" so an outage does not break every secret-bearing request.

function parseIPv4(s: string): number[] | null {
	const parts = s.split('.')
	if (parts.length !== 4) return null
	const out: number[] = []
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return null
		const n = Number(p)
		if (n > 255) return null
		out.push(n)
	}
	return out
}

function parseIPv6(input: string): number[] | null {
	if (!input.includes(':')) return null
	let s = input
	let tail: number[] = []
	const lastColon = s.lastIndexOf(':')
	const maybeV4 = parseIPv4(s.slice(lastColon + 1))
	if (maybeV4) {
		tail = [(maybeV4[0] << 8) | maybeV4[1], (maybeV4[2] << 8) | maybeV4[3]]
		s = `${s.slice(0, lastColon)}:0:0`
	}
	const halves = s.split('::')
	if (halves.length > 2) return null
	const toGroups = (h: string) => (h === '' ? [] : h.split(':'))
	const head = toGroups(halves[0])
	const rest = halves.length === 2 ? toGroups(halves[1]) : []
	const fill = 8 - head.length - rest.length
	if (halves.length === 2 ? fill < 0 : fill !== 0) return null
	const groups: number[] = []
	for (const g of [...head, ...Array(fill).fill('0'), ...rest]) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
		groups.push(Number.parseInt(g, 16))
	}
	if (tail.length) groups.splice(6, 2, ...tail)
	return groups
}

function isPrivateIPv4([a, b, c]: number[]): boolean {
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 198 && (b === 18 || b === 19))
	)
}

function isPrivateIPv6(g: number[]): boolean {
	const embeddedV4 = () => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]
	if (g.slice(0, 7).every((x) => x === 0)) return g[7] <= 1 // :: and ::1
	// IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d carry an IPv4 target.
	if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4())
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
		return isPrivateIPv4(embeddedV4())
	}
	return (
		(g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
		(g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
		(g[0] & 0xff00) === 0xff00 // ff00::/8 multicast
	)
}

/** True for `localhost` and for IP literals that point at a private/loopback/reserved address. */
export function isPrivateAddress(hostname: string): boolean {
	const h = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '')
	if (h === 'localhost' || h.endsWith('.localhost')) return true
	const v4 = parseIPv4(h)
	if (v4) return isPrivateIPv4(v4)
	const v6 = parseIPv6(h)
	if (v6) return isPrivateIPv6(v6)
	return false
}

function isIpLiteral(hostname: string): boolean {
	const h = hostname.replace(/^\[|\]$/g, '')
	return parseIPv4(h) !== null || parseIPv6(h) !== null
}

export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'

/** Best-effort: true when the name's A/AAAA answers include a private address. See limits above. */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
	if (isIpLiteral(hostname)) return isPrivateAddress(hostname)
	const lookups = ['A', 'AAAA'].map(async (type) => {
		try {
			const res = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`, {
				headers: { accept: 'application/dns-json' },
			})
			if (!res.ok) return false
			const body = (await res.json()) as { Answer?: { type: number; data: string }[] }
			return (body.Answer ?? []).some(
				(a) => (a.type === 1 || a.type === 28) && isPrivateAddress(a.data),
			)
		} catch {
			return false
		}
	})
	return (await Promise.all(lookups)).some(Boolean)
}
