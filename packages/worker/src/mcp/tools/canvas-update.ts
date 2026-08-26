import { z } from 'zod'
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
}
