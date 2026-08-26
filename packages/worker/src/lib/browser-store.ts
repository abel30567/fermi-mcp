import puppeteer, { type Browser } from '@cloudflare/puppeteer'

async function getBrowser(env: Env): Promise<Browser> {
	if (!env.MYBROWSER) {
		throw new Error(
			'Browser Rendering binding required — enable in Cloudflare dashboard under Workers > Settings > Browser Rendering.',
		)
	}
	return puppeteer.launch(env.MYBROWSER)
}

export async function navigate(
	url: string,
	env: Env,
): Promise<{ title: string; status: number; url: string }> {
	let browser: Browser | undefined
	try {
		browser = await getBrowser(env)
		const page = await browser.newPage()
		const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
		return { title: await page.title(), status: response?.status() ?? 0, url }
	} finally {
		await browser?.close()
	}
}

export async function screenshot(
	url: string,
	env: Env,
): Promise<{ url: string; screenshot_base64: string; format: 'png' }> {
	let browser: Browser | undefined
	try {
		browser = await getBrowser(env)
		const page = await browser.newPage()
		await page.goto(url, { waitUntil: 'domcontentloaded' })
		const data = await page.screenshot({ encoding: 'base64' })
		return { url, screenshot_base64: String(data), format: 'png' }
	} finally {
		await browser?.close()
	}
}

export async function extractText(
	url: string,
	selector: string | undefined,
	env: Env,
): Promise<{ url: string; selector: string; text: string }> {
	let browser: Browser | undefined
	try {
		browser = await getBrowser(env)
		const page = await browser.newPage()
		await page.goto(url, { waitUntil: 'domcontentloaded' })
		const sel = selector ?? 'body'
		const text = await page.$eval(
			sel,
			// biome-ignore lint/suspicious/noExplicitAny: DOM types unavailable in worker
			(el: any) => (el?.textContent ?? '') as string,
		)
		return { url, selector: sel, text: text.trim() }
	} finally {
		await browser?.close()
	}
}
