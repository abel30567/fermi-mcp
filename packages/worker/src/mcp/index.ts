import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { registerAllCapabilities } from '../capabilities/index.ts'
import { createSession, logMessage } from '../lib/session.ts'
import { registerTools } from './register-tools.ts'

type State = { sessionId?: string; mode?: 'chat' | 'plan' | 'execute' }
type Props = { baseUrl: string }

export class FermiMCP extends McpAgent<Env, State, Props> {
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

	async init() {
		const host = this.props?.baseUrl ?? 'mcp'
		const sessionId = await createSession(this.env.FERMI_DB, host)
		this.setState({ ...this.state, sessionId })
		registerAllCapabilities()
		await registerTools(this)
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
