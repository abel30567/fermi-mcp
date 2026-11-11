import { fetchMock } from 'cloudflare:test'

/** name -> IPs answered by the mocked DNS-over-HTTPS resolver. Unlisted names get no answer. */
export const dnsAnswers = new Map<string, string[]>()
/** Names that make the resolver fail with a 500. */
export const dnsFailures = new Set<string>()

/** Registers one persistent DoH interceptor driven by `dnsAnswers`. Call after fetchMock.activate(). */
export function mockDns() {
	fetchMock
		.get('https://cloudflare-dns.com')
		.intercept({ path: (p) => p.startsWith('/dns-query'), method: 'GET' })
		.reply((opts) => {
			const q = new URL(opts.path, 'https://dns.test').searchParams
			const name = q.get('name') ?? ''
			if (dnsFailures.has(name)) return { statusCode: 500, data: '' }
			const v6 = q.get('type') === 'AAAA'
			const ips = (dnsAnswers.get(name) ?? []).filter((ip) => ip.includes(':') === v6)
			return {
				statusCode: 200,
				data: JSON.stringify({ Answer: ips.map((data) => ({ type: v6 ? 28 : 1, data })) }),
			}
		})
		.persist()
}
