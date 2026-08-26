import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import {
	type SecretScope,
	addAllowedHost,
	deleteSecret,
	getSecret,
	listSecrets,
	putSecret,
} from '../lib/secrets-store.ts'

const scopeEnum = z.enum(['user', 'app', 'session'])

export function registerSecretCapabilities() {
	defineCapability({
		name: 'secret_list',
		domain: 'secrets',
		description: 'List secret metadata (never returns plaintext values).',
		inputSchema: z.object({ scope: scopeEnum.optional() }),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		keywords: ['secret', 'list', 'metadata'],
		handler: async (args, env) => {
			const items = await listSecrets((args.scope as SecretScope) ?? null, env)
			return { secrets: items, total: items.length }
		},
	})

	defineCapability({
		name: 'secret_set',
		domain: 'secrets',
		description:
			'Store an encrypted secret. risk:high — requires approval token from sandbox caller.',
		inputSchema: z.object({
			name: z.string().min(1).max(128),
			value: z.string().min(1),
			scope: scopeEnum.default('app'),
			allowed_hosts: z.array(z.string()).default([]),
			allowed_capabilities: z.array(z.string()).default([]),
			allowed_packages: z.array(z.string()).default([]),
		}),
		scope: ['write:secrets'],
		risk: 'high',
		readOnly: false,
		keywords: ['secret', 'set', 'store'],
		handler: async (args, env) =>
			putSecret(
				{
					name: args.name,
					value: args.value,
					scope: args.scope as SecretScope,
					allowedHosts: args.allowed_hosts,
					allowedCapabilities: args.allowed_capabilities,
					allowedPackages: args.allowed_packages,
				},
				env,
			),
	})

	defineCapability({
		name: 'secret_delete',
		domain: 'secrets',
		description: 'Delete a secret. risk:high — requires approval token.',
		inputSchema: z.object({ name: z.string().min(1), scope: scopeEnum.default('app') }),
		scope: ['write:secrets'],
		risk: 'high',
		readOnly: false,
		destructive: true,
		keywords: ['secret', 'delete'],
		handler: async (args, env) => ({
			deleted: await deleteSecret(args.name, args.scope as SecretScope, '', env),
		}),
	})

	defineCapability({
		name: 'secret_resolve',
		domain: 'secrets',
		description:
			'Resolve a decrypted secret value into the sandbox for local crypto (SRP, HMAC, JWT signing). The secret must explicitly list "secret_resolve" in its allowed_capabilities. Rate-limited to 10 calls/min per session.',
		inputSchema: z.object({
			name: z.string().min(1).max(128),
			scope: scopeEnum.default('app'),
			purpose: z.string().min(1).max(256),
		}),
		scope: ['read'],
		risk: 'med',
		readOnly: true,
		idempotent: true,
		keywords: ['secret', 'resolve', 'decrypt', 'srp', 'hmac', 'crypto'],
		handler: async (args, env, ctx) => {
			const sessionId = ctx?.sessionId ?? ''
			const secret = await getSecret(args.name, args.scope as SecretScope, sessionId, env)
			if (!secret) throw new Error(`Secret not found: ${args.name}`)
			if (!secret.metadata.allowed_capabilities.includes('secret_resolve')) {
				throw new Error(
					`Secret "${args.name}" has not opted in to secret_resolve. Add 'secret_resolve' to its allowed_capabilities.`,
				)
			}
			const rateKey = `ratelimit:secret_resolve:${sessionId || 'global'}`
			const cur = await env.FERMI_KV.get(rateKey)
			const count = cur ? Number.parseInt(cur, 10) : 0
			if (count >= 10) {
				throw new Error('Rate limit exceeded: max 10 secret_resolve calls per 60s')
			}
			await env.FERMI_KV.put(rateKey, String(count + 1), { expirationTtl: 60 })
			return { name: args.name, value: secret.value, scope: args.scope }
		},
	})

	defineCapability({
		name: 'secret_approve_host',
		domain: 'secrets',
		description: "Add a host to an existing secret's allowed_hosts list.",
		inputSchema: z.object({
			name: z.string().min(1),
			scope: scopeEnum.default('app'),
			host: z.string().min(1),
		}),
		scope: ['write:secrets'],
		risk: 'high',
		readOnly: false,
		keywords: ['secret', 'approve', 'host'],
		handler: async (args, env) => {
			const updated = await addAllowedHost(args.name, args.scope as SecretScope, '', args.host, env)
			if (!updated) return { error: 'not_found' }
			return updated
		},
	})
}
