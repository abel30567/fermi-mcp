# MCP Server

- **index.ts** — FermiMCP Durable Object extending McpAgent. Handles MCP protocol lifecycle, session management, and tool dispatch.
- **register-tools.ts** — Wires all 30+ tools from the tools/ directory into the MCP server. Each tool is registered with metadata (description, input schema, scope, risk level).

## Tool Registration Pattern

Tools are defined using `defineTool()` from `lib/tool.ts` which wraps each tool with:
1. Scope declaration (shell, fs, network, memory, etc.)
2. Risk level (low, high)
3. Automatic audit logging to D1
4. Approval gate for high-risk tools (returns token on first call, executes on second)
