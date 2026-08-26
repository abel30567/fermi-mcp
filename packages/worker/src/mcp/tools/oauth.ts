import { z } from 'zod'
import {
	deleteOauthClient,
	getOauthClient,
	listOauthClients,
	putOauthClient,
} from '../../lib/oauth-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerOauthTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'oauth_register_client',
		description:
			'Register an OAuth provider config. Pair this with secret_set to store the client_secret first.',
		schema: {
			name: z.string().min(1).max(64),
			client_id: z.string().min(1),
			client_secret_name: z
				.string()
				.min(1)
				.describe('Name of the secret holding the client_secret value'),
			auth_url: z.string().url(),
			token_url: z.string().url(),
			scopes: z.array(z.string()).optional(),
			redirect_path: z.string().optional(),
			result_secret_name: z.string().min(1).describe('Where to store the resulting access_token'),
			result_allowed_hosts: z
				.array(z.string())
				.optional()
				.describe('Hosts the access_token may be sent to'),
		},
		scope: ['write:oauth'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const c = await putOauthClient(args, env)
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ status: 'stored', ...c }) }],
			}
		},
	})

	defineTool(agent, {
		name: 'oauth_list_clients',
		description: 'List configured OAuth providers.',
		schema: {},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (_args, env) => {
			const items = await listOauthClients(env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ clients: items, total: items.length }) },
				],
			}
		},
	})

	defineTool(agent, {
		name: 'oauth_get_client',
		description: 'Look up an OAuth client config by name.',
		schema: { name: z.string().min(1) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const c = await getOauthClient(args.name, env)
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
		name: 'oauth_delete_client',
		description: 'Remove an OAuth client config.',
		schema: { name: z.string().min(1) },
		scope: ['write:oauth'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const ok = await deleteOauthClient(args.name, env)
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ name: args.name, deleted: ok }) },
				],
			}
		},
	})

	defineTool(agent, {
		name: 'oauth_authorize_url',
		description:
			"Generate an authorization URL for an OAuth client. The URL must be opened in a browser; after consent, /oauth/callback exchanges the code and stores the resulting access_token as the client's result_secret_name.",
		schema: { name: z.string().min(1) },
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const baseUrl =
				env.FERMI_ENV === 'development'
					? 'http://localhost:8787'
					: 'https://fermi.example.workers.dev'
			const client = await getOauthClient(args.name, env)
			if (!client) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'not_found', name: args.name }),
						},
					],
				}
			}
			// Build the URL but don't issue a state token here — let the user
			// trigger /oauth/start which performs the KV write.
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							start_url: `${baseUrl}/oauth/start?provider=${encodeURIComponent(client.name)}`,
							client: client.name,
							scopes: client.scopes,
						}),
					},
				],
			}
		},
	})
}
