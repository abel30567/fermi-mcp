import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fireQueueHook } from '../src/lib/queue-hooks.ts'
import { putSecret } from '../src/lib/secrets-store.ts'
import { clearSecrets, setupSecretsSchema } from './setup-d1.ts'

const workerEnv = env as unknown as Env
const HOOK_ORIGIN = 'https://grokbot.example.com'
const task = { task_id: 't_1', queue: 'grok-bot' }

async function configure(hosts = ['grokbot.example.com']) {
	await workerEnv.FERMI_KV.put(
		'queue:hooks',
		JSON.stringify({
			'grok-bot': {
				url: `${HOOK_ORIGIN}/wake`,
				auth_header: 'x-routine-key',
				secret: 'GROKBOT_WEBHOOK_KEY',
			},
		}),
	)
	await putSecret(
		{ name: 'GROKBOT_WEBHOOK_KEY', value: 'k-secret', scope: 'app', allowedHosts: hosts },
		workerEnv,
	)
}

function interceptWake(status: number, seen: Array<{ key: unknown; body: unknown }>, times = 1) {
	fetchMock
		.get(HOOK_ORIGIN)
		.intercept({ path: '/wake', method: 'POST' })
		.reply(status, (opts) => {
			const headers = new Headers(opts.headers as HeadersInit)
			seen.push({ key: headers.get('x-routine-key'), body: JSON.parse(String(opts.body)) })
			return {}
		})
		.times(times)
}

describe('fireQueueHook (fermi-mcp#12)', () => {
	beforeAll(async () => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
		await setupSecretsSchema()
	})
	beforeEach(async () => {
		await clearSecrets()
		await workerEnv.FERMI_KV.delete('queue:hooks')
	})
	afterEach(() => fetchMock.assertNoPendingInterceptors())

	it('is a no-op with no hook configured', async () => {
		// disableNetConnect makes any attempted fetch throw — reaching here means none fired
		await expect(fireQueueHook(workerEnv, task, [0])).resolves.toBeUndefined()
	})

	it('is a no-op for queues without a hook', async () => {
		await configure()
		await expect(
			fireQueueHook(workerEnv, { task_id: 't', queue: 'main' }, [0]),
		).resolves.toBeUndefined()
	})

	it('skips when the secret is missing', async () => {
		await configure()
		await clearSecrets()
		await expect(fireQueueHook(workerEnv, task, [0])).resolves.toBeUndefined()
	})

	it("skips when the hook host is not in the secret's allowed_hosts", async () => {
		await configure(['other.example.com'])
		await expect(fireQueueHook(workerEnv, task, [0])).resolves.toBeUndefined()
	})

	it('POSTs {task_id, queue} once with the secret-backed header', async () => {
		await configure()
		const seen: Array<{ key: unknown; body: unknown }> = []
		interceptWake(200, seen)
		await fireQueueHook(workerEnv, task, [0, 0, 0])
		expect(seen).toEqual([{ key: 'k-secret', body: task }])
	})

	it('retries 5xx a bounded number of times and never throws', async () => {
		await configure()
		const seen: Array<{ key: unknown; body: unknown }> = []
		interceptWake(503, seen, 3)
		await expect(fireQueueHook(workerEnv, task, [0, 0, 0])).resolves.toBeUndefined()
		expect(seen).toHaveLength(3)
	})

	it('does not retry a 4xx', async () => {
		await configure()
		const seen: Array<{ key: unknown; body: unknown }> = []
		interceptWake(401, seen)
		await fireQueueHook(workerEnv, task, [0, 0, 0])
		expect(seen).toHaveLength(1)
	})
})
