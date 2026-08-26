import { z } from 'zod'
import {
	deleteConnector,
	getConnector,
	listConnectors,
	putConnector,
} from '../../lib/connectors-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerConnectorTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'connector_set',
		description:
			'Define a connector — a (capability + secret + base_url) triple that the agent can reference by name. Surfaces as a discoverable entity in search.',
		schema: {
			name: z.string().min(1).max(64),
			capability: z.string().min(1).describe("Capability that handles this connector's calls"),
			secret_name: z.string().optional(),
			base_url: z.string().url(),
			description: z.string().optional(),
			default_headers: z.record(z.string()).optional(),
		},
		scope: ['write:connectors'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const c = await putConnector(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ status: 'stored', ...c }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'connector_list',
		description: 'List defined connectors.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const items = await listConnectors(env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ connectors: items, total: items.length }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'connector_get',
		description: 'Look up a connector by name.',
		schema: { name: z.string().min(1) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const c = await getConnector(args.name, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: c ? JSON.stringify(c) : JSON.stringify({ error: 'not_found', name: args.name }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'connector_delete',
		description: 'Delete a connector.',
		schema: { name: z.string().min(1) },
		scope: ['write:connectors'],
		risk: 'low',
		mutates: true,
		handler: async (args, env) => {
			const ok = await deleteConnector(args.name, env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ name: args.name, deleted: ok }) },
				],
			}
		},
	})
}
