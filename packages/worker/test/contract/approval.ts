import { type McpClient, type ToolResult, resultJson } from './mcp-client.ts'

/** Call a high-risk tool through its approval gate: mint a token, then re-invoke with it. */
export async function callApproved(
	client: McpClient,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const pending = resultJson<{ status?: string; token?: string }>(await client.callTool(name, args))
	if (pending.status !== 'pending_approval' || !pending.token) {
		throw new Error(`${name}: expected pending_approval, got ${JSON.stringify(pending)}`)
	}
	return client.callTool(name, { ...args, approval_token: pending.token })
}
