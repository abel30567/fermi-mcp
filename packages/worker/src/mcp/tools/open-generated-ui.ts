import { z } from 'zod'
import { createCanvas } from '../../lib/canvas-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerOpenGeneratedUiTool(agent: FermiMCP) {
	defineTool(agent, {
		name: 'open_generated_ui',
		description:
			'Create a new live canvas and return its URL. The canvas can be updated in real-time via canvas_update.',
		schema: {
			title: z.string().optional().describe('Optional title for the canvas'),
			initial_state: z
				.record(z.unknown())
				.optional()
				.describe('Optional initial state to populate the canvas with'),
		},
		scope: ['write:canvas'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const result = await createCanvas(args.title, args.initial_state, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(
							{ ...result, note: 'Canvas is live. Use canvas_update to modify state.' },
							null,
							2,
						),
					},
				],
			}
		},
	})
}
