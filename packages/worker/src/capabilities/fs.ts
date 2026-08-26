import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import { checkWriteAllowed, listFiles, readFile, writeFile } from '../lib/fs-store.ts'

export function registerFsCapabilities() {
	defineCapability({
		name: 'fs_read',
		domain: 'fs',
		description: 'Read a file from R2 storage by path.',
		inputSchema: z.object({ path: z.string().min(1) }),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['file', 'read', 'storage', 'r2'],
		handler: async (args, env) => {
			const res = await readFile(args.path, env)
			if (!res) return { error: 'not_found', path: args.path }
			return res
		},
	})

	defineCapability({
		name: 'fs_list',
		domain: 'fs',
		description: 'List files in R2 storage by prefix.',
		inputSchema: z.object({ prefix: z.string().default('') }),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['file', 'list', 'storage', 'r2', 'directory'],
		handler: async (args, env) => {
			const res = await listFiles(args.prefix, env)
			return { ...res, total: res.objects.length }
		},
	})

	defineCapability({
		name: 'fs_write',
		domain: 'fs',
		description: 'Write a file to R2. Path must be within allowed scope prefixes.',
		inputSchema: z.object({ path: z.string().min(1), body: z.string() }),
		scope: ['write:fs'],
		risk: 'med',
		readOnly: false,
		keywords: ['file', 'write', 'storage', 'r2', 'save'],
		handler: async (args, env) => {
			const check = await checkWriteAllowed(args.path, env)
			if (!check.allowed) {
				return {
					error: 'denied',
					reason: 'path_not_in_allowed_scope',
					allowed: check.allowedPrefixes,
				}
			}
			return writeFile(args.path, args.body, env)
		},
	})
}
