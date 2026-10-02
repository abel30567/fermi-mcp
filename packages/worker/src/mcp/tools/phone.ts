import { z } from 'zod'
import { readPhoneConfig } from '../../lib/phone-call.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

const json = (value: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

const E164 = /^\+[1-9]\d{6,14}$/

function callStub(env: Env, callId: string): DurableObjectStub {
	const ns = env.PHONE_CALL
	if (!ns)
		throw new Error(
			'PHONE_CALL binding missing — add the PhoneCallDO durable object to wrangler.jsonc',
		)
	return ns.get(ns.idFromName(callId))
}

async function callDo(
	stub: DurableObjectStub,
	path: string,
	body?: unknown,
): Promise<Record<string, unknown>> {
	const res = await stub.fetch(`https://do${path}`, {
		method: body !== undefined ? 'POST' : 'GET',
		headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	})
	return (await res.json()) as Record<string, unknown>
}

export function registerPhoneTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'phone_call_start',
		description:
			'Place an outbound phone call from the configured Twilio caller ID and let the GPT-Live voice model pursue a goal (e.g. "call the IRS, wait on hold, request a first-time penalty abatement for tax year 2024"). Navigates phone menus, pauses the voice model while on hold, and hangs up when done. Returns immediately with a call_id; the call can run for a long time. Poll phone_call_status, or pass notify_channel/notify_chat_id to have the outcome enqueued as a task for that chat when the call ends. Requires the phone config secrets (see error if missing).',
		schema: {
			to: z.string().regex(E164).describe('Number to call, E.164 (e.g. +18008291040)'),
			goal: z.string().min(5).max(4000).describe('What the call should achieve, in plain language'),
			context: z
				.string()
				.max(6000)
				.optional()
				.describe(
					'Facts the agent may use on the call: who it is calling for, account/reference numbers, dates, callback number. Everything here can be spoken aloud.',
				),
			notify_channel: z
				.enum(['tg', 'wa', 'dc', 'sl'])
				.optional()
				.describe('Enqueue the result as a task for this channel when the call ends'),
			notify_chat_id: z.string().optional().describe('Chat id for notify_channel'),
			max_minutes: z
				.number()
				.int()
				.min(1)
				.max(240)
				.optional()
				.default(90)
				.describe('Hard cap on call length including hold time (default 90)'),
		},
		scope: ['network', 'write:phone'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const cfg = await readPhoneConfig(env)
			if (!cfg.ok) {
				return json({
					error: 'phone_not_configured',
					missing: cfg.missing,
					hint: 'Store each missing value with secret_set (scope app), or set it as a Worker var/secret of the same name.',
				})
			}
			if (
				(args.notify_channel && !args.notify_chat_id) ||
				(!args.notify_channel && args.notify_chat_id)
			) {
				return json({ error: 'notify_channel and notify_chat_id must be given together' })
			}
			const callId = crypto.randomUUID()
			const result = await callDo(callStub(env, callId), '/start', {
				call_id: callId,
				to: args.to,
				goal: args.goal,
				context: args.context,
				notify:
					args.notify_channel && args.notify_chat_id
						? { channel: args.notify_channel, chat_id: args.notify_chat_id }
						: undefined,
				max_minutes: args.max_minutes,
			})
			return json({
				call_id: callId,
				...result,
				next: 'Use phone_call_status (optionally with wait_seconds) to follow the call, or phone_call_hangup to stop it.',
			})
		},
	})

	defineTool(agent, {
		name: 'phone_call_status',
		description:
			'Status, transcript, outcome, and event log of a phone call started with phone_call_start. With wait_seconds it long-polls until the call ends or the wait elapses.',
		schema: {
			call_id: z.string().describe('call_id returned by phone_call_start'),
			wait_seconds: z
				.number()
				.int()
				.min(0)
				.max(120)
				.optional()
				.default(0)
				.describe('Block up to this long waiting for the call to end'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const stub = callStub(env, args.call_id)
			const deadline = Date.now() + args.wait_seconds * 1000
			for (;;) {
				const result = await callDo(stub, '/status')
				const call = result.call as { status?: string } | undefined
				if (!result.ok || call?.status === 'ended' || Date.now() + 3000 > deadline) {
					return json(result)
				}
				await new Promise((resolve) => setTimeout(resolve, 3000))
			}
		},
	})

	defineTool(agent, {
		name: 'phone_call_hangup',
		description: 'Hang up a phone call started with phone_call_start.',
		schema: { call_id: z.string().describe('call_id returned by phone_call_start') },
		scope: ['network', 'write:phone'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => json(await callDo(callStub(env, args.call_id), '/hangup', {})),
	})
}
