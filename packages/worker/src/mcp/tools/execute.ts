import { z } from 'zod'
import { registerAllCapabilities } from '../../capabilities/index.ts'
import { isBlocked } from '../../lib/shell-blocklist.ts'
import { defineTool } from '../../lib/tool.ts'
import { runUserCode } from '../../sandbox/executor.ts'
import type { FermiMCP } from '../index.ts'

export function registerExecuteTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'execute',
		description:
			'Run JavaScript in an isolated Worker sandbox. Capabilities are reachable as `codemode.<name>(args)`. fetch() is blocked until Phase 4.',
		schema: {
			code: z
				.string()
				.describe(
					'JavaScript source. Default export an async function or use a top-level await expression. Must `return` a result.',
				),
		},
		scope: ['shell'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const blockCheck = isBlocked(args.code)
			if (blockCheck.blocked) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								status: 'denied',
								reason: `Command blocked by safety rule: ${blockCheck.rule}`,
							}),
						},
					],
				}
			}

			registerAllCapabilities()

			const result = await runUserCode({
				source: args.code,
				env,
				agentState: agent.state,
				outboundFetcher: env.GATEWAY ?? null,
			})

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(result, null, 2),
					},
				],
			}
		},
	})
}
