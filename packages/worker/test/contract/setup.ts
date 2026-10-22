import { applyD1Migrations, env, fetchMock } from 'cloudflare:test'
import { beforeAll, beforeEach } from 'vitest'
import { macBridgeReply } from './fake-mac.ts'

// The contract project shares one D1 across tests (isolatedStorage is off for
// the McpAgent Durable Objects), so build the real schema once from
// migrations/ and reset the tables the guardrail tests assert on.
const RESET_TABLES = ['audit', 'hooks', 'retrievers', 'boxes', 'approval_tokens']

beforeAll(async () => {
	const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] }
	await applyD1Migrations(env.FERMI_DB, TEST_MIGRATIONS)

	// No test touches the network: anything not intercepted below throws.
	fetchMock.activate()
	fetchMock.disableNetConnect()
	fetchMock
		.get('http://mac.test')
		.intercept({ path: /.*/, method: /.*/ })
		.reply(macBridgeReply)
		.persist()
})

beforeEach(async () => {
	await env.FERMI_DB.batch(RESET_TABLES.map((t) => env.FERMI_DB.prepare(`DELETE FROM ${t}`)))
})
