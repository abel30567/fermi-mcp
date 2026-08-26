import puppeteer, { type Browser, type Page, type CookieParam } from '@cloudflare/puppeteer'
import { z } from 'zod'
import { hashArgs, writeAudit } from './audit.ts'
import { type SecretScope, getSecret } from './secrets-store.ts'

// ---------------------------------------------------------------------------
// Action schemas
// ---------------------------------------------------------------------------

const GotoAction = z.object({ type: z.literal('goto'), url: z.string().url() })
const TypeAction = z.object({
	type: z.literal('type'),
	selector: z.string(),
	text: z.string(),
	delay: z.number().optional(),
})
const ClickAction = z.object({ type: z.literal('click'), selector: z.string() })
const WaitForAction = z.object({
	type: z.literal('waitFor'),
	selector: z.string(),
	timeout: z.number().optional().default(5000),
})
const ScreenshotAction = z.object({ type: z.literal('screenshot') })
const ExtractAction = z.object({
	type: z.literal('extract'),
	selector: z.string().optional().default('body'),
})
const EvaluateAction = z.object({ type: z.literal('evaluate'), script: z.string() })
const GetCookiesAction = z.object({ type: z.literal('getCookies') })
const SetCookiesAction = z.object({
	type: z.literal('setCookies'),
	cookies: z.array(z.record(z.unknown())),
})
const SelectAction = z.object({
	type: z.literal('select'),
	selector: z.string(),
	value: z.string(),
})
const HoverAction = z.object({ type: z.literal('hover'), selector: z.string() })
const ScrollToAction = z.object({
	type: z.literal('scrollTo'),
	selector: z.string().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
})
const WaitAction = z.object({
	type: z.literal('wait'),
	ms: z.number().min(0).max(30000),
})

export const BrowserActionSchema = z.discriminatedUnion('type', [
	GotoAction,
	TypeAction,
	ClickAction,
	WaitForAction,
	ScreenshotAction,
	ExtractAction,
	EvaluateAction,
	GetCookiesAction,
	SetCookiesAction,
	SelectAction,
	HoverAction,
	ScrollToAction,
	WaitAction,
])

export type BrowserAction = z.infer<typeof BrowserActionSchema>

export const BrowserActionInput = z.object({
	actions: z.array(BrowserActionSchema).min(1).max(50),
	viewport: z
		.object({ width: z.number().default(1280), height: z.number().default(720) })
		.optional(),
})

export type BrowserActionInputType = z.infer<typeof BrowserActionInput>

// ---------------------------------------------------------------------------
// Secret placeholder resolution
// ---------------------------------------------------------------------------

const SECRET_PATTERN = /\{\{secret:([a-zA-Z0-9._-]+)(?:\|scope=(session|app|user))?\}\}/g

async function resolveSecrets(
	text: string,
	pageUrl: string,
	env: Env,
): Promise<{ resolved: string; secretNames: string[] }> {
	if (!text.includes('{{sec' + 'ret:')) return { resolved: text, secretNames: [] }

	const matches = Array.from(text.matchAll(SECRET_PATTERN))
	if (matches.length === 0) return { resolved: text, secretNames: [] }

	let out = text
	const secretNames: string[] = []

	for (const m of matches) {
		const secretName = m[1]
		const scope: SecretScope = (m[2] as SecretScope | undefined) ?? 'app'
		const rec = await getSecret(secretName, scope, '', env)
		if (!rec) throw new Error(`Secret not found: ${secretName} (scope: ${scope})`)

		const allowed = rec.metadata.allowed_capabilities
		if (allowed.length > 0 && !allowed.includes('browser_action')) {
			throw new Error(`Secret "${secretName}" is not allowed for capability "browser_action"`)
		}

		out = out.replaceAll(m[0], rec.value)
		secretNames.push(secretName)
	}

	return { resolved: out, secretNames }
}

// ---------------------------------------------------------------------------
// Action executor
// ---------------------------------------------------------------------------

interface ActionResult {
	action: string
	ok: boolean
	result?: unknown
	error?: string
}

export async function executeAction(
	page: Page,
	action: BrowserAction,
	env: Env,
): Promise<ActionResult> {
	try {
		switch (action.type) {
			case 'goto': {
				const response = await page.goto(action.url, { waitUntil: 'domcontentloaded' })
				return {
					action: 'goto',
					ok: true,
					result: { title: await page.title(), status: response?.status() ?? 0, url: action.url },
				}
			}
			case 'type': {
				const pageUrl = page.url()
				const { resolved, secretNames } = await resolveSecrets(action.text, pageUrl, env)
				if (secretNames.length > 0) {
					await writeAudit(env.FERMI_DB, {
						tool: 'browser_action:type_secret',
						args_hash: await hashArgs({
							secrets: secretNames,
							url: pageUrl,
							selector: action.selector,
						}),
						outcome: 'ok',
						risk: 'high',
					})
				}
				await page.type(action.selector, resolved, { delay: action.delay ?? 0 })
				return { action: 'type', ok: true, result: { typed: true, selector: action.selector } }
			}
			case 'click': {
				await page.click(action.selector)
				return { action: 'click', ok: true, result: { clicked: true, selector: action.selector } }
			}
			case 'waitFor': {
				await page.waitForSelector(action.selector, { timeout: action.timeout })
				return { action: 'waitFor', ok: true, result: { found: true, selector: action.selector } }
			}
			case 'screenshot': {
				const data = await page.screenshot({ encoding: 'base64' })
				return { action: 'screenshot', ok: true, result: { base64: String(data), format: 'png' } }
			}
			case 'extract': {
				const text = await page.$eval(
					action.selector,
					// biome-ignore lint/suspicious/noExplicitAny: DOM types unavailable in worker
					(el: any) => (el?.textContent ?? '') as string,
				)
				return {
					action: 'extract',
					ok: true,
					result: { text: text.trim(), selector: action.selector },
				}
			}
			case 'evaluate': {
				const pageUrl = page.url()
				const { resolved: resolvedScript, secretNames: evalSecrets } = await resolveSecrets(
					action.script,
					pageUrl,
					env,
				)
				if (evalSecrets.length > 0) {
					await writeAudit(env.FERMI_DB, {
						tool: 'browser_action:evaluate_secret',
						args_hash: await hashArgs({ secrets: evalSecrets, url: pageUrl }),
						outcome: 'ok',
						risk: 'high',
					})
				}
				const evalResult = await page.evaluate(resolvedScript)
				return { action: 'evaluate', ok: true, result: evalResult }
			}
			case 'getCookies': {
				const cookies = await page.cookies()
				return { action: 'getCookies', ok: true, result: { cookies } }
			}
			case 'setCookies': {
				const pageUrl = page.url()
				const resolvedCookies: CookieParam[] = []
				const cookieSecrets: string[] = []
				for (const c of action.cookies as unknown as Record<string, unknown>[]) {
					const resolved: Record<string, unknown> = { ...c }
					if (typeof c.value === 'string') {
						const { resolved: val, secretNames } = await resolveSecrets(
							c.value as string,
							pageUrl,
							env,
						)
						resolved.value = val
						cookieSecrets.push(...secretNames)
					}
					resolvedCookies.push(resolved as unknown as CookieParam)
				}
				if (cookieSecrets.length > 0) {
					await writeAudit(env.FERMI_DB, {
						tool: 'browser_action:setCookies_secret',
						args_hash: await hashArgs({ secrets: cookieSecrets, url: pageUrl }),
						outcome: 'ok',
						risk: 'high',
					})
				}
				await page.setCookie(...resolvedCookies)
				return {
					action: 'setCookies',
					ok: true,
					result: { set: true, count: resolvedCookies.length },
				}
			}
			case 'select': {
				await page.select(action.selector, action.value)
				return { action: 'select', ok: true, result: { selected: true, selector: action.selector } }
			}
			case 'hover': {
				await page.hover(action.selector)
				return { action: 'hover', ok: true, result: { hovered: true, selector: action.selector } }
			}
			case 'scrollTo': {
				if (action.selector) {
					// biome-ignore lint/suspicious/noExplicitAny: DOM types unavailable in worker
					await page.$eval(action.selector, (el: any) => el?.scrollIntoView())
				} else {
					const sx = action.x ?? 0
					const sy = action.y ?? 0
					await page.evaluate(`window.scrollTo(${sx}, ${sy})`)
				}
				return { action: 'scrollTo', ok: true, result: { scrolled: true } }
			}
			case 'wait': {
				await new Promise((r) => setTimeout(r, action.ms))
				return { action: 'wait', ok: true, result: { waited: action.ms } }
			}
			default:
				return { action: 'unknown', ok: false, error: 'Unknown action type' }
		}
	} catch (err) {
		return {
			action: action.type,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runBrowserActions(
	input: BrowserActionInputType,
	env: Env,
): Promise<{ results: ActionResult[]; totalActions: number; succeeded: number; failed: number }> {
	if (!env.MYBROWSER) {
		throw new Error(
			'Browser Rendering binding required — enable in Cloudflare dashboard under Workers > Settings > Browser Rendering.',
		)
	}

	let browser: Browser | undefined
	try {
		browser = await puppeteer.launch(env.MYBROWSER)
		const page = await browser.newPage()

		if (input.viewport) {
			await page.setViewport(input.viewport)
		}

		const results: ActionResult[] = []
		let failed = 0

		for (const action of input.actions) {
			const result = await executeAction(page, action, env)
			results.push(result)
			if (!result.ok) {
				failed++
				break
			}
		}

		return {
			results,
			totalActions: input.actions.length,
			succeeded: results.length - failed,
			failed,
		}
	} finally {
		await browser?.close()
	}
}
