import { z } from 'zod'
import { createCanvas, patchCanvas } from '../lib/canvas-store.ts'
import { defineCapability } from '../lib/capability.ts'

export function registerCanvasCapabilities() {
	defineCapability({
		name: 'open_generated_ui',
		domain: 'canvas',
		description: 'Create a new live canvas and return its URL.',
		inputSchema: z.object({
			title: z.string().optional(),
			initial_state: z.record(z.unknown()).optional(),
		}),
		scope: ['write:canvas'],
		risk: 'low',
		readOnly: false,
		keywords: ['canvas', 'ui', 'create', 'open'],
		handler: async (args, env) => createCanvas(args.title, args.initial_state, env),
	})

	defineCapability({
		name: 'canvas_update',
		domain: 'canvas',
		description: 'Patch a live canvas with a JSON object that gets merged into its state.',
		inputSchema: z.object({
			canvas_id: z.string().min(1),
			patch: z.record(z.unknown()),
		}),
		scope: ['write:canvas'],
		risk: 'low',
		readOnly: false,
		keywords: ['canvas', 'update', 'patch'],
		handler: async (args, env) => patchCanvas(args.canvas_id, args.patch, env),
	})
}
