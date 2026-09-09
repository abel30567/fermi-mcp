import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleBoxSessionLease, sha256Hex } from '../src/channels/box-gateway.ts'
import {
	handleBoxBrowserRpc,
	handleBoxBrowserRpcWait,
	handleBrokerClaim,
	handleBrokerComplete,
} from '../src/channels/broker.ts'
import { createCloudAgent, registerBox } from '../src/lib/fleet-store.ts'
import { enqueueTask } from '../src/lib/task-store.ts'
import { captureWebSession, invalidateWebSession } from '../src/lib/web-session-store.ts'
import {
	clearFleet,
	clearTasks,
	clearWebSessions,
	setupFleetSchema,
	setupTasksSchema,
	setupWebSessionSchema,
} from './setup-d1.ts'

const SECRET = 'broker-secret'
const AGENT_ID = 'ca_broker'
const QUEUE = `agent:${AGENT_ID}`
const CANARY = `CANARY_${'c0ffee'.repeat(6)}`
const STATE = JSON.stringify({ cookies: [{ name: 'sid', value: CANARY }], origins: [] })

function boxReq(path: string, body: unknown = {}): Request {
	return new Request(`https://fermi.test${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer box-b.${SECRET}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

function adminReq(path: string, body: unknown = {}): Request {
	return new Request(`https://fermi.test${path}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${env.FERMI_BEARER_TOKEN}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(body),
	})
}

async function seed() {
	await registerBox(env.FERMI_DB, {
		boxId: 'box-b',
		provider: 'aws',
		meta: { agent_id: AGENT_ID, instance_type: 't3.small', token_hash: await sha256Hex(SECRET) },
	})
	const task = await enqueueTask(env.FERMI_DB, {
		channel: 'cloud',
		sender: `cloud_agent:${AGENT_ID}`,
		chatId: 'cloud',
		payload: JSON.stringify({ prompt: 'verify', sessions: ['gmail'] }),
		queue: QUEUE,
	})
	await createCloudAgent(env.FERMI_DB, {
		id: AGENT_ID,
		queue: QUEUE,
		prompt: 'verify',
		proofContract: '{"kind":"test","cmd":"true"}',
		taskId: task.id,
	})
	await captureWebSession(env, {
		name: 'gmail',
		site: 'https://mail.google.com',
		storageState: STATE,
		maxConcurrent: 2,
	})
}

describe('session broker (#32)', () => {
	beforeAll(async () => {
		await setupFleetSchema()
		await setupTasksSchema()
		await setupWebSessionSchema()
	})
	beforeEach(async () => {
		await clearFleet()
		await clearTasks()
		await clearWebSessions()
		await seed()
	})

	it('leak witness: /box/session-lease returns a broker handle, never cookies', async () => {
		const res = await handleBoxSessionLease(boxReq('/box/session-lease', { name: 'gmail' }), env)
		expect(res.status).toBe(200)
		const text = await res.text()
		expect(text).not.toContain(CANARY)
		expect(text).not.toContain('storage_state')
		expect(text).not.toContain('cookies')
		const body = JSON.parse(text) as { mode?: string; session?: string; site?: string }
		expect(body.mode).toBe('broker')
		expect(body.session).toBe('gmail')
		expect(body.site).toBe('https://mail.google.com')
	})

	it('rpc: submit → mac claims → completes → box waits; canary never crosses', async () => {
		const submit = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'gmail',
				op: 'extract',
				args: { url: 'https://mail.google.com/mail/u/0/', selector: 'tr.zA' },
			}),
			env,
		)
		expect(submit.status).toBe(200)
		const { op_id } = (await submit.json()) as { op_id: string }
		expect(op_id).toBeTruthy()

		// Mac executor claims the op — the ONLY party that ever sees state.
		const claim = await handleBrokerClaim(adminReq('/admin/broker/claim'), env)
		expect(claim.status).toBe(200)
		const claimed = (await claim.json()) as { op?: { id: string; payload: string } }
		expect(claimed.op?.id).toBe(op_id)
		const payload = JSON.parse(claimed.op?.payload ?? '{}')
		expect(payload.session).toBe('gmail')
		// The op payload routed to the executor carries no cookie material either
		// (executor pulls state itself via /admin/session/state).
		expect(claimed.op?.payload).not.toContain(CANARY)

		const complete = await handleBrokerComplete(
			adminReq('/admin/broker/complete', {
				op_id,
				ok: true,
				data: { rows: ['Subject: hello'] },
			}),
			env,
		)
		expect(complete.status).toBe(200)

		const wait = await handleBoxBrowserRpcWait(boxReq('/box/browser-rpc/wait', { op_id }), env)
		const text = await wait.text()
		expect(wait.status).toBe(200)
		expect(text).toContain('Subject: hello')
		expect(text).not.toContain(CANARY)
	})

	it('origin allowlist: ops outside the session site are refused', async () => {
		const res = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'gmail',
				op: 'goto',
				args: { url: 'https://attacker.example.com/exfil' },
			}),
			env,
		)
		expect(res.status).toBe(403)
		expect(((await res.json()) as { error?: string }).error).toBe('origin_not_allowed')
	})

	it('launch binding: sessions not named in the launch are refused', async () => {
		await captureWebSession(env, {
			name: 'other',
			site: 'https://example.com',
			storageState: STATE,
		})
		const res = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'other',
				op: 'goto',
				args: { url: 'https://example.com' },
			}),
			env,
		)
		expect(res.status).toBe(403)
	})

	it('invalidate kills in-flight access: next rpc on the session is refused', async () => {
		const first = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'gmail',
				op: 'goto',
				args: { url: 'https://mail.google.com' },
			}),
			env,
		)
		expect(first.status).toBe(200)
		await invalidateWebSession(env, 'gmail')
		const after = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'gmail',
				op: 'goto',
				args: { url: 'https://mail.google.com' },
			}),
			env,
		)
		expect(after.status).toBe(403)
	})

	it('wait is box-scoped: another box cannot read op results', async () => {
		const submit = await handleBoxBrowserRpc(
			boxReq('/box/browser-rpc', {
				session: 'gmail',
				op: 'goto',
				args: { url: 'https://mail.google.com' },
			}),
			env,
		)
		const { op_id } = (await submit.json()) as { op_id: string }
		await registerBox(env.FERMI_DB, {
			boxId: 'box-z',
			provider: 'aws',
			meta: { agent_id: 'ca_other', token_hash: await sha256Hex('other-secret') },
		})
		const stranger = await handleBoxBrowserRpcWait(
			new Request('https://fermi.test/box/browser-rpc/wait', {
				method: 'POST',
				headers: {
					authorization: 'Bearer box-z.other-secret',
					'content-type': 'application/json',
				},
				body: JSON.stringify({ op_id }),
			}),
			env,
		)
		expect(stranger.status).toBe(403)
	})
})
