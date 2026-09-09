import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { registerAllCapabilities } from './capabilities/index.ts'
import {
	authBox,
	handleBoxArtifact,
	handleBoxComplete,
	handleBoxHeartbeat,
	handleBoxInferenceAuth,
	handleBoxInferenceAuthUpdate,
	handleBoxPoll,
	handleBoxReport,
	handleBoxSessionLease,
	handleBoxSessionRelease,
	listAgentArtifacts,
} from './channels/box-gateway.ts'
import { handleDiscordWebhook } from './channels/discord.ts'
import { handleNarrate } from './channels/narrate.ts'
import { handleSlackWebhook } from './channels/slack.ts'
import { handleTelegramWebhook, setTelegramWebhook } from './channels/telegram.ts'
import { handleWaOutboxAck, handleWaOutboxGet, handleWhatsAppWebhook } from './channels/whatsapp.ts'
import { handleCapabilityReindex } from './cron/capability-reindex.ts'
import { handleConsolidation } from './cron/consolidation.ts'
import { handleDailyBrief } from './cron/daily-brief.ts'
import { handleFleetReaper } from './cron/fleet-reaper.ts'
import { handleScheduleTick } from './cron/schedule-tick.ts'
import { handleSkillDistillation } from './cron/skill-distillation.ts'
import { BrowserSessionDO } from './do/browser-session.ts'
import { FleetDO } from './do/fleet-do.ts'
import { LiveCanvasDO } from './do/live-canvas.ts'
import { SandboxStorageDO } from './do/sandbox-storage.ts'
import { handleAppsRequest } from './lib/apps-handler.ts'
import { handleAppsLoginGet, handleAppsLoginPost, handleAppsLogout } from './lib/apps-login.ts'
import { getCapabilityRegistry } from './lib/capability.ts'
import { handleCallback, startFlow } from './lib/oauth-flow.ts'
import { handleAuthorizeGet, handleAuthorizePost } from './lib/oauth-handlers.ts'
import { countPendingTasks } from './lib/task-store.ts'
import { FermiMCP } from './mcp/index.ts'
import { CodemodeFetchGateway } from './sandbox/fetch-gateway.ts'
import { seedSkills } from './seeds/index.ts'

export { BrowserSessionDO, CodemodeFetchGateway, FermiMCP, FleetDO, LiveCanvasDO, SandboxStorageDO }

// biome-ignore lint/suspicious/noExplicitAny: McpAgent.serve is not exposed in types
const mcpApiHandler = (FermiMCP as any).serve('/mcp', { binding: 'MCP_OBJECT' })
// biome-ignore lint/suspicious/noExplicitAny: McpAgent.serve is not exposed in types
const sseApiHandler = (FermiMCP as any).serve('/sse', { binding: 'MCP_OBJECT' })
// Box-token-authenticated MCP: cloud agents can't run interactive OAuth, so
// they reach the same tool surface via their per-box bearer token instead.
// biome-ignore lint/suspicious/noExplicitAny: McpAgent.serve is not exposed in types
const boxMcpApiHandler = (FermiMCP as any).serve('/box/mcp', { binding: 'MCP_OBJECT' })

const defaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			// version = deploy id; long-lived workers (warm worker) respawn when it
			// changes so their MCP toolset and prompt never go stale.
			const meta = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA
			return Response.json({ status: 'ok', name: 'fermi', version: meta?.id ?? null })
		}
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

		if (url.pathname === '/admin/tg/set-webhook' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const body = (await request.json().catch(() => ({}))) as { url?: string }
			const webhookUrl = body.url ?? `${url.origin}/tg/webhook`
			const result = await setTelegramWebhook(env, webhookUrl)
			return Response.json(result, { status: result.ok ? 200 : 400 })
		}

		if (url.pathname === '/admin/narrate' && request.method === 'POST') {
			return handleNarrate(request, env)
		}

		// Fleet admin: bearer-gated launch/status for fleetctl and daemon scripts
		// (the MCP tool path stays the primary, approval-gated interface).
		if (url.pathname === '/admin/fleet/launch' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const body = (await request.json().catch(() => null)) as {
				prompt?: string
				proof_contract?: string
			} | null
			if (!body || typeof body.prompt !== 'string' || typeof body.proof_contract !== 'string') {
				return Response.json(
					{ ok: false, error: 'prompt and proof_contract are required' },
					{ status: 400 },
				)
			}
			const { launchCloudAgent } = await import('./lib/fleet-launch.ts')
			const result = await launchCloudAgent(env, body as Parameters<typeof launchCloudAgent>[1])
			return Response.json(result, { status: result.ok ? 200 : 409 })
		}
		// Bearer capture for the Mac session-capture helper (logs in on residential
		// IP, exports Playwright storageState, POSTs it here — no MCP OAuth needed).
		if (url.pathname === '/admin/session/capture' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const body = (await request.json().catch(() => null)) as {
				name?: string
				site?: string
				storage_state?: string
				max_concurrent?: number
				allowed_boxes?: string[]
				ttl_seconds?: number
			} | null
			if (!body?.name || !body.site || typeof body.storage_state !== 'string') {
				return Response.json(
					{ ok: false, error: 'name, site, storage_state required' },
					{ status: 400 },
				)
			}
			const { captureWebSession } = await import('./lib/web-session-store.ts')
			const meta = await captureWebSession(env, {
				name: body.name,
				site: body.site,
				storageState: body.storage_state,
				maxConcurrent: body.max_concurrent,
				allowedBoxes: body.allowed_boxes,
				ttlSeconds: body.ttl_seconds,
			})
			return Response.json({ ok: true, session: meta })
		}
		if (url.pathname === '/admin/fleet/artifact' && request.method === 'GET') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const key = url.searchParams.get('key') ?? ''
			if (!key.startsWith('artifacts/') || key.includes('..')) {
				return new Response('Bad Request', { status: 400 })
			}
			const obj = await env.FERMI_BUCKET.get(key)
			if (!obj) return new Response('Not Found', { status: 404 })
			return new Response(obj.body, {
				headers: {
					'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
					'Content-Length': String(obj.size),
					'Cache-Control': 'private, no-store',
				},
			})
		}
		if (url.pathname === '/admin/fleet/reservations' && request.method === 'GET') {
			const auth = request.headers.get('authorization') ?? ''
			if (!env.FERMI_BEARER_TOKEN || auth !== `Bearer ${env.FERMI_BEARER_TOKEN}`)
				return new Response('Unauthorized', { status: 401 })
			const ns = (env as unknown as { FLEET_DO: DurableObjectNamespace }).FLEET_DO
			return ns.get(ns.idFromName('global')).fetch('https://do/state')
		}
		if (url.pathname === '/admin/fleet/release' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			if (!env.FERMI_BEARER_TOKEN || auth !== `Bearer ${env.FERMI_BEARER_TOKEN}`)
				return new Response('Unauthorized', { status: 401 })
			const b = (await request.json().catch(() => ({}))) as { agent_id?: string }
			if (!b.agent_id)
				return Response.json({ ok: false, error: 'agent_id required' }, { status: 400 })
			const { fleetRelease } = await import('./do/fleet-do.ts')
			await fleetRelease(env, b.agent_id)
			return Response.json({ ok: true, released: b.agent_id })
		}
		if (url.pathname === '/admin/fleet/pin-runner' && request.method === 'POST') {
			const auth = request.headers.get('authorization') ?? ''
			if (!env.FERMI_BEARER_TOKEN || auth !== `Bearer ${env.FERMI_BEARER_TOKEN}`)
				return new Response('Unauthorized', { status: 401 })
			const b = (await request.json().catch(() => ({}))) as { ref?: string }
			if (!b.ref || !/^[0-9a-f]{7,40}$/.test(b.ref))
				return Response.json({ ok: false, error: 'ref must be a commit sha' }, { status: 400 })
			const { runnerUrl } = await import('./lib/runner-pin.ts')
			const res = await fetch(runnerUrl(b.ref))
			if (!res.ok)
				return Response.json({ ok: false, error: `fetch_${res.status}` }, { status: 502 })
			const bytes = await res.arrayBuffer()
			const digest = await crypto.subtle.digest('SHA-256', bytes)
			const sha256 = [...new Uint8Array(digest)]
				.map((x) => x.toString(16).padStart(2, '0'))
				.join('')
			const raw = await env.FERMI_KV.get('fleet:config')
			const config = raw ? JSON.parse(raw) : {}
			await env.FERMI_KV.put(
				'fleet:config',
				JSON.stringify({ ...config, runner_ref: b.ref, runner_sha256: sha256 }),
			)
			return Response.json({ ok: true, ref: b.ref, sha256, bytes: bytes.byteLength })
		}
		if (url.pathname === '/admin/fleet/status' && request.method === 'GET') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			const { getCloudAgent, listBoxes, listCloudAgents } = await import('./lib/fleet-store.ts')
			const { listTasks } = await import('./lib/task-store.ts')
			const id = url.searchParams.get('id')
			if (id) {
				const agent = await getCloudAgent(env.FERMI_DB, id)
				if (!agent) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
				const events = await listTasks(env.FERMI_DB, { queue: `${agent.queue}:events`, limit: 20 })
				const tasks = await listTasks(env.FERMI_DB, { queue: agent.queue, limit: 5 })
				return Response.json({
					ok: true,
					agent,
					tasks,
					events: events.map((e) => ({ at: e.created_at, from: e.sender, note: e.payload })),
					artifacts: await listAgentArtifacts(env, agent.id),
				})
			}
			return Response.json({
				ok: true,
				agents: await listCloudAgents(env.FERMI_DB, { limit: 50 }),
				boxes: await listBoxes(env.FERMI_DB, { limit: 50 }),
			})
		}

		if (url.pathname === '/admin/tasks/pending' && request.method === 'GET') {
			const auth = request.headers.get('authorization') ?? ''
			const token = env.FERMI_BEARER_TOKEN
			if (!token || auth !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 })
			return Response.json({ pending: await countPendingTasks(env.FERMI_DB) })
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

		if (url.pathname === '/tg/webhook') return handleTelegramWebhook(request, env, ctx)
		if (url.pathname === '/slack/events') return handleSlackWebhook(request, env)

		if (url.pathname === '/wa/webhook' && request.method === 'POST') {
			return handleWhatsAppWebhook(request, env)
		}
		if (url.pathname === '/box/mcp') {
			const box = await authBox(request, env)
			if (!box)
				return new Response('Unauthorized', { status: 401 })
				// Set the auth context the way OAuthProvider would, then serve the
				// identical MCP tool surface. Box identity flows into the session host.
			;(ctx as unknown as { props: { baseUrl: string } }).props = {
				baseUrl: `box:${box.box_id}`,
			}
			return boxMcpApiHandler.fetch(request, env, ctx)
		}
		if (url.pathname === '/box/heartbeat' && request.method === 'POST') {
			return handleBoxHeartbeat(request, env)
		}
		if (url.pathname === '/box/poll' && request.method === 'POST') {
			return handleBoxPoll(request, env)
		}
		if (url.pathname === '/box/complete' && request.method === 'POST') {
			return handleBoxComplete(request, env)
		}
		if (url.pathname === '/box/report' && request.method === 'POST') {
			return handleBoxReport(request, env)
		}
		if (url.pathname === '/box/artifact' && request.method === 'POST') {
			return handleBoxArtifact(request, env)
		}
		if (url.pathname === '/box/browser-rpc' && request.method === 'POST') {
			const { handleBoxBrowserRpc } = await import('./channels/broker.ts')
			return handleBoxBrowserRpc(request, env)
		}
		if (url.pathname === '/box/browser-rpc/wait' && request.method === 'POST') {
			const { handleBoxBrowserRpcWait } = await import('./channels/broker.ts')
			return handleBoxBrowserRpcWait(request, env)
		}
		if (url.pathname === '/admin/broker/claim' && request.method === 'POST') {
			const { handleBrokerClaim } = await import('./channels/broker.ts')
			return handleBrokerClaim(request, env)
		}
		if (url.pathname === '/admin/broker/complete' && request.method === 'POST') {
			const { handleBrokerComplete } = await import('./channels/broker.ts')
			return handleBrokerComplete(request, env)
		}
		if (url.pathname === '/admin/session/state' && request.method === 'GET') {
			const auth = request.headers.get('authorization') ?? ''
			if (!env.FERMI_BEARER_TOKEN || auth !== `Bearer ${env.FERMI_BEARER_TOKEN}`)
				return new Response('Unauthorized', { status: 401 })
			const name = url.searchParams.get('name')
			if (!name) return Response.json({ ok: false, error: 'name required' }, { status: 400 })
			const { getWebSessionState } = await import('./lib/web-session-store.ts')
			const result = await getWebSessionState(env, name)
			return Response.json(result, { status: result.ok ? 200 : 404 })
		}
		if (url.pathname === '/box/session-lease' && request.method === 'POST') {
			return handleBoxSessionLease(request, env)
		}
		if (url.pathname === '/box/session-release' && request.method === 'POST') {
			return handleBoxSessionRelease(request, env)
		}
		if (url.pathname === '/box/inference-auth' && request.method === 'POST') {
			return handleBoxInferenceAuth(request, env)
		}
		if (url.pathname === '/box/inference-auth/update' && request.method === 'POST') {
			return handleBoxInferenceAuthUpdate(request, env)
		}
		if (url.pathname === '/wa/outbox' && request.method === 'GET') {
			return handleWaOutboxGet(request, env)
		}
		if (url.pathname === '/wa/outbox/ack' && request.method === 'POST') {
			return handleWaOutboxAck(request, env)
		}

		if (url.pathname === '/dc/webhook' && request.method === 'POST') {
			return handleDiscordWebhook(request, env)
		}

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
		if (controller.cron === '*/5 * * * *') {
			ctx.waitUntil(handleScheduleTick(env))
			ctx.waitUntil(handleFleetReaper(env))
		}
	},
} satisfies ExportedHandler<Env>
