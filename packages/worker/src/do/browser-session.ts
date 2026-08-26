import { DurableObject } from 'cloudflare:workers'
import puppeteer, { type Browser, type Page } from '@cloudflare/puppeteer'
import { type BrowserAction, executeAction } from '../lib/browser-actions.ts'

interface LaunchBody {
	label?: string
	keep_alive_ms?: number
}

interface ActionBody {
	actions: BrowserAction[]
	viewport?: { width: number; height: number }
}

interface RequestHumanBody {
	message?: string
}

interface ActionResult {
	action: string
	ok: boolean
	result?: unknown
	error?: string
}

export class BrowserSessionDO extends DurableObject<Env> {
	private browser: Browser | undefined

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		try {
			switch (url.pathname) {
				case '/launch':
					return await this.handleLaunch(request)
				case '/action':
					return await this.handleAction(request)
				case '/request_human':
					return await this.handleRequestHuman(request)
				case '/resume':
					return await this.handleResume()
				case '/close':
					return await this.handleClose()
				case '/info':
					return await this.handleInfo()
				default:
					return new Response('Not found', { status: 404 })
			}
		} catch (err) {
			return Response.json(
				{ ok: false, error: err instanceof Error ? err.message : String(err) },
				{ status: 500 },
			)
		}
	}

	private async getOrReconnect(): Promise<Browser> {
		if (this.browser) {
			try {
				await this.browser.version()
				return this.browser
			} catch {
				this.browser = undefined
			}
		}
		throw new Error('Browser session is no longer active. Please launch a new session.')
	}

	private async handleLaunch(request: Request): Promise<Response> {
		const { label, keep_alive_ms = 120_000 } = await request.json<LaunchBody>()
		if (!this.env.MYBROWSER) throw new Error('MYBROWSER binding not available')

		// biome-ignore lint/suspicious/noExplicitAny: keep_alive not typed in @cloudflare/puppeteer
		const browser = (await (puppeteer as any).launch(this.env.MYBROWSER, {
			keep_alive: keep_alive_ms,
		})) as Browser
		this.browser = browser

		const liveViewUrl = await resolveLiveViewUrl(browser, this.env)

		await this.ctx.storage.put('live_view_url', liveViewUrl ?? '')
		await this.ctx.storage.put('status', 'active')
		await this.ctx.storage.put('label', label ?? '')
		return Response.json({ ok: true, live_view_url: liveViewUrl })
	}

	private async handleAction(request: Request): Promise<Response> {
		const { actions, viewport } = await request.json<ActionBody>()
		const browser = await this.getOrReconnect()
		const pages = await browser.pages()
		const page: Page = pages[0] ?? (await browser.newPage())
		if (viewport) await page.setViewport(viewport)

		const results: ActionResult[] = []
		let failed = 0
		for (const action of actions) {
			const result = await executeAction(page, action, this.env)
			results.push(result)
			if (!result.ok) {
				failed++
				break
			}
		}

		await this.ctx.storage.put('last_activity', Date.now())
		return Response.json({
			ok: true,
			results,
			totalActions: actions.length,
			succeeded: results.length - failed,
			failed,
		})
	}

	private async handleRequestHuman(request: Request): Promise<Response> {
		const body = await request.json<RequestHumanBody>().catch((): RequestHumanBody => ({}))
		const liveViewUrl = await this.ctx.storage.get<string>('live_view_url')
		await this.ctx.storage.put('status', 'waiting_for_human')
		return Response.json({
			ok: true,
			live_view_url: liveViewUrl || null,
			message:
				body.message ?? 'Human intervention required. Open the live view URL to take control.',
		})
	}

	private async handleResume(): Promise<Response> {
		await this.ctx.storage.put('status', 'active')
		return Response.json({ ok: true, status: 'active' })
	}

	private async handleClose(): Promise<Response> {
		try {
			await this.browser?.close()
		} catch {}
		this.browser = undefined
		await this.ctx.storage.put('status', 'closed')
		await this.ctx.storage.deleteAll()
		return Response.json({ ok: true })
	}

	private async handleInfo(): Promise<Response> {
		const liveViewUrl = await this.ctx.storage.get<string>('live_view_url')
		const status = (await this.ctx.storage.get<string>('status')) ?? 'unknown'
		const label = await this.ctx.storage.get<string>('label')
		return Response.json({ ok: true, live_view_url: liveViewUrl || null, status, label })
	}
}

async function resolveLiveViewUrl(browser: Browser, env: Env): Promise<string | null> {
	// Get the CF session ID via the browser.sessionId() CF-specific method.
	// Then call the CF REST API /json/list to get the JWT-authenticated devtoolsFrontendUrl.
	// Falls back to a plain (unauthenticated) URL if the REST API is unavailable.
	try {
		// biome-ignore lint/suspicious/noExplicitAny: sessionId() is CF-specific, not in upstream types
		const sid: unknown = await (browser as any).sessionId?.()
		if (typeof sid !== 'string' || !sid) return null

		// Fetch the JWT-authenticated live view URL from the CF REST API
		if (env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN) {
			try {
				const res = await fetch(
					`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/devtools/browser/${sid}/json/list`,
					{ headers: { Authorization: `Bearer ${env.CF_BROWSER_API_TOKEN}` } },
				)
				if (res.ok) {
					const targets = (await res.json()) as Array<{ devtoolsFrontendUrl?: string }>
					const url = targets[0]?.devtoolsFrontendUrl
					if (url) return url
				}
			} catch {}
		}

		// Fallback: unauthenticated URL (only works if token lacks Browser Rendering - Read scope)
		return `https://devtools.browser.run/devtools/inspector.html?wss=devtools.browser.run/devtools/browser/${sid}`
	} catch {}

	return null
}
