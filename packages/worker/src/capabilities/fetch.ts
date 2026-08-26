import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'

export function registerFetchCapabilities() {
	defineCapability({
		name: 'fetch_url',
		domain: 'network',
		description:
			'Fetch a URL. The fetch gateway expands {{secret:NAME}} placeholders in headers/body and enforces per-secret allowed_hosts.',
		inputSchema: z.object({
			url: z.string().url(),
			method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
			headers: z.record(z.string()).optional(),
			body: z.string().optional(),
			as: z.enum(['text', 'json']).default('json'),
		}),
		scope: ['network'],
		risk: 'med',
		readOnly: false,
		idempotent: false,
		keywords: ['fetch', 'http', 'url', 'request', 'github', 'api'],
		handler: async (args, env) => {
			if (!env.GATEWAY) {
				return {
					status: 0,
					ok: false,
					error: 'gateway_not_configured',
					message:
						'fetch_url requires the GATEWAY service binding for {{secret:NAME}} substitution',
				}
			}
			const init: RequestInit = {
				method: args.method,
				headers: args.headers,
				body: args.body,
			}
			const req = new Request(args.url, init)
			const res = await env.GATEWAY.fetch(req)
			const contentType = res.headers.get('content-type') ?? ''
			const body =
				args.as === 'json' && contentType.includes('json') ? await res.json() : await res.text()
			return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body }
		},
	})
}
