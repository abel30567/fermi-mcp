import { env, fetchMock } from 'cloudflare:test'
import type { Page } from '@cloudflare/puppeteer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAction } from '../src/lib/browser-actions.ts'
import { putSecret } from '../src/lib/secrets-store.ts'
import { dnsAnswers, mockDns } from './dns-mock.ts'
import { applyMigrations, clearSecrets } from './setup-d1.ts'

// MCP-30: browser actions substitute a secret only on a page whose host is in allowed_hosts.

const SECRET = 'pw-s3cr3t-value'

function fakePage(url: string) {
	const page = {
		url: () => url,
		type: vi.fn(async () => {}),
		evaluate: vi.fn(async () => 'done'),
		setCookie: vi.fn(async () => {}),
	}
	return { page, asPage: page as unknown as Page }
}

const typeSecret = { type: 'type', selector: '#pw', text: '{{secret:LOGIN_PW}}' } as const

describe('browser secret substitution allowlist (MCP-30)', () => {
	beforeAll(applyMigrations)
	beforeEach(async () => {
		await clearSecrets()
		await putSecret(
			{
				name: 'LOGIN_PW',
				value: SECRET,
				scope: 'app',
				allowedHosts: ['login.example.com', 'internal.example.com', '127.0.0.1', '[::1]'],
			},
			env,
		)
		dnsAnswers.clear()
		dnsAnswers.set('login.example.com', ['203.0.113.20'])
		fetchMock.activate()
		fetchMock.disableNetConnect()
		mockDns()
	})
	afterEach(() => fetchMock.deactivate())

	it('allowed flow is unchanged: the secret is typed on an approved page', async () => {
		const { page, asPage } = fakePage('https://login.example.com/signin')
		const r = await executeAction(asPage, typeSecret, env)
		expect(r.ok).toBe(true)
		expect(page.type).toHaveBeenCalledWith('#pw', SECRET, { delay: 0 })
	})

	it('a disallowed page gets no substitution', async () => {
		const { page, asPage } = fakePage('https://evil.example.net/phish')
		const r = await executeAction(asPage, typeSecret, env)
		expect(r.ok).toBe(false)
		expect(r.error).toContain('not approved for host "evil.example.net"')
		expect(page.type).not.toHaveBeenCalled()
	})

	it('evaluate on a disallowed page gets no substitution', async () => {
		const { page, asPage } = fakePage('https://evil.example.net/')
		const r = await executeAction(
			asPage,
			{ type: 'evaluate', script: 'login("{{secret:LOGIN_PW}}")' },
			env,
		)
		expect(r.ok).toBe(false)
		expect(page.evaluate).not.toHaveBeenCalled()
	})

	it('a cookie targeting another domain gets no substitution, even from an approved page', async () => {
		const { page, asPage } = fakePage('https://login.example.com/')
		const r = await executeAction(
			asPage,
			{
				type: 'setCookies',
				cookies: [{ name: 'sid', value: '{{secret:LOGIN_PW}}', domain: '.evil.example.net' }],
			},
			env,
		)
		expect(r.ok).toBe(false)
		expect(page.setCookie).not.toHaveBeenCalled()
	})

	it('about:blank (no page yet) gets no substitution', async () => {
		const { page, asPage } = fakePage('about:blank')
		const r = await executeAction(asPage, typeSecret, env)
		expect(r.ok).toBe(false)
		expect(page.type).not.toHaveBeenCalled()
	})

	it.each(['http://127.0.0.1/login', 'http://[::1]/login'])(
		'a private/loopback literal page gets no substitution even if allowlisted: %s',
		async (url) => {
			const { page, asPage } = fakePage(url)
			const r = await executeAction(asPage, typeSecret, env)
			expect(r.ok).toBe(false)
			expect(r.error).toContain('private address')
			expect(page.type).not.toHaveBeenCalled()
		},
	)

	it('an allowlisted name resolving to a private IP gets no substitution', async () => {
		dnsAnswers.set('internal.example.com', ['192.168.0.9'])
		const { page, asPage } = fakePage('https://internal.example.com/')
		const r = await executeAction(asPage, typeSecret, env)
		expect(r.ok).toBe(false)
		expect(r.error).toContain('resolves to a private address')
		expect(page.type).not.toHaveBeenCalled()
	})
})
