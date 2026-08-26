import { z } from 'zod'
import { deletePackage, getPackage, listPackages, putPackage } from '../../lib/packages-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerPackageTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'package_set',
		description:
			'Store a JS module that sandbox code can import via `await import("<slug>")`. Slug must end with `.js`. risk:high — arbitrary code.',
		schema: {
			slug: z
				.string()
				.min(1)
				.regex(/^[a-zA-Z0-9_:.-]+$/)
				.describe('Module specifier the sandbox will import'),
			source: z.string().min(1).describe('JS source — must be valid ESM'),
			version: z.string().optional(),
			description: z.string().optional(),
			allowed_imports: z.array(z.string()).optional(),
		},
		scope: ['write:packages'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const meta = await putPackage(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ status: 'stored', ...meta }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'package_list',
		description: 'List installed packages (metadata only, never source).',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const items = await listPackages(env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ packages: items, total: items.length }) },
				],
			}
		},
	})

	defineTool(agent, {
		name: 'package_get',
		description: 'Read a package source by slug.',
		schema: { slug: z.string().min(1) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const row = await getPackage(args.slug, env)
			if (!row) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'not_found', slug: args.slug }),
						},
					],
				}
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							slug: row.slug,
							version: row.version,
							description: row.description,
							source: row.source,
							size: row.source.length,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'package_delete',
		description: 'Delete a package by slug.',
		schema: { slug: z.string().min(1) },
		scope: ['write:packages'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const ok = await deletePackage(args.slug, env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ slug: args.slug, deleted: ok }) },
				],
			}
		},
	})
}
