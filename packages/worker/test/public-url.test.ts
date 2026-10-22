import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createCanvas } from '../src/lib/canvas-store.ts'
import { publicBaseUrl } from '../src/lib/public-url.ts'
import type { FermiMCP } from '../src/mcp/index.ts'
import { registerOauthTools } from '../src/mcp/tools/oauth.ts'

const workerEnv = env as unknown as Env

const fakeCanvasDO = {
	idFromName: (name: string) => name,
	get: () => ({ fetch: async () => Response.json({ ok: true }) }),
} as unknown as DurableObjectNamespace

// Answers every D1 query: the oauth_clients lookup gets a client row, everything else is empty.
const fakeDb = {
	prepare: (sql: string) => {
		const stmt = {
			bind: () => stmt,
			first: async () =>
				sql.includes('oauth_clients')
					? {
							name: 'gh',
							client_id: 'cid',
							client_secret_name: 'GH_SECRET',
							auth_url: 'https://github.com/login/oauth/authorize',
							token_url: 'https://github.com/login/oauth/access_token',
							scopes: '[]',
							redirect_path: '/oauth/callback',
							result_secret_name: 'GH_TOKEN',
							result_allowed_hosts: '[]',
							created_at: 0,
							updated_at: 0,
						}
					: null,
			all: async () => ({ results: [] }),
			run: async () => ({ meta: {} }),
		}
		return stmt
	},
} as unknown as D1Database

function testEnv(overrides: Partial<Env>): Env {
	return { ...workerEnv, CANVAS_DO: fakeCanvasDO, FERMI_DB: fakeDb, ...overrides }
}

async function oauthStartUrl(e: Env): Promise<string> {
	const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()
	const agent = {
		principal: 'owner',
		bindings: e,
		state: {},
		server: {
			tool: (name: string, ...rest: unknown[]) => {
				handlers.set(name, rest.at(-1) as (args: Record<string, unknown>) => Promise<unknown>)
			},
		},
	} as unknown as FermiMCP
	registerOauthTools(agent)
	const handler = handlers.get('oauth_authorize_url')
	if (!handler) throw new Error('oauth_authorize_url not registered')
	const result = (await handler({ name: 'gh' })) as { content: Array<{ text: string }> }
	return (JSON.parse(result.content[0].text) as { start_url: string }).start_url
}

describe('FERMI_PUBLIC_URL', () => {
	it('is the base of canvas and OAuth URLs when set', async () => {
		const e = testEnv({ FERMI_PUBLIC_URL: 'https://x.test', FERMI_ENV: 'production' })
		expect(publicBaseUrl(e)).toBe('https://x.test')
		expect((await createCanvas('t', {}, e)).url).toMatch(/^https:\/\/x\.test\/canvas\//)
		expect(await oauthStartUrl(e)).toBe('https://x.test/oauth/start?provider=gh')
	})

	it('drops a trailing slash', () => {
		expect(publicBaseUrl(testEnv({ FERMI_PUBLIC_URL: 'https://x.test/' }))).toBe('https://x.test')
	})

	it('keeps the old defaults when unset', async () => {
		const prod = testEnv({ FERMI_PUBLIC_URL: undefined, FERMI_ENV: 'production' })
		expect((await createCanvas('t', {}, prod)).url).toMatch(
			/^https:\/\/fermi\.example\.workers\.dev\/canvas\//,
		)
		expect(await oauthStartUrl(prod)).toBe(
			'https://fermi.example.workers.dev/oauth/start?provider=gh',
		)

		const dev = testEnv({ FERMI_PUBLIC_URL: undefined, FERMI_ENV: 'development' })
		expect((await createCanvas('t', {}, dev)).url).toMatch(/^http:\/\/localhost:8787\/canvas\//)
		expect(await oauthStartUrl(dev)).toBe('http://localhost:8787/oauth/start?provider=gh')
	})
})
