import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
	authBox,
	handleBoxArtifact,
	handleBoxComplete,
	handleBoxHeartbeat,
	handleBoxInferenceAuth,
	handleBoxInferenceAuthUpdate,
	handleBoxPoll,
	handleBoxReport,
	handleBoxSessionLease,
	listAgentArtifacts,
	sha256Hex,
} from '../src/channels/box-gateway.ts'
import {
	createCloudAgent,
	getBox,
	getCloudAgent,
	registerBox,
	updateBox,
} from '../src/lib/fleet-store.ts'
import { getSecret, putSecret } from '../src/lib/secrets-store.ts'
import { enqueueTask, listTasks } from '../src/lib/task-store.ts'
import {
	clearFleet,
	clearSecrets,
	clearTasks,
	clearWebSessions,
	setupFleetSchema,
	setupSecretsSchema,
	setupTasksSchema,
	setupWebSessionSchema,
} from './setup-d1.ts'

const SECRET = 'test-secret'
const AGENT_ID = 'ca_boxtest'
const QUEUE = `agent:${AGENT_ID}`

function req(path: string, body: unknown = {}, token = `box-1.${SECRET}`): Request {
	return new Request(`https://fermi.test${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

async function seedBoxAndAgent() {
	await registerBox(env.FERMI_DB, {
		boxId: 'box-1',
		provider: 'aws',
		meta: {
			agent_id: AGENT_ID,
			instance_type: 't3.small',
			token_hash: await sha256Hex(SECRET),
		},
	})
	const task = await enqueueTask(env.FERMI_DB, {
		channel: 'cloud',
		sender: `cloud_agent:${AGENT_ID}`,
		chatId: 'cloud',
		payload: JSON.stringify({ prompt: 'do it', proof_contract: 'show it' }),
		queue: QUEUE,
	})
	await createCloudAgent(env.FERMI_DB, {
		id: AGENT_ID,
		queue: QUEUE,
		prompt: 'do it',
		proofContract: 'show it',
		taskId: task.id,
	})
	return task
}

describe('box gateway', () => {
	beforeAll(async () => {
		await setupFleetSchema()
		await setupTasksSchema()
		await setupWebSessionSchema()
	})

	beforeEach(async () => {
		await clearFleet()
		await clearTasks()
		await clearWebSessions()
	})

	it('rejects missing, malformed, and wrong-secret tokens', async () => {
		await seedBoxAndAgent()
		const noAuth = new Request('https://fermi.test/box/poll', { method: 'POST', body: '{}' })
		expect((await handleBoxPoll(noAuth, env)).status).toBe(401)
		expect((await handleBoxPoll(req('/box/poll', {}, 'garbage'), env)).status).toBe(401)
		expect((await handleBoxPoll(req('/box/poll', {}, 'box-1.wrong'), env)).status).toBe(401)
	})

	it('authBox gates the MCP mount: valid token passes, revoked box does not', async () => {
		await seedBoxAndAgent()
		expect(await authBox(req('/box/mcp'), env)).not.toBeNull()
		expect(await authBox(req('/box/mcp', {}, 'box-1.wrong'), env)).toBeNull()
		await updateBox(env.FERMI_DB, 'box-1', { status: 'destroyed', destroyedAt: Date.now() })
		expect(await authBox(req('/box/mcp'), env)).toBeNull()
	})

	it('destroying the box revokes its token', async () => {
		await seedBoxAndAgent()
		expect((await handleBoxHeartbeat(req('/box/heartbeat'), env)).status).toBe(200)
		await updateBox(env.FERMI_DB, 'box-1', { status: 'destroyed', destroyedAt: Date.now() })
		expect((await handleBoxHeartbeat(req('/box/heartbeat'), env)).status).toBe(401)
	})

	it('poll leases the work task, flips the agent to running, and delivers control exactly once', async () => {
		const task = await seedBoxAndAgent()
		await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: `followup:${AGENT_ID}`,
			chatId: 'cloud',
			payload: JSON.stringify({ type: 'followup', message: 'also check dark mode' }),
			queue: `${QUEUE}:ctl`,
		})

		const first = (await (await handleBoxPoll(req('/box/poll'), env)).json()) as {
			task: { id: string } | null
			control: { message: string }[]
		}
		expect(first.task?.id).toBe(task.id)
		expect(first.control).toEqual([{ type: 'followup', message: 'also check dark mode' }])
		expect((await getCloudAgent(env.FERMI_DB, AGENT_ID))?.status).toBe('running')

		const second = (await (await handleBoxPoll(req('/box/poll'), env)).json()) as {
			task: unknown
			control: unknown[]
		}
		expect(second.task).toBeNull()
		expect(second.control).toEqual([])
	})

	it('completing the main task finishes the agent; a stranger box cannot complete it', async () => {
		const task = await seedBoxAndAgent()
		await registerBox(env.FERMI_DB, {
			boxId: 'box-2',
			meta: { agent_id: 'ca_other', token_hash: await sha256Hex('other-secret') },
		})
		await handleBoxPoll(req('/box/poll'), env)

		const stranger = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, result: 'hijack' }, 'box-2.other-secret'),
			env,
		)
		expect(stranger.status).toBe(409)

		const done = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'done', result: 'proof attached' }),
			env,
		)
		expect(done.status).toBe(200)
		const agent = await getCloudAgent(env.FERMI_DB, AGENT_ID)
		expect(agent).toMatchObject({ status: 'done', exit_reason: 'completed' })
		// Completion flips the box off "online" immediately (runner is powering
		// off); the reaper finalizes offline -> destroyed after EC2 confirms.
		const box = await getBox(env.FERMI_DB, 'box-1')
		expect(box?.status).toBe('offline')
	})

	it('inference spend goes to inference_usd telemetry, never the AWS budget (cost_usd)', async () => {
		const task = await seedBoxAndAgent()
		await handleBoxPoll(req('/box/poll'), env)
		const res = await handleBoxComplete(
			req('/box/complete', {
				task_id: task.id,
				status: 'done',
				result: 'ok',
				inference_cost_usd: 5,
			}),
			env,
		)
		expect(res.status).toBe(200)
		const agent = await getCloudAgent(env.FERMI_DB, AGENT_ID)
		expect(agent?.inference_usd).toBe(5)
		// cost_usd = EC2 wall-clock only; this run lasted milliseconds.
		expect(agent?.cost_usd ?? 0).toBeLessThan(0.01)
	})

	it('report transitions status and records the artifacts prefix', async () => {
		await seedBoxAndAgent()
		await handleBoxReport(
			req('/box/report', { status: 'waiting_human', artifacts_prefix: 'artifacts/ca_boxtest/' }),
			env,
		)
		const agent = await getCloudAgent(env.FERMI_DB, AGENT_ID)
		expect(agent).toMatchObject({
			status: 'waiting_human',
			artifacts_prefix: 'artifacts/ca_boxtest/',
		})
	})

	it('report notes become a readable events log', async () => {
		await seedBoxAndAgent()
		await handleBoxReport(req('/box/report', { note: 'cloned repo, starting tests' }), env)
		await handleBoxReport(req('/box/report', { note: 'tests green, capturing proof' }), env)
		const events = await listTasks(env.FERMI_DB, { queue: `${QUEUE}:events` })
		expect(events).toHaveLength(2)
		expect(events.every((e) => e.status === 'done')).toBe(true)
		expect(events.map((e) => e.payload)).toContain('cloned repo, starting tests')
	})

	it('serves route credentials from secrets and 409s when unconfigured', async () => {
		await setupSecretsSchema()
		await clearSecrets()
		await seedBoxAndAgent() // route defaults to claude

		const missing = await handleBoxInferenceAuth(req('/box/inference-auth'), env)
		expect(missing.status).toBe(409)
		expect(await missing.json()).toMatchObject({ missing: ['CLAUDE_CODE_OAUTH_TOKEN'] })

		await putSecret(
			{ name: 'CLAUDE_CODE_OAUTH_TOKEN', scope: 'app', value: 'sk-ant-oat-test' },
			env,
		)
		const ok = await handleBoxInferenceAuth(req('/box/inference-auth'), env)
		expect(ok.status).toBe(200)
		expect(await ok.json()).toMatchObject({
			route: 'claude',
			secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-test' },
		})
	})

	it('serves GITHUB_TOKEN only to missions whose task payload names a repo', async () => {
		await setupSecretsSchema()
		await clearSecrets()
		await putSecret({ name: 'CLAUDE_CODE_OAUTH_TOKEN', scope: 'app', value: 'oat' }, env)
		await putSecret({ name: 'GITHUB_TOKEN', scope: 'app', value: 'ghp_test' }, env)

		// No repo in the payload → no repo credential
		await seedBoxAndAgent()
		const plain = (await (
			await handleBoxInferenceAuth(req('/box/inference-auth'), env)
		).json()) as {
			secrets: Record<string, string>
		}
		expect(plain.secrets.GITHUB_TOKEN).toBeUndefined()

		// Repo mission → token included
		await clearFleet()
		await clearTasks()
		const task = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: `cloud_agent:${AGENT_ID}`,
			chatId: 'cloud',
			payload: JSON.stringify({ prompt: 'p', proof_contract: 'pc', repo: 'owner/name' }),
			queue: QUEUE,
		})
		await registerBox(env.FERMI_DB, {
			boxId: 'box-1',
			meta: { agent_id: AGENT_ID, token_hash: await sha256Hex(SECRET) },
		})
		await createCloudAgent(env.FERMI_DB, {
			id: AGENT_ID,
			queue: QUEUE,
			prompt: 'p',
			proofContract: 'pc long enough',
			taskId: task.id,
		})
		const withRepo = (await (
			await handleBoxInferenceAuth(req('/box/inference-auth'), env)
		).json()) as { secrets: Record<string, string> }
		expect(withRepo.secrets.GITHUB_TOKEN).toBe('ghp_test')
	})

	it('writeback rotates only whitelisted bundles and preserves allowlists', async () => {
		await setupSecretsSchema()
		await clearSecrets()
		await seedBoxAndAgent()
		await putSecret(
			{
				name: 'CPA_AUTH_CODEX',
				scope: 'app',
				value: '{"refresh_token":"old"}',
				allowedHosts: ['auth.openai.com'],
			},
			env,
		)

		const res = await handleBoxInferenceAuthUpdate(
			req('/box/inference-auth/update', {
				secrets: {
					CPA_AUTH_CODEX: '{"refresh_token":"rotated"}',
					CLAUDE_CODE_OAUTH_TOKEN: 'nice-try',
					RANDOM_NAME: 'nope',
				},
			}),
			env,
		)
		expect(await res.json()).toMatchObject({ ok: true, updated: ['CPA_AUTH_CODEX'] })

		const rotated = await getSecret('CPA_AUTH_CODEX', 'app', '', env)
		expect(rotated?.value).toBe('{"refresh_token":"rotated"}')
		expect(rotated?.metadata.allowed_hosts).toEqual(['auth.openai.com'])
		expect(await getSecret('CLAUDE_CODE_OAUTH_TOKEN', 'app', '', env)).toBeNull()
	})

	it('session-lease is bound to the launch: refuses a session not named in payload.sessions', async () => {
		await setupWebSessionSchema()
		await clearWebSessions()
		await clearFleet()
		await clearTasks()
		const { captureWebSession } = await import('../src/lib/web-session-store.ts')
		await setupSecretsSchema()
		await captureWebSession(env, {
			name: 'chatgpt',
			site: 'https://chatgpt.com',
			storageState: '{"cookies":[],"origins":[]}',
		})
		// agent whose launch named NO sessions
		const task = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: `cloud_agent:${AGENT_ID}`,
			chatId: 'cloud',
			payload: JSON.stringify({ prompt: 'p', proof_contract: 'pc', sessions: [] }),
			queue: QUEUE,
		})
		await registerBox(env.FERMI_DB, {
			boxId: 'box-1',
			meta: { agent_id: AGENT_ID, token_hash: await sha256Hex(SECRET) },
		})
		await createCloudAgent(env.FERMI_DB, {
			id: AGENT_ID,
			queue: QUEUE,
			prompt: 'p',
			proofContract: 'pc long',
			taskId: task.id,
		})
		const denied = await handleBoxSessionLease(req('/box/session-lease', { name: 'chatgpt' }), env)
		expect(denied.status).toBe(403)
		expect(await denied.json()).toMatchObject({ error: 'session_not_in_launch' })
	})

	it('a granted lease returns a broker handle, never storageState (#32)', async () => {
		const task = await enqueueTask(env.FERMI_DB, {
			channel: 'cloud',
			sender: `cloud_agent:${AGENT_ID}`,
			chatId: 'cloud',
			payload: JSON.stringify({ prompt: 'p', proof_contract: 'pc', sessions: ['sess'] }),
			queue: QUEUE,
		})
		await registerBox(env.FERMI_DB, {
			boxId: 'box-1',
			meta: { agent_id: AGENT_ID, token_hash: await sha256Hex(SECRET) },
		})
		await createCloudAgent(env.FERMI_DB, {
			id: AGENT_ID,
			queue: QUEUE,
			prompt: 'p',
			proofContract: 'pc long',
			taskId: task.id,
		})
		const { captureWebSession } = await import('../src/lib/web-session-store.ts')
		await captureWebSession(env, {
			name: 'sess',
			site: 'https://example.com',
			storageState: JSON.stringify({ cookies: [{ name: 'sid', value: 'SECRETCOOKIE' }] }),
		})
		const res = await handleBoxSessionLease(req('/box/session-lease', { name: 'sess' }), env)
		expect(res.status).toBe(200)
		const text = await res.text()
		expect(text).not.toContain('SECRETCOOKIE')
		expect(text).not.toContain('storage_state')
		expect(JSON.parse(text)).toMatchObject({ ok: true, mode: 'broker', session: 'sess' })
	})

	it('stores artifacts under the agent prefix with sanitized names', async () => {
		await seedBoxAndAgent()
		const up = (body: string, name: string, token = `box-1.${SECRET}`) =>
			handleBoxArtifact(
				new Request('https://fermi.test/box/artifact', {
					method: 'POST',
					headers: {
						authorization: `Bearer ${token}`,
						'x-artifact-name': name,
						'content-length': String(body.length),
						'content-type': 'text/plain',
					},
					body,
				}),
				env,
			)

		expect((await up('proof', 'shot.png', 'box-1.wrong')).status).toBe(401)
		expect((await up('proof', '../../etc/passwd')).status).toBe(400) // traversal rejected outright
		expect((await up('proof', 'screenshot 1.png')).status).toBe(200)

		const listed = await listAgentArtifacts(env, AGENT_ID)
		const keys = listed.map((a) => a.key)
		expect(keys).toContain(`artifacts/${AGENT_ID}/screenshot_1.png`)
		expect(keys.every((k) => k.startsWith(`artifacts/${AGENT_ID}/`))).toBe(true)
		expect(keys.some((k) => k.includes('..'))).toBe(false)

		const obj = await env.FERMI_BUCKET.get(`artifacts/${AGENT_ID}/screenshot_1.png`)
		expect(await obj?.text()).toBe('proof')
		expect((await getCloudAgent(env.FERMI_DB, AGENT_ID))?.artifacts_prefix).toBe(
			`artifacts/${AGENT_ID}/`,
		)
	})

	it('heartbeat reports pending work counts', async () => {
		await seedBoxAndAgent()
		const body = (await (await handleBoxHeartbeat(req('/box/heartbeat'), env)).json()) as {
			ok: boolean
			pending: number
			pending_control: number
		}
		expect(body).toMatchObject({ ok: true, pending: 1, pending_control: 0 })
	})
})
