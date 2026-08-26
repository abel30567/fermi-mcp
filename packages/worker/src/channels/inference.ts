import Anthropic from '@anthropic-ai/sdk'
import type {
	ContentBlock,
	MessageParam,
	Tool,
	ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.js'
import { isOverBudget, recordUsage } from '../lib/budget.ts'

export interface ChannelContext {
	channel: 'tg' | 'slack' | 'internal'
	chatId?: string
	slackChannel?: string
}

const SYSTEM_PROMPT =
	'You are Fermi, a personal AI agent. Use the available tools to help the user. Be concise.'

/**
 * Curated tool definitions exposed to the inference loop.
 * Only safe (low/med risk, non-shell) tools are included.
 */
function getToolDefinitions(): Tool[] {
	return [
		{
			name: 'memory_recall',
			description: 'Query memories by keyword. Returns matching non-decayed memories.',
			input_schema: {
				type: 'object' as const,
				properties: {
					query: { type: 'string', description: 'Search term' },
					limit: { type: 'number', description: 'Max results (default 10)' },
				},
				required: ['query'],
			},
		},
		{
			name: 'memory_write',
			description: 'Store a new memory.',
			input_schema: {
				type: 'object' as const,
				properties: {
					kind: { type: 'string', enum: ['fact', 'preference', 'event'] },
					body: { type: 'string', description: 'The memory content' },
					pinned: { type: 'boolean', description: 'Pin to prevent decay' },
				},
				required: ['kind', 'body'],
			},
		},
		{
			name: 'search',
			description: 'Search across memory and documents.',
			input_schema: {
				type: 'object' as const,
				properties: {
					query: { type: 'string', description: 'Search query' },
					limit: { type: 'number', description: 'Max results (default 10)' },
				},
				required: ['query'],
			},
		},
		{
			name: 'fs_read',
			description: 'Read a file from storage by path.',
			input_schema: {
				type: 'object' as const,
				properties: {
					path: { type: 'string', description: 'R2 object key' },
				},
				required: ['path'],
			},
		},
		{
			name: 'fs_list',
			description: 'List files in storage by prefix.',
			input_schema: {
				type: 'object' as const,
				properties: {
					prefix: { type: 'string', description: 'R2 key prefix' },
				},
				required: [],
			},
		},
	]
}

/**
 * Execute a tool by name against environment bindings directly,
 * bypassing the MCP server registration.
 */
async function executeToolByName(
	name: string,
	input: Record<string, unknown>,
	env: Env,
): Promise<string> {
	switch (name) {
		case 'memory_recall': {
			const query = String(input.query ?? '')
			const limit = Number(input.limit ?? 10)
			const rows = await env.FERMI_DB.prepare(
				`SELECT id, kind, body, pinned, created_at
				 FROM memory
				 WHERE body LIKE '%' || ?1 || '%' AND decayed_at IS NULL
				 ORDER BY pinned DESC, created_at DESC
				 LIMIT ?2`,
			)
				.bind(query, limit)
				.all()
			return JSON.stringify({ query, results: rows.results, total: rows.results.length })
		}

		case 'memory_write': {
			const kind = String(input.kind ?? 'fact')
			const body = String(input.body ?? '')
			const pinned = Boolean(input.pinned)
			const now = Date.now()
			const res = await env.FERMI_DB.prepare(
				'INSERT INTO memory (kind, body, created_at, pinned) VALUES (?1, ?2, ?3, ?4)',
			)
				.bind(kind, body, now, pinned ? 1 : 0)
				.run()
			return JSON.stringify({ id: res.meta.last_row_id, kind, body, pinned, created_at: now })
		}

		case 'search': {
			const query = String(input.query ?? '')
			const limit = Number(input.limit ?? 10)
			const rows = await env.FERMI_DB.prepare(
				`SELECT id, kind, body, created_at
				 FROM memory
				 WHERE body LIKE '%' || ?1 || '%' AND decayed_at IS NULL
				 ORDER BY created_at DESC
				 LIMIT ?2`,
			)
				.bind(query, limit)
				.all()
			return JSON.stringify({ query, results: rows.results, total: rows.results.length })
		}

		case 'fs_read': {
			const path = String(input.path ?? '')
			const obj = await env.FERMI_BUCKET.get(path)
			if (!obj) return JSON.stringify({ error: 'Not found', path })
			const text = await obj.text()
			return JSON.stringify({ path, size: obj.size, body: text })
		}

		case 'fs_list': {
			const prefix = String(input.prefix ?? '')
			const list = await env.FERMI_BUCKET.list({ prefix })
			const objects = list.objects.map((o) => ({
				key: o.key,
				size: o.size,
				uploaded: o.uploaded.toISOString(),
			}))
			return JSON.stringify({ prefix, objects, total: objects.length })
		}

		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` })
	}
}

/**
 * Run a full agent turn using the Anthropic Messages API with tool use.
 * Falls back to Workers AI when over budget.
 */
export async function runAgentTurn(
	message: string,
	env: Env,
	_channel: ChannelContext,
): Promise<string> {
	// Budget check — fallback to Workers AI if over budget
	if (await isOverBudget(env.FERMI_KV)) {
		return runWorkersFallback(message, env)
	}

	const apiKey = env.ANTHROPIC_API_KEY
	if (!apiKey) {
		return runWorkersFallback(message, env)
	}

	const client = new Anthropic({ apiKey })
	const tools = getToolDefinitions()
	const messages: MessageParam[] = [{ role: 'user', content: message }]

	const MAX_TURNS = 8

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 4096,
			system: SYSTEM_PROMPT,
			tools,
			messages,
		})

		// Track usage
		await recordUsage(env.FERMI_KV, response.usage.input_tokens, response.usage.output_tokens)

		if (response.stop_reason === 'end_turn') {
			return extractText(response.content)
		}

		if (response.stop_reason === 'tool_use') {
			const toolResults: ToolResultBlockParam[] = []
			for (const block of response.content) {
				if (block.type === 'tool_use') {
					const result = await executeToolByName(
						block.name,
						block.input as Record<string, unknown>,
						env,
					)
					toolResults.push({
						type: 'tool_result',
						tool_use_id: block.id,
						content: result,
					})
				}
			}
			messages.push({ role: 'assistant', content: response.content })
			messages.push({ role: 'user', content: toolResults })
		} else {
			// max_tokens or other stop reason
			return extractText(response.content)
		}
	}

	return 'Max tool turns reached. Please try a simpler request.'
}

function extractText(content: ContentBlock[]): string {
	return (
		content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('\n') || 'No response generated.'
	)
}

/**
 * Fallback inference using Workers AI (Llama 3.1 8B).
 * Used when over budget or Anthropic key is missing.
 */
async function runWorkersFallback(message: string, env: Env): Promise<string> {
	try {
		const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: message },
			],
		})
		if (result && typeof result === 'object' && 'response' in result) {
			return `[Fallback model] ${result.response}`
		}
		return '[Fallback model] Unable to generate response.'
	} catch {
		return '[Fallback model] Workers AI unavailable.'
	}
}
