import { env, fetchMock } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { wakeMacDaemon } from '../src/lib/mac-wake.ts'

const BRIDGE = 'https://mac-bridge.example.com'

describe('wakeMacDaemon', () => {
	beforeAll(() => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
	})

	it('is a no-op when the bridge is not configured', async () => {
		// disableNetConnect makes any attempted fetch throw — reaching here means none fired
		await expect(wakeMacDaemon(env as unknown as Env)).resolves.toBeUndefined()
	})

	it('runs poll.sh on the Mac via the bridge mac_shell tool', async () => {
		const bodies: Array<{
			method: string
			params?: { name?: string; arguments?: { command?: string } }
		}> = []
		fetchMock
			.get(BRIDGE)
			.intercept({ path: '/mcp', method: 'POST' })
			.reply(
				200,
				(opts) => {
					const body = JSON.parse(String(opts.body))
					bodies.push(body)
					if (body.method === 'initialize') return { result: { capabilities: {} } }
					if (body.method === 'tools/call') {
						return { result: { content: [{ type: 'text', text: 'ok' }] } }
					}
					return {}
				},
				{ headers: { 'mcp-session-id': 'sess-test-1' } },
			)
			.persist()

		const bridgeEnv = {
			...env,
			MACOS_MCP_URL: BRIDGE,
			MACOS_MCP_TOKEN: 'test-bridge-token',
		} as unknown as Env

		await wakeMacDaemon(bridgeEnv)

		const call = bodies.find((b) => b.method === 'tools/call')
		expect(call?.params?.name).toBe('mac_shell')
		expect(call?.params?.arguments?.command).toContain('fermi-daemon/poll.sh')
	})
})
