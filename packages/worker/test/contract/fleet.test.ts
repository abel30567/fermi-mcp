import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { registerBox } from '../../src/lib/fleet-store.ts'
import { putSecret } from '../../src/lib/secrets-store.ts'
import { callApproved } from './approval.ts'
import { describeTool } from './describe-tool.ts'
import { McpClient, resultJson } from './mcp-client.ts'

// Cloud agents and boxes. Launch must fail closed: without a runner pin or AWS
// credentials no compute is dispatched, no box is registered and the FleetDO
// reservation is released. No test reaches AWS.

const PROOF = JSON.stringify({ kind: 'artifact', name: 'report.md' })
const LAUNCH = { prompt: 'Write the weekly report', proof_contract: PROOF }

interface Launched {
	ok: boolean
	agent_id: string
	queue: string
	task_id: string
	status: string
	provision: { dispatched: boolean; reason?: string; box_id?: string }
	error?: string
}

let client: McpClient

beforeEach(async () => {
	client = new McpClient()
	await client.initialize()
})

afterEach(async () => {
	await env.FERMI_DB.batch([
		env.FERMI_DB.prepare('DELETE FROM cloud_agents'),
		env.FERMI_DB.prepare('DELETE FROM boxes'),
		env.FERMI_DB.prepare("DELETE FROM tasks WHERE queue LIKE 'agent:%'"),
		env.FERMI_DB.prepare("DELETE FROM secrets WHERE name LIKE 'AWS_%'"),
	])
	const keys = await env.FERMI_KV.list({ prefix: 'cloudenv:' })
	await Promise.all([
		env.FERMI_KV.delete('fleet:config'),
		...keys.keys.map((k) => env.FERMI_KV.delete(k.name)),
	])
})

async function launch(args: Record<string, unknown> = LAUNCH): Promise<Launched> {
	return resultJson<Launched>(await callApproved(client, 'cloud_agent_launch', args))
}

async function boxIds(): Promise<string[]> {
	const { results } = await env.FERMI_DB.prepare('SELECT box_id FROM boxes').all<{
		box_id: string
	}>()
	return results.map((r) => r.box_id)
}

async function agentStatus(id: string) {
	return (
		await env.FERMI_DB.prepare('SELECT status FROM cloud_agents WHERE id = ?1')
			.bind(id)
			.first<{ status: string }>()
	)?.status
}

/** A private worker box the agent can target, so no compute is provisioned. */
async function privateAgent(): Promise<Launched> {
	await registerBox(env.FERMI_DB, { boxId: 'box-private', provider: 'private' })
	const launched = await launch({ ...LAUNCH, box_id: 'box-private' })
	expect(launched.provision).toEqual({
		dispatched: false,
		reason: 'existing_box_targeted',
		box_id: 'box-private',
	})
	return launched
}

describeTool('cloud_agent_launch', () => {
	it('requires an approval token and creates nothing without one', async () => {
		expect(resultJson(await client.callTool('cloud_agent_launch', LAUNCH))).toMatchObject({
			status: 'pending_approval',
			risk: 'high',
		})
		const denied = await client.callTool('cloud_agent_launch', {
			...LAUNCH,
			approval_token: crypto.randomUUID(),
		})
		expect(resultJson(denied)).toEqual({
			status: 'denied',
			reason: 'Invalid or expired approval token',
		})
		const { results } = await env.FERMI_DB.prepare('SELECT id FROM cloud_agents').all()
		expect(results).toEqual([])
	})

	it('fails closed without a runner pin, even with AWS credentials: no box, slot released', async () => {
		await putSecret({ name: 'AWS_ACCESS_KEY_ID', value: 'AKIDCONTRACT', scope: 'app' }, env)
		await putSecret({ name: 'AWS_SECRET_ACCESS_KEY', value: 'contract-secret', scope: 'app' }, env)
		await env.FERMI_KV.put('fleet:config', JSON.stringify({ max_concurrent: 1 }))
		for (let i = 0; i < 2; i++) {
			const launched = await launch()
			expect(launched).toMatchObject({
				ok: true,
				status: 'launching',
				provision: { dispatched: false, reason: 'runner_pin_unset' },
			})
			expect(launched.queue).toBe(`agent:${launched.agent_id}`)
		}
		expect(await boxIds()).toEqual([])
	})

	it('fails closed without AWS credentials even when pinned and imaged', async () => {
		await env.FERMI_KV.put(
			'fleet:config',
			JSON.stringify({ runner_ref: 'v1', runner_sha256: 'a'.repeat(64), default_env: 'node' }),
		)
		await env.FERMI_KV.put('cloudenv:node', JSON.stringify({ name: 'node', image_ref: 'ami-1' }))
		const launched = await launch()
		expect(launched.provision).toEqual({ dispatched: false, reason: 'aws_credentials_missing' })
		expect(await boxIds()).toEqual([])
	})

	it('rejects a free-text proof contract', async () => {
		const launched = await launch({ ...LAUNCH, proof_contract: 'make it look good please' })
		expect(launched.ok).toBe(false)
		expect(launched.error).toMatch(/^invalid_proof_contract/)
	})

	it('fails closed when the alternate account token is missing', async () => {
		expect(await launch({ ...LAUNCH, account: 'kayo' })).toEqual({
			ok: false,
			error: 'account_token_not_configured',
			missing: ['CLAUDE_CODE_OAUTH_TOKEN_KAYO'],
		})
	})
})

describeTool('cloud_agent_get', () => {
	it('returns the agent with its work task', async () => {
		const launched = await launch()
		const got = resultJson<{
			ok: boolean
			agent: { id: string; status: string }
			tasks: Array<{ id: string }>
		}>(await client.callTool('cloud_agent_get', { id: launched.agent_id }))
		expect(got.ok).toBe(true)
		expect(got.agent).toMatchObject({ id: launched.agent_id, status: 'launching' })
		expect(got.tasks.map((t) => t.id)).toEqual([launched.task_id])
	})

	it('reports an unknown agent as not_found', async () => {
		expect(resultJson(await client.callTool('cloud_agent_get', { id: 'ca_nope' }))).toEqual({
			ok: false,
			error: 'not_found',
		})
	})
})

describeTool('cloud_agent_list', () => {
	it('lists agents filtered by status', async () => {
		const a = await launch()
		const b = await launch()
		await env.FERMI_DB.prepare("UPDATE cloud_agents SET status = 'done' WHERE id = ?1")
			.bind(b.agent_id)
			.run()
		const listed = resultJson<{ agents: Array<{ id: string }>; total: number }>(
			await client.callTool('cloud_agent_list', { status: 'launching' }),
		)
		expect(listed.agents.map((x) => x.id)).toEqual([a.agent_id])
		expect(listed.total).toBe(1)
	})
})

describeTool('cloud_agent_followup', () => {
	it('requires approval, then queues a follow-up on the control queue', async () => {
		const launched = await privateAgent()
		const args = { id: launched.agent_id, message: 'also add a summary' }
		expect(resultJson(await client.callTool('cloud_agent_followup', args))).toMatchObject({
			status: 'pending_approval',
		})
		const queued = resultJson<{ ok: boolean; control_task_id: string }>(
			await callApproved(client, 'cloud_agent_followup', args),
		)
		expect(queued.ok).toBe(true)
		const task = await env.FERMI_DB.prepare('SELECT queue, payload FROM tasks WHERE id = ?1')
			.bind(queued.control_task_id)
			.first<{ queue: string; payload: string }>()
		expect(task?.queue).toBe(`${launched.queue}:ctl`)
		expect(JSON.parse(task?.payload ?? '')).toEqual({
			type: 'followup',
			message: 'also add a summary',
		})
	})

	it('refuses a finished agent', async () => {
		const launched = await privateAgent()
		await env.FERMI_DB.prepare("UPDATE cloud_agents SET status = 'done' WHERE id = ?1")
			.bind(launched.agent_id)
			.run()
		const refused = await callApproved(client, 'cloud_agent_followup', {
			id: launched.agent_id,
			message: 'too late',
		})
		expect(resultJson(refused)).toEqual({ ok: false, error: 'agent_finished', status: 'done' })
	})
})

describeTool('cloud_agent_stop', () => {
	it('queues a stop message for a live agent', async () => {
		const launched = await privateAgent()
		const stopped = resultJson<{ ok: boolean; control_task_id: string }>(
			await client.callTool('cloud_agent_stop', { id: launched.agent_id }),
		)
		expect(stopped.ok).toBe(true)
		const task = await env.FERMI_DB.prepare('SELECT queue, payload FROM tasks WHERE id = ?1')
			.bind(stopped.control_task_id)
			.first<{ queue: string; payload: string }>()
		expect(task).toEqual({ queue: `${launched.queue}:ctl`, payload: '{"type":"stop"}' })
	})

	it('reports an unknown agent as not_found', async () => {
		expect(resultJson(await client.callTool('cloud_agent_stop', { id: 'ca_nope' }))).toEqual({
			ok: false,
			error: 'not_found',
		})
	})
})

describeTool('cloud_agent_destroy', () => {
	it('marks the agent and its box destroyed; a second destroy is refused', async () => {
		const launched = await privateAgent()
		const destroyed = resultJson(
			await callApproved(client, 'cloud_agent_destroy', { id: launched.agent_id }),
		)
		expect(destroyed).toEqual({
			ok: true,
			teardown: { dispatched: false, reason: 'no_compute_attached', box_id: 'box-private' },
		})
		expect(await agentStatus(launched.agent_id)).toBe('destroyed')
		const box = await env.FERMI_DB.prepare(
			"SELECT status FROM boxes WHERE box_id = 'box-private'",
		).first<{ status: string }>()
		expect(box?.status).toBe('destroyed')
		const again = await callApproved(client, 'cloud_agent_destroy', { id: launched.agent_id })
		expect(resultJson(again)).toEqual({ ok: false, error: 'already_destroyed' })
	})
})

describeTool('box_heartbeat', () => {
	it('marks a registered box online and refuses unknown or destroyed boxes', async () => {
		await registerBox(env.FERMI_DB, { boxId: 'box-hb', provider: 'private' })
		const beat = resultJson(await client.callTool('box_heartbeat', { box_id: 'box-hb' }))
		expect(beat).toMatchObject({ ok: true, at: expect.any(Number) })
		const box = await env.FERMI_DB.prepare(
			"SELECT status, last_heartbeat_at FROM boxes WHERE box_id = 'box-hb'",
		).first<{ status: string; last_heartbeat_at: number }>()
		expect(box?.status).toBe('online')
		expect(box?.last_heartbeat_at).toBeGreaterThan(0)

		const notFound = { ok: false, error: 'box_not_found_or_destroyed' }
		expect(resultJson(await client.callTool('box_heartbeat', { box_id: 'box-nope' }))).toEqual(
			notFound,
		)
		await env.FERMI_DB.prepare(
			"UPDATE boxes SET status = 'destroyed' WHERE box_id = 'box-hb'",
		).run()
		expect(resultJson(await client.callTool('box_heartbeat', { box_id: 'box-hb' }))).toEqual(
			notFound,
		)
	})
})

describeTool('box_list', () => {
	it('lists registered boxes filtered by status', async () => {
		await registerBox(env.FERMI_DB, { boxId: 'box-a', provider: 'private' })
		await registerBox(env.FERMI_DB, { boxId: 'box-b', provider: 'private' })
		await client.callTool('box_heartbeat', { box_id: 'box-b' })
		const all = resultJson<{ boxes: Array<{ box_id: string }>; total: number }>(
			await client.callTool('box_list', {}),
		)
		expect(all.boxes.map((b) => b.box_id).sort()).toEqual(['box-a', 'box-b'])
		const online = resultJson<{ boxes: Array<{ box_id: string }>; total: number }>(
			await client.callTool('box_list', { status: 'online' }),
		)
		expect(online.boxes.map((b) => b.box_id)).toEqual(['box-b'])
		expect(online.total).toBe(1)
	})
})

describeTool('cloud_env_snapshot', () => {
	it('requires approval, then registers the snapshot in KV', async () => {
		const args = { name: 'node-playwright', image_ref: 'ami-123', description: 'node + chromium' }
		expect(resultJson(await client.callTool('cloud_env_snapshot', args))).toMatchObject({
			status: 'pending_approval',
		})
		const saved = resultJson<{ ok: boolean; env: Record<string, unknown> }>(
			await callApproved(client, 'cloud_env_snapshot', args),
		)
		expect(saved).toMatchObject({ ok: true, env: { ...args, created_at: expect.any(Number) } })
		expect(await env.FERMI_KV.get('cloudenv:node-playwright', 'json')).toEqual(saved.env)
	})
})

describeTool('cloud_env_list', () => {
	it('lists the registered snapshots', async () => {
		expect(resultJson(await client.callTool('cloud_env_list', {}))).toEqual({ envs: [], total: 0 })
		await callApproved(client, 'cloud_env_snapshot', { name: 'a', image_ref: 'ami-a' })
		await callApproved(client, 'cloud_env_snapshot', { name: 'b', image_ref: 'ami-b' })
		const listed = resultJson<{ envs: Array<{ name: string }>; total: number }>(
			await client.callTool('cloud_env_list', {}),
		)
		expect(listed.envs.map((e) => e.name)).toEqual(['a', 'b'])
		expect(listed.total).toBe(2)
	})
})
