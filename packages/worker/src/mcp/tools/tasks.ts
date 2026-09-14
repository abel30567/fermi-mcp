import { z } from 'zod'
import {
	claimTasks,
	completeTask,
	enqueueTask,
	isFleetQueue,
	listTasks,
	listTasksByParent,
	waitForTask,
} from '../../lib/task-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerTaskTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'task_enqueue',
		description:
			'Add a task to the channel task queue. Channel webhooks enqueue automatically; use this for manual or agent-initiated work items.',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc', 'sl', 'cloud']).describe('Channel the task belongs to'),
			sender: z.string().describe('Channel-specific sender id'),
			chat_id: z.string().describe('Channel-specific chat id for the eventual reply'),
			payload: z.string().describe('The task content (usually the inbound message text)'),
			queue: z
				.string()
				.optional()
				.describe('Work queue; workers only claim from their own queue (default main)'),
			parent_task_id: z
				.string()
				.optional()
				.describe('Parent task id when this task is part of a fan-out'),
		},
		scope: ['write:tasks'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const created = await enqueueTask(env.FERMI_DB, {
				channel: args.channel,
				sender: args.sender,
				chatId: args.chat_id,
				payload: args.payload,
				queue: args.queue,
				parentTaskId: args.parent_task_id,
			})
			return { content: [{ type: 'text' as const, text: JSON.stringify(created) }] }
		},
	})

	defineTool(agent, {
		name: 'task_claim',
		description:
			'Atomically claim the oldest pending tasks (FIFO) for processing. Tasks stuck in claimed state past the stale window are reclaimed. Returns an empty list when the queue is drained.',
		schema: {
			limit: z
				.number()
				.int()
				.min(1)
				.max(10)
				.optional()
				.default(3)
				.describe('Maximum number of tasks to claim'),
			stale_minutes: z
				.number()
				.optional()
				.describe('Reclaim tasks claimed longer than this many minutes ago (default 15)'),
			queue: z.string().optional().describe('Only claim from this queue (default main)'),
			claimed_by: z
				.string()
				.optional()
				.describe('Worker identity (box id); recorded on the claim and required to complete'),
			lease_minutes: z
				.number()
				.optional()
				.describe('Lease duration; the task is reclaimable after it expires (default 15)'),
		},
		scope: ['write:tasks'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			// Fleet queues belong to the cloud boxes and the broker executor, which
			// claim over the /box gateway. The channel task_claim tool (used by the
			// Mac drain / warm worker) must never claim them, or it steals a box's
			// work task and fails it (2026-09-08 SCA incident).
			if (isFleetQueue(args.queue)) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								tasks: [],
								total: 0,
								error: 'fleet_queue_off_limits',
								detail: `${args.queue} is drained by its cloud box, not task_claim`,
							}),
						},
					],
				}
			}
			const tasks = await claimTasks(env.FERMI_DB, {
				limit: args.limit,
				staleMs: args.stale_minutes != null ? args.stale_minutes * 60_000 : undefined,
				queue: args.queue,
				claimedBy: args.claimed_by,
				leaseMs: args.lease_minutes != null ? args.lease_minutes * 60_000 : undefined,
			})
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ tasks, total: tasks.length }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'task_complete',
		description:
			'Mark a claimed task as done or failed. Fails if the task is not currently claimed.',
		schema: {
			id: z.string().describe('Task id returned by task_claim'),
			status: z.enum(['done', 'failed']).optional().default('done').describe('Final task status'),
			result: z.string().optional().describe('One-line summary of the outcome'),
			claimed_by: z
				.string()
				.optional()
				.describe('Worker identity; must match the claim when provided'),
		},
		scope: ['write:tasks'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const outcome = await completeTask(env.FERMI_DB, args.id, {
				status: args.status,
				result: args.result,
				claimedBy: args.claimed_by,
			})
			return { content: [{ type: 'text' as const, text: JSON.stringify(outcome) }] }
		},
	})

	defineTool(agent, {
		name: 'task_list',
		description: 'List recent tasks in the channel task queue, optionally filtered by status.',
		schema: {
			status: z
				.enum(['pending', 'claimed', 'done', 'failed'])
				.optional()
				.describe('Filter by task status'),
			limit: z.number().optional().default(20).describe('Maximum number of tasks to return'),
			queue: z.string().optional().describe('Filter by work queue'),
			parent_task_id: z
				.string()
				.optional()
				.describe('List a fan-out: all children of this parent task'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const tasks = args.parent_task_id
				? await listTasksByParent(env.FERMI_DB, args.parent_task_id)
				: await listTasks(env.FERMI_DB, {
						status: args.status,
						limit: args.limit,
						queue: args.queue,
					})
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ tasks, total: tasks.length }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'task_wait',
		description:
			'Wait for a task to reach done/failed, or time out. Lets an orchestrator await a completion instead of polling by hand. Returns status and result.',
		schema: {
			id: z.string().describe('Task id to wait on'),
			timeout_seconds: z
				.number()
				.int()
				.min(1)
				.max(120)
				.optional()
				.default(30)
				.describe('How long to wait before returning timeout'),
			poll_seconds: z.number().min(0.5).max(30).optional().default(2).describe('Polling interval'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const outcome = await waitForTask(env.FERMI_DB, args.id, {
				timeoutMs: args.timeout_seconds * 1000,
				pollMs: args.poll_seconds * 1000,
			})
			return { content: [{ type: 'text' as const, text: JSON.stringify(outcome) }] }
		},
	})
}
