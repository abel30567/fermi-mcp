import { z } from 'zod'
import { listAgentArtifacts } from '../../channels/box-gateway.ts'
import { fleetRelease } from '../../do/fleet-do.ts'
import { launchCloudAgent } from '../../lib/fleet-launch.ts'
import {
	getCloudAgent,
	heartbeatBox,
	listBoxes,
	listCloudAgents,
	scrubBoxToken,
	updateBox,
	updateCloudAgent,
} from '../../lib/fleet-store.ts'
import { dispatchTeardown } from '../../lib/provisioner.ts'
import { enqueueTask, listTasks } from '../../lib/task-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

const json = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

// Exported so the T2 gate can assert the proof-contract requirement directly.
export const cloudAgentLaunchSchema = {
	prompt: z.string().min(10).describe('Full task prompt for the agent'),
	proof_contract: z
		.string()
		.min(10)
		.describe(
			'JSON contract checked mechanically: {"kind":"artifact","name",...} | {"kind":"http","url",...} | {"kind":"test","cmd",...} | {"kind":"dom","url","selector",...}. Free text is rejected.',
		),
	route: z
		.enum(['claude', 'codex', 'grok'])
		.optional()
		.default('claude')
		.describe('Inference route for the agent harness'),
	model: z.string().optional().describe('Override the route model id (e.g. gpt-6-astra)'),
	box_id: z
		.string()
		.optional()
		.describe('Target an existing box (e.g. a private worker) instead of provisioning'),
	budget_usd: z.number().positive().optional().describe('Hard spend ceiling'),
	ttl_seconds: z.number().int().positive().optional().describe('Hard wall-clock ceiling'),
	skills: z.array(z.string()).optional().describe('Fermi skill slugs the agent should load'),
	sessions: z
		.array(z.string())
		.optional()
		.describe('Web session names to lease at boot (see web_session_capture)'),
	repo: z.string().optional().describe('Repository to clone (owner/name or URL)'),
	branch: z.string().optional().describe('Base branch; agent works on its own branch'),
	parent_task_id: z
		.string()
		.optional()
		.describe('Parent task id when this launch is part of a fan-out'),
}

export function registerCloudAgentTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'cloud_agent_launch',
		description:
			'Summon a cloud agent: creates the agent record, enqueues its work task on a dedicated queue, and dispatches provisioning. proof_contract is required and must be structured JSON (artifact/http/test/dom kinds) — it is checked mechanically at /box/complete; done is refused if the check fails. The agent id doubles as its queue name (agent:<id>).',
		schema: cloudAgentLaunchSchema,
		scope: ['write:fleet'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			return json(await launchCloudAgent(env, args))
		},
	})

	defineTool(agent, {
		name: 'cloud_agent_get',
		description:
			'Get one cloud agent: its record, its work task status/result, and pending control messages.',
		schema: { id: z.string().describe('Cloud agent id') },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const row = await getCloudAgent(env.FERMI_DB, args.id)
			if (!row) return json({ ok: false, error: 'not_found' })
			const tasks = await listTasks(env.FERMI_DB, { queue: row.queue, limit: 5 })
			const control = await listTasks(env.FERMI_DB, { queue: `${row.queue}:ctl`, limit: 10 })
			const events = await listTasks(env.FERMI_DB, { queue: `${row.queue}:events`, limit: 20 })
			return json({
				ok: true,
				agent: row,
				tasks,
				pending_control: control,
				events: events.map((e) => ({ at: e.created_at, from: e.sender, note: e.payload })),
				artifacts: await listAgentArtifacts(env, row.id),
			})
		},
	})

	defineTool(agent, {
		name: 'cloud_agent_list',
		description: 'List cloud agents, optionally filtered by status.',
		schema: {
			status: z
				.enum(['launching', 'running', 'waiting_human', 'done', 'failed', 'destroyed'])
				.optional(),
			limit: z.number().int().min(1).max(100).optional().default(20),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const agents = await listCloudAgents(env.FERMI_DB, {
				status: args.status,
				limit: args.limit,
			})
			return json({ agents, total: agents.length })
		},
	})

	defineTool(agent, {
		name: 'cloud_agent_followup',
		description:
			'Queue a follow-up message into a running cloud agent, or interrupt it. The runner drains the agent control queue between (or, on interrupt, during) turns.',
		schema: {
			id: z.string().describe('Cloud agent id'),
			message: z.string().min(1).describe('Message to deliver to the agent'),
			interrupt: z
				.boolean()
				.optional()
				.default(false)
				.describe('Abort the current turn before delivering the message'),
		},
		scope: ['write:fleet'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const row = await getCloudAgent(env.FERMI_DB, args.id)
			if (!row) return json({ ok: false, error: 'not_found' })
			if (['done', 'failed', 'destroyed'].includes(row.status)) {
				return json({ ok: false, error: 'agent_finished', status: row.status })
			}
			const task = await enqueueTask(env.FERMI_DB, {
				channel: 'cloud',
				sender: `followup:${args.id}`,
				chatId: 'cloud',
				payload: JSON.stringify({
					type: args.interrupt ? 'interrupt' : 'followup',
					message: args.message,
				}),
				queue: `${row.queue}:ctl`,
			})
			return json({ ok: true, control_task_id: task.id })
		},
	})

	defineTool(agent, {
		name: 'cloud_agent_stop',
		description:
			'Ask a cloud agent to stop gracefully after its current step. Keeps the box alive for inspection; use cloud_agent_destroy to tear down compute.',
		schema: { id: z.string().describe('Cloud agent id') },
		scope: ['write:fleet'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const row = await getCloudAgent(env.FERMI_DB, args.id)
			if (!row) return json({ ok: false, error: 'not_found' })
			if (['done', 'failed', 'destroyed'].includes(row.status)) {
				return json({ ok: false, error: 'agent_finished', status: row.status })
			}
			const task = await enqueueTask(env.FERMI_DB, {
				channel: 'cloud',
				sender: `stop:${args.id}`,
				chatId: 'cloud',
				payload: JSON.stringify({ type: 'stop' }),
				queue: `${row.queue}:ctl`,
			})
			return json({ ok: true, control_task_id: task.id })
		},
	})

	defineTool(agent, {
		name: 'cloud_agent_destroy',
		description:
			'Mark a cloud agent destroyed and dispatch compute teardown (instance termination, credential revocation). Irreversible.',
		schema: {
			id: z.string().describe('Cloud agent id'),
			reason: z.string().optional().describe('Why the agent is being destroyed'),
		},
		scope: ['write:fleet'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const row = await getCloudAgent(env.FERMI_DB, args.id)
			if (!row) return json({ ok: false, error: 'not_found' })
			if (row.status === 'destroyed') return json({ ok: false, error: 'already_destroyed' })
			await updateCloudAgent(env.FERMI_DB, args.id, {
				status: 'destroyed',
				endedAt: Date.now(),
				exitReason: args.reason ?? 'destroyed_by_operator',
			})
			if (row.box_id) {
				await updateBox(env.FERMI_DB, row.box_id, {
					status: 'destroyed',
					destroyedAt: Date.now(),
				})
				await scrubBoxToken(env.FERMI_DB, row.box_id)
			}
			await fleetRelease(env, args.id)
			const teardown = await dispatchTeardown(env, row)
			return json({ ok: true, teardown })
		},
	})

	defineTool(agent, {
		name: 'box_heartbeat',
		description:
			'Box runner check-in: marks the box online and returns pending counts for its queues. Boxes call this on a timer.',
		schema: { box_id: z.string().describe('Box id from the registry') },
		scope: ['write:fleet'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const outcome = await heartbeatBox(env.FERMI_DB, args.box_id)
			if (!outcome.ok) return json({ ok: false, error: 'box_not_found_or_destroyed' })
			return json({ ok: true, at: Date.now() })
		},
	})

	defineTool(agent, {
		name: 'box_list',
		description: 'List registered boxes (cloud and private workers) with status and heartbeat age.',
		schema: {
			status: z.enum(['provisioning', 'online', 'offline', 'destroyed']).optional(),
			limit: z.number().int().min(1).max(200).optional().default(50),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const boxes = await listBoxes(env.FERMI_DB, { status: args.status, limit: args.limit })
			return json({ boxes, total: boxes.length })
		},
	})

	defineTool(agent, {
		name: 'cloud_env_list',
		description: 'List registered environment snapshots usable by cloud_agent_launch.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const listed = await env.FERMI_KV.list({ prefix: 'cloudenv:' })
			const envs = await Promise.all(
				listed.keys.map(async (k) => {
					const raw = await env.FERMI_KV.get(k.name)
					return raw ? JSON.parse(raw) : null
				}),
			)
			return json({ envs: envs.filter(Boolean), total: envs.filter(Boolean).length })
		},
	})

	defineTool(agent, {
		name: 'cloud_env_snapshot',
		description:
			'Register an environment snapshot definition (name + image/AMI ref + notes). Baking a new image from a live box is dispatched to the provisioner when configured.',
		schema: {
			name: z.string().min(1).describe('Snapshot name, e.g. node-playwright'),
			image_ref: z.string().min(1).describe('AMI id / container image ref'),
			description: z.string().optional().describe('What is baked into this environment'),
		},
		scope: ['write:fleet'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const record = {
				name: args.name,
				image_ref: args.image_ref,
				description: args.description ?? null,
				created_at: Date.now(),
			}
			await env.FERMI_KV.put(`cloudenv:${args.name}`, JSON.stringify(record))
			return json({ ok: true, env: record })
		},
	})
}
