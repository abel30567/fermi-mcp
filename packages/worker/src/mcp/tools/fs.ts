import { z } from 'zod'
import { checkWriteAllowed, listFiles, readFile, writeFile } from '../../lib/fs-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerFsTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'fs_read',
		description: 'Read a file from storage by path',
		schema: {
			path: z.string().describe('The R2 object key to read'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const result = await readFile(args.path, env)
			if (!result) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Not found', path: args.path }),
						},
					],
				}
			}
			return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
		},
	})

	defineTool(agent, {
		name: 'fs_write',
		description: 'Write a file to storage. Path must be within allowed scope prefixes.',
		schema: {
			path: z.string().describe('The R2 object key to write'),
			body: z.string().describe('The content to write'),
		},
		scope: ['write:fs'],
		risk: 'med',
		mutates: true,
		handler: async (args, env) => {
			const check = await checkWriteAllowed(args.path, env)
			if (!check.allowed) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								status: 'denied',
								reason: 'Path not in allowed scope',
								path: args.path,
								allowed: check.allowedPrefixes,
							}),
						},
					],
				}
			}
			const res = await writeFile(args.path, args.body, env)
			return { content: [{ type: 'text' as const, text: JSON.stringify(res) }] }
		},
	})

	defineTool(agent, {
		name: 'fs_list',
		description: 'List files in storage by prefix',
		schema: {
			prefix: z.string().optional().default('').describe('R2 key prefix to filter by'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const res = await listFiles(args.prefix, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ ...res, total: res.objects.length }),
					},
				],
			}
		},
	})
}
