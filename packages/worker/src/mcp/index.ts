import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { registerAllCapabilities } from '../capabilities/index.ts'
import { createSession, logMessage } from '../lib/session.ts'
import { registerTools } from './register-tools.ts'

type State = { sessionId?: string; mode?: 'chat' | 'plan' | 'execute' }
type Props = { baseUrl: string; knowledge?: KnowledgeScope }
export type KnowledgeScope = { tokenId: string; namespace: string }

export { BOX_ALLOWED_TOOLS } from '../lib/box-scope.ts'

export class FermiMCP extends McpAgent<Env, State, Props> {
	principal: 'owner' | 'box' | 'knowledge' = 'owner'
	boxId: string | null = null
	knowledge: KnowledgeScope | null = null
	server = new McpServer(
		{ name: 'fermi', version: '0.1.0' },
		{
			instructions:
				'Fermi is your personal MCP agent with cross-host memory, loadable skills, permissions, and plan-mode orchestration. ' +
				'Resolution order for procedural knowledge: call skill_search first, skill_load the best match, and fall back to ' +
				'memory_recall only when no skill matches. Before any multi-step external workflow (GitHub, browser auth, TOTP, ' +
				'Shopify, AWS), check for a skill. When a procedure has been reconstructed from memories twice, promote it with ' +
				'skill_set and origin_memory_id.',
		},
	)

	get bindings(): Env {
		return this.env
	}

	waitUntil(promise: Promise<unknown>): void {
		this.ctx.waitUntil(promise)
	}

	async init() {
		const host = this.props?.baseUrl ?? 'mcp'
		this.principal = host.startsWith('box:') ? 'box' : host.startsWith('k:') ? 'knowledge' : 'owner'
		this.knowledge = this.principal === 'knowledge' ? (this.props?.knowledge ?? null) : null
		if (this.principal === 'knowledge' && !this.knowledge)
			throw new Error('knowledge_scope_missing')
		this.boxId = this.principal === 'box' ? host.slice(4) || null : null
		const sessionId = await createSession(this.env.FERMI_DB, host)
		this.setState({ ...this.state, sessionId })
		registerAllCapabilities()
		await registerTools(this)
	}

	/**
	 * The host this session was opened for (`k:<token_id>`, `box:<id>`, ...); /k/mcp binds
	 * sessions with it. Read from storage so it neither initializes an unknown id nor
	 * misses the props of an evicted session.
	 */
	async sessionHost(): Promise<string | null> {
		const props = await this.ctx.storage.get<Props>('props')
		return props?.baseUrl ?? null
	}
}

export function withSessionLogging<T, R>(
	agent: FermiMCP,
	handler: (args: T) => Promise<R>,
): (args: T) => Promise<R> {
	return async (args: T) => {
		const sessionId = agent.state?.sessionId
		const db = agent.bindings.FERMI_DB
		if (sessionId) {
			await logMessage(db, sessionId, 'user', JSON.stringify(args))
		}
		const result = await handler(args)
		if (sessionId) {
			await logMessage(db, sessionId, 'assistant', JSON.stringify(result))
		}
		return result
	}
}
