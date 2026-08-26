import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { registerAllCapabilities } from './capabilities/index.ts'
import { handleSlackWebhook } from './channels/slack.ts'
import { handleTelegramWebhook } from './channels/telegram.ts'
import { handleCapabilityReindex } from './cron/capability-reindex.ts'
import { handleConsolidation } from './cron/consolidation.ts'
import { handleDailyBrief } from './cron/daily-brief.ts'
import { handleSkillDistillation } from './cron/skill-distillation.ts'
import { BrowserSessionDO } from './do/browser-session.ts'
import { LiveCanvasDO } from './do/live-canvas.ts'
import { SandboxStorageDO } from './do/sandbox-storage.ts'
import { handleAppsRequest } from './lib/apps-handler.ts'
import { handleAppsLoginGet, handleAppsLoginPost, handleAppsLogout } from './lib/apps-login.ts'
import { getCapabilityRegistry } from './lib/capability.ts'
import { handleCallback, startFlow } from './lib/oauth-flow.ts'
import { handleAuthorizeGet, handleAuthorizePost } from './lib/oauth-handlers.ts'
import { FermiMCP } from './mcp/index.ts'
import { CodemodeFetchGateway } from './sandbox/fetch-gateway.ts'
import { seedSkills } from './seeds/index.ts'

export { BrowserSessionDO, CodemodeFetchGateway, FermiMCP, LiveCanvasDO, SandboxStorageDO }

// biome-ignore lint/suspicious/noExplicitAny: McpAgent.serve is not exposed in types
const mcpApiHandler = (FermiMCP as any).serve('/mcp', { binding: 'MCP_OBJECT' })
// biome-ignore lint/suspicious/noExplicitAny: McpAgent.serve is not exposed in types
const sseApiHandler = (FermiMCP as any).serve('/sse', { binding: 'MCP_OBJECT' })

const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') return Response.json({ status: 'ok', name: 'fermi' })
		if (url.pathname === '/') return new Response('Fermi MCP Server', { status: 200 })

		if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
			return handleAuthorizeGet(request, env)
		}
		if (url.pathname === '/oauth/authorize' && request.method === 'POST') {
			return handleAuthorizePost(request, env)
		}

		if (url.pathname === '/oauth/start') {
			const provider = url.searchParams.get('provider')
			if (!provider) return new Response('Missing provider', { status: 400 })
			const baseUrl = `${url.protocol}//${url.host}`
			try {
				const { url: authUrl } = await startFlow(provider, baseUrl, env)
				return Response.redirect(authUrl, 302)
			} catch (err) {
				return Response.json(
					{ error: err instanceof Error ? err.message : 'oauth_start_failed' },
					{ status: 400 },
				)
			}
		}

		if (url.pathname === '/oauth/callback') {
			const baseUrl = `${url.protocol}//${url.host}`
			try {
				const result = await handleCallback(url, env, baseUrl)
				return Response.json({ status: 'ok', ...result })
			} catch (err) {
				return Response.json(
					{ error: err instanceof Error ? err.message : 'oauth_callback_failed' },
					{ status: 400 },
				)
			}
		}

		if (url.pathname === '/cron/capability-reindex') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const result = await handleCapabilityReindex(env)
			return Response.json(result)
		}

		if (url.pathname === '/admin/seed-skills' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const result = await seedSkills(env)
			return Response.json(result)
		}

		if (url.pathname === '/capabilities') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			registerAllCapabilities()
			const registry = getCapabilityRegistry().map((c) => ({
				name: c.name,
				domain: c.domain,
				description: c.description,
				scope: c.scope,
				risk: c.risk,
				readOnly: c.readOnly ?? false,
				idempotent: c.idempotent ?? false,
				destructive: c.destructive ?? false,
				keywords: c.keywords ?? [],
				tags: c.tags ?? [],
			}))
			return Response.json({ count: registry.length, capabilities: registry })
		}

		// Auth-disabled bypass: serve MCP directly without Bearer validation.
		if (url.pathname === '/mcp' || url.pathname === '/sse') {
			const handler = url.pathname === '/mcp' ? mcpApiHandler : sseApiHandler
			return handler.fetch(request, env, ctx)
		}

		if (url.pathname === '/apps/_login' && request.method === 'GET') {
			return handleAppsLoginGet(request)
		}
		if (url.pathname === '/apps/_login' && request.method === 'POST') {
			return handleAppsLoginPost(request, env)
		}
		if (url.pathname === '/apps/_logout') return handleAppsLogout(request, env)
		if (url.pathname.startsWith('/apps/')) return handleAppsRequest(request, env)

		if (url.pathname === '/tg/webhook') return handleTelegramWebhook(request, env)
		if (url.pathname === '/slack/events') return handleSlackWebhook(request, env)

		if (url.pathname.startsWith('/canvas/')) {
			const canvasId = url.pathname.slice('/canvas/'.length).split('/')[0]
			if (!canvasId) return new Response('Missing canvas ID', { status: 400 })
			const id = env.CANVAS_DO.idFromName(canvasId)
			return env.CANVAS_DO.get(id).fetch(request)
		}

		return new Response('Not Found', { status: 404 })
	},
} satisfies ExportedHandler<Env>

const oauthProvider = new OAuthProvider({
	apiHandlers: {
		'/mcp': mcpApiHandler,
		'/sse': sseApiHandler,
	},
	defaultHandler,
	authorizeEndpoint: '/oauth/authorize',
	tokenEndpoint: '/oauth/token',
	clientRegistrationEndpoint: '/oauth/register',
	scopesSupported: ['mcp'],
	allowPlainPKCE: false,
})

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
		if (env.FERMI_AUTH_ENABLED !== 'true') {
			return defaultHandler.fetch(request, env, ctx)
		}
		return oauthProvider.fetch(request, env, ctx)
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		if (controller.cron === '0 3 * * *') ctx.waitUntil(handleConsolidation(env))
		if (controller.cron === '0 8 * * *') ctx.waitUntil(handleDailyBrief(env))
		if (controller.cron === '0 2 * * SUN') ctx.waitUntil(handleSkillDistillation(env))
		if (controller.cron === '0 */6 * * *') ctx.waitUntil(handleCapabilityReindex(env))
	},
} satisfies ExportedHandler<Env>
