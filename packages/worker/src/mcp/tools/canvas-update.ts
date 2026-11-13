import { z } from 'zod'
import { revokeCanvasTokens } from '../../lib/canvas-auth.ts'
import { patchCanvas } from '../../lib/canvas-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerCanvasUpdateTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'canvas_update',
		description: 'Update a live canvas by sending a JSON patch to merge into the canvas state',
		schema: {
			canvas_id: z.string().describe('The canvas ID to update'),
			patch: z.record(z.unknown()).describe('JSON object to merge into the canvas state'),
		},
		scope: ['write:canvas'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const result = await patchCanvas(args.canvas_id, args.patch, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			}
		},
	})

	defineTool(agent, {
		name: 'canvas_revoke',
		description:
			'Revoke share tokens of a live canvas: one token, or every token when none is given. Revoked links stop working; an already-open WebSocket stays connected until it disconnects.',
		schema: {
			canvas_id: z.string().describe('The canvas ID whose tokens to revoke'),
			token: z
				.string()
				.optional()
				.describe('The token to revoke; omit to revoke all tokens of the canvas'),
		},
		scope: ['write:canvas'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const revoked = await revokeCanvasTokens(env, args.canvas_id, args.token)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ revoked }, null, 2) }],
			}
		},
	})
}
