import { z } from 'zod'
import {
	type SecretScope,
	addAllowedHost,
	deleteSecret,
	getSecret,
	listSecrets,
	putSecret,
} from '../../lib/secrets-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

const scopeEnum = z.enum(['user', 'app', 'session'])

export function registerSecretTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'secret_set',
		description:
			'Store an encrypted secret. Provide allowed_hosts to scope where the secret may be sent.',
		schema: {
			name: z.string().min(1).max(128).describe('Secret name (e.g. GITHUB_TOKEN)'),
			value: z.string().min(1).describe('The secret value'),
			scope: scopeEnum.default('app').describe('Visibility scope'),
			allowed_hosts: z
				.array(z.string())
				.optional()
				.default([])
				.describe('Hosts the secret may be sent to (e.g. ["api.github.com"])'),
			allowed_capabilities: z
				.array(z.string())
				.optional()
				.default([])
				.describe('Capability names allowed to read this secret'),
			allowed_packages: z
				.array(z.string())
				.optional()
				.default([])
				.describe('Package slugs allowed to read this secret'),
		},
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const sessionId = agent.state?.sessionId ?? ''
			const meta = await putSecret(
				{
					name: args.name,
					value: args.value,
					scope: args.scope as SecretScope,
					sessionId,
					allowedHosts: args.allowed_hosts,
					allowedCapabilities: args.allowed_capabilities,
					allowedPackages: args.allowed_packages,
				},
				env,
			)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							status: 'stored',
							name: meta.name,
							scope: meta.scope,
							allowed_hosts: meta.allowed_hosts,
							allowed_capabilities: meta.allowed_capabilities,
							allowed_packages: meta.allowed_packages,
							updated_at: meta.updated_at,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'secret_list',
		description: 'List secret metadata (never returns plaintext values).',
		schema: {
			scope: scopeEnum.optional().describe('Filter by scope'),
		},
		scope: ['read'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => {
			const items = await listSecrets((args.scope as SecretScope) ?? null, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ secrets: items, total: items.length }),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'secret_delete',
		description: 'Delete a secret by name + scope.',
		schema: {
			name: z.string().min(1),
			scope: scopeEnum.default('app'),
		},
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const sessionId = agent.state?.sessionId ?? ''
			const deleted = await deleteSecret(args.name, args.scope as SecretScope, sessionId, env)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							name: args.name,
							scope: args.scope,
							deleted,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'secret_resolve',
		description:
			'Resolve a decrypted secret value (for local crypto like SRP/HMAC/JWT signing). The secret must list "secret_resolve" in its allowed_capabilities. Rate-limited to 10 calls/min.',
		schema: {
			name: z.string().min(1).max(128).describe('Secret name'),
			scope: scopeEnum.default('app').describe('Visibility scope'),
			purpose: z
				.string()
				.min(1)
				.max(256)
				.describe('Human-readable justification, recorded in audit'),
		},
		scope: ['read'],
		risk: 'med',
		mutates: false,
		handler: async (args, env) => {
			const sessionId = agent.state?.sessionId ?? ''
			const secret = await getSecret(args.name, args.scope as SecretScope, sessionId, env)
			if (!secret) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'not_found', name: args.name }),
						},
					],
				}
			}
			if (!secret.metadata.allowed_capabilities.includes('secret_resolve')) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'not_opted_in',
								name: args.name,
								hint: "Re-run secret_set with allowed_capabilities including 'secret_resolve'",
							}),
						},
					],
				}
			}
			const rateKey = `ratelimit:secret_resolve:${sessionId || 'global'}`
			const cur = await env.FERMI_KV.get(rateKey)
			const count = cur ? Number.parseInt(cur, 10) : 0
			if (count >= 10) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'rate_limited', limit: 10, window_s: 60 }),
						},
					],
				}
			}
			await env.FERMI_KV.put(rateKey, String(count + 1), { expirationTtl: 60 })
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							name: args.name,
							value: secret.value,
							scope: args.scope,
						}),
					},
				],
			}
		},
	})

	defineTool(agent, {
		name: 'secret_approve_host',
		description:
			"Add a host to an existing secret's allowed_hosts list. The fetch gateway will then allow {{secret:NAME}} substitution for requests to that host.",
		schema: {
			name: z.string().min(1),
			scope: scopeEnum.default('app'),
			host: z.string().min(1).describe('Hostname to approve (e.g. "api.github.com")'),
		},
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const sessionId = agent.state?.sessionId ?? ''
			const updated = await addAllowedHost(
				args.name,
				args.scope as SecretScope,
				sessionId,
				args.host,
				env,
			)
			if (!updated) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'not_found',
								name: args.name,
								scope: args.scope,
							}),
						},
					],
				}
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							status: 'approved',
							name: updated.name,
							scope: updated.scope,
							allowed_hosts: updated.allowed_hosts,
						}),
					},
				],
			}
		},
	})
}
