import { z } from 'zod'
import {
	EVERY_MINUTES_MAX,
	EVERY_MINUTES_MIN,
	PROMPT_MAX_LENGTH,
	createSchedule,
	deleteSchedule,
	listSchedules,
} from '../../lib/schedule-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerScheduleTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'schedule_create',
		description:
			'Register a scheduled job. The prompt is a self-contained runbook (goal, steps, tools to use, state-keeping memory keys, and a delivery condition — when to message vs stay silent); it executes later as a full agent turn with no chat context. Provide exactly one of every_minutes (recurring) or at (one-shot).',
		schema: {
			channel: z.enum(['tg', 'wa', 'dc']).describe('Channel whose chat receives any output'),
			chat_id: z.string().describe('Chat id to deliver into (from the current task)'),
			prompt: z
				.string()
				.max(PROMPT_MAX_LENGTH)
				.describe('Self-contained runbook executed at each firing'),
			every_minutes: z
				.number()
				.int()
				.min(EVERY_MINUTES_MIN)
				.max(EVERY_MINUTES_MAX)
				.optional()
				.describe(`Recurring cadence in minutes (${EVERY_MINUTES_MIN}-${EVERY_MINUTES_MAX})`),
			at: z
				.union([z.string(), z.number()])
				.optional()
				.describe('One-shot firing time: ISO 8601 string or epoch ms'),
		},
		scope: ['write:schedules'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			let runAt: number | undefined
			if (args.at != null) {
				runAt = typeof args.at === 'number' ? args.at : Date.parse(args.at)
				if (Number.isNaN(runAt)) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({ ok: false, error: 'invalid_at_timestamp' }),
							},
						],
					}
				}
			}
			const result = await createSchedule(env.FERMI_DB, {
				channel: args.channel,
				chatId: args.chat_id,
				prompt: args.prompt,
				everyMinutes: args.every_minutes,
				runAt,
			})
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})

	defineTool(agent, {
		name: 'schedule_list',
		description: 'List scheduled jobs, soonest first.',
		schema: {
			include_disabled: z
				.boolean()
				.optional()
				.default(false)
				.describe('Include fired one-shots and disabled schedules'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const schedules = await listSchedules(env.FERMI_DB, {
				includeDisabled: args.include_disabled,
			})
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ schedules, total: schedules.length }) },
				],
			}
		},
	})

	defineTool(agent, {
		name: 'schedule_delete',
		description: 'Delete a scheduled job by id.',
		schema: {
			id: z.string().describe('Schedule id (from schedule_create or schedule_list)'),
		},
		scope: ['write:schedules'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const result = await deleteSchedule(env.FERMI_DB, args.id)
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})
}
