import { callRemoteTool } from '../mcp/tools/macos-bridge.ts'

/**
 * Push half of the daemon's push/poll: nudge the Mac (via the macOS MCP
 * bridge) to run poll.sh immediately instead of waiting for the next 60s
 * poll. Best-effort — any failure is swallowed and the poll picks up the
 * task on its normal cadence.
 */
export async function wakeMacDaemon(env: Env): Promise<void> {
	if (!env.MACOS_MCP_URL || !env.MACOS_MCP_TOKEN) return
	try {
		await callRemoteTool(env, 'mac_shell', {
			command: 'nohup "$HOME/fermi-daemon/poll.sh" >/dev/null 2>&1 &',
			timeout_ms: 8000,
		})
	} catch {
		// Bridge offline — the 60s poll is the fallback
	}
}
