import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleBoxComplete, handleBoxPoll, sha256Hex } from '../src/channels/box-gateway.ts'
import { createCloudAgent, getCloudAgent, registerBox } from '../src/lib/fleet-store.ts'
import {
	checkProofContract,
	parseProofContract,
	proofContractHelp,
} from '../src/lib/proof-contract.ts'
import { enqueueTask } from '../src/lib/task-store.ts'
import { clearFleet, clearTasks, setupFleetSchema, setupTasksSchema } from './setup-d1.ts'

const SECRET = 'proof-secret'
const AGENT_ID = 'ca_prooftest'
const QUEUE = `agent:${AGENT_ID}`

function req(path: string, body: unknown = {}): Request {
	return new Request(`https://fermi.test${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer box-p.${SECRET}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

async function seed(proofContract: string) {
	await registerBox(env.FERMI_DB, {
		boxId: 'box-p',
		provider: 'aws',
		meta: { agent_id: AGENT_ID, instance_type: 't3.small', token_hash: await sha256Hex(SECRET) },
	})
	const task = await enqueueTask(env.FERMI_DB, {
		channel: 'cloud',
		sender: `cloud_agent:${AGENT_ID}`,
		chatId: 'cloud',
		payload: JSON.stringify({ prompt: 'do it', proof_contract: proofContract }),
		queue: QUEUE,
	})
	await createCloudAgent(env.FERMI_DB, {
		id: AGENT_ID,
		queue: QUEUE,
		prompt: 'do it',
		proofContract,
		taskId: task.id,
	})
	// Claim the task as the box would.
	await handleBoxPoll(req('/box/poll'), env)
	return task
}

const ARTIFACT_CONTRACT = JSON.stringify({ kind: 'artifact', name: 'out.diff', min_bytes: 1 })

describe('proof contract schema (#36)', () => {
	it('rejects bare prose with a typed error listing kinds', () => {
		const out = parseProofContract('screenshots or it did not happen')
		expect(out.ok).toBe(false)
		if (!out.ok) expect(out.error).toContain('artifact')
	})

	it('parses each structured kind', () => {
		for (const c of [
			{ kind: 'artifact', name: 'a.txt', min_bytes: 10 },
			{ kind: 'artifact', name: 'a.txt', sha256: 'c'.repeat(64) },
			{ kind: 'http', url: 'https://example.com/health', expect_status: 200 },
			{ kind: 'http', url: 'https://example.com', body_matches: 'ok' },
			{ kind: 'test', cmd: 'npm test' },
			{ kind: 'dom', url: 'https://example.com', selector: 'h1', text_matches: 'Hi' },
		]) {
			const out = parseProofContract(JSON.stringify(c))
			expect(out.ok, JSON.stringify(c)).toBe(true)
		}
	})

	it('help text names every kind', () => {
		for (const k of ['artifact', 'http', 'test', 'dom']) expect(proofContractHelp()).toContain(k)
	})
})

describe('proof contract checker (pure, injected deps)', () => {
	const bytes = new TextEncoder().encode('hello proof').buffer as ArrayBuffer
	const deps = {
		getArtifact: async (name: string) => (name === 'out.diff' ? { bytes } : null),
		fetchUrl: async (url: string) =>
			url.endsWith('/ok') ? { status: 200, body: 'all good' } : { status: 500, body: 'boom' },
	}

	it('artifact: passes on existence + min_bytes, fails when absent or too small', async () => {
		const c = (extra: object) => ({ kind: 'artifact' as const, name: 'out.diff', ...extra })
		expect((await checkProofContract(c({ min_bytes: 1 }), deps)).verdict).toBe('pass')
		expect((await checkProofContract(c({ min_bytes: 10_000 }), deps)).verdict).toBe('fail')
		expect(
			(await checkProofContract({ kind: 'artifact', name: 'missing.txt' }, deps)).verdict,
		).toBe('fail')
	})

	it('artifact: sha256 must match when specified', async () => {
		const digest = await crypto.subtle.digest('SHA-256', bytes)
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
		expect(
			(await checkProofContract({ kind: 'artifact', name: 'out.diff', sha256: hex }, deps)).verdict,
		).toBe('pass')
		expect(
			(
				await checkProofContract(
					{ kind: 'artifact', name: 'out.diff', sha256: 'f'.repeat(64) },
					deps,
				)
			).verdict,
		).toBe('fail')
	})

	it('http: status and body_matches enforced', async () => {
		expect(
			(
				await checkProofContract(
					{ kind: 'http', url: 'https://x.test/ok', expect_status: 200, body_matches: 'good' },
					deps,
				)
			).verdict,
		).toBe('pass')
		expect(
			(
				await checkProofContract(
					{ kind: 'http', url: 'https://x.test/down', expect_status: 200 },
					deps,
				)
			).verdict,
		).toBe('fail')
	})

	it('test and dom are unverifiable worker-side', async () => {
		expect((await checkProofContract({ kind: 'test', cmd: 'npm test' }, deps)).verdict).toBe(
			'unverifiable',
		)
		expect(
			(await checkProofContract({ kind: 'dom', url: 'https://x.test', selector: 'h1' }, deps))
				.verdict,
		).toBe('unverifiable')
	})
})

describe('/box/complete enforcement (#36 exploits)', () => {
	beforeAll(async () => {
		await setupFleetSchema()
		await setupTasksSchema()
	})
	beforeEach(async () => {
		await clearFleet()
		await clearTasks()
	})

	it('HOTEL replay: done with an unsatisfiable artifact contract is refused', async () => {
		const task = await seed(ARTIFACT_CONTRACT)
		const res = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'done', result: 'all finished' }),
			env,
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { error?: string }
		expect(body.error).toBe('proof_unverified')
		// Task must NOT be terminal — the box can still fix its work or fail honestly.
		const row = await env.FERMI_DB.prepare('SELECT status FROM tasks WHERE id = ?1')
			.bind(task.id)
			.first<{ status: string }>()
		expect(row?.status).toBe('claimed')
		expect((await getCloudAgent(env.FERMI_DB, AGENT_ID))?.status).not.toBe('done')
	})

	it('empty-evidence replay: RESULT: PROOF_OK with no artifacts is refused', async () => {
		const task = await seed(ARTIFACT_CONTRACT)
		const res = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'done', result: 'RESULT: PROOF_OK' }),
			env,
		)
		expect(res.status).toBe(422)
	})

	it('honest failure is always accepted (no proof needed to give up)', async () => {
		const task = await seed(ARTIFACT_CONTRACT)
		const res = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'failed', result: 'could not do it' }),
			env,
		)
		expect(res.status).toBe(200)
	})

	it('legacy free-text contracts are grandfathered (done accepted)', async () => {
		const task = await seed('plain prose contract from before #36')
		const res = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'done', result: 'ok' }),
			env,
		)
		expect(res.status).toBe(200)
	})

	it('unverifiable kinds complete but are tagged for orchestrator replay', async () => {
		const task = await seed(JSON.stringify({ kind: 'test', cmd: 'npm test' }))
		const res = await handleBoxComplete(
			req('/box/complete', { task_id: task.id, status: 'done', result: 'exit 0' }),
			env,
		)
		expect(res.status).toBe(200)
		expect((await getCloudAgent(env.FERMI_DB, AGENT_ID))?.exit_reason).toBe('completed_unverified')
	})
})
