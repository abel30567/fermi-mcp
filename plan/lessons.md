# Fermi - Lessons Learned

## Tool Naming Convention
- **MCP tool names must match `^[a-zA-Z0-9_-]{1,64}$`** — no dots allowed
- Claude.ai connector rejects tools with dots in names (e.g., `memory.recall`)
- Use underscores: `memory_recall`, `memory_write`, `session_search`
- This applies to all future tools — never use dot notation

## Claude.ai Connector
- After deploying new/renamed tools, the connector tool list needs manual refresh
- User must go to Customize > Connectors > Fermi > 3 dots > refresh tools
- "Always allow" must be re-set after tool list changes
- Claude.ai uses `/sse` (legacy SSE transport), not `/mcp` (streamable-http)

## Cloudflare Setup
- R2 must be manually enabled in the Cloudflare dashboard before `wrangler r2 bucket create` works
- AI binding requires remote connection — `wrangler dev --local` skips AI calls
- D1 migrations: always run both `migrate:local` and `migrate:remote`
