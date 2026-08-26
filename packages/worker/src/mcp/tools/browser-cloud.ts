import { z } from 'zod'
import { BrowserActionSchema, runBrowserActions } from '../../lib/browser-actions.ts'
import { extractText, navigate, screenshot } from '../../lib/browser-store.ts'
import { defineTool } from '../../lib/tool.ts'
import type { FermiMCP } from '../index.ts'

export function registerBrowserCloudTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'browser_navigate',
		description: 'Navigate to a URL in a cloud browser and return the page title and status',
		schema: { url: z.string().url().describe('The URL to navigate to') },
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => ({
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(await navigate(args.url, env), null, 2),
				},
			],
		}),
	})

	defineTool(agent, {
		name: 'browser_screenshot',
		description: 'Take a screenshot of a URL in a cloud browser',
		schema: { url: z.string().url().describe('The URL to screenshot') },
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => ({
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(await screenshot(args.url, env), null, 2),
				},
			],
		}),
	})

	defineTool(agent, {
		name: 'browser_extract',
		description: 'Extract text content from a URL, optionally filtered by CSS selector',
		schema: {
			url: z.string().url().describe('The URL to extract content from'),
			selector: z.string().optional().describe('Optional CSS selector to extract specific content'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'low',
		mutates: false,
		handler: async (args, env) => ({
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(await extractText(args.url, args.selector, env), null, 2),
				},
			],
		}),
	})

	defineTool(agent, {
		name: 'browser_action',
		description:
			'Execute a sequence of browser actions within a single Puppeteer session. Actions: goto, type, click, waitFor, screenshot, extract, evaluate, getCookies, setCookies, select, hover, scrollTo, wait. Supports secret placeholder resolution in type.text fields. Use for form filling, authenticated scraping, and multi-step browser automation. All actions run sequentially; stops on first error and returns results so far.',
		schema: {
			actions: z
				.array(BrowserActionSchema)
				.min(1)
				.max(50)
				.describe('Ordered list of browser actions to execute sequentially'),
			viewport: z
				.object({
					width: z.number().default(1280).describe('Viewport width in pixels'),
					height: z.number().default(720).describe('Viewport height in pixels'),
				})
				.optional()
				.describe('Optional viewport size override'),
		},
		scope: ['network', 'browser:cloud'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const result = await runBrowserActions(
				{ actions: args.actions, viewport: args.viewport },
				env,
			)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify(result, null, 2),
					},
				],
			}
		},
	})
}
