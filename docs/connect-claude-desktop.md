# Connect Fermi to Claude Desktop

## Local Development

1. Start the local dev server:
   ```bash
   bun run dev
   ```

2. Add this to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "fermi": {
         "url": "http://localhost:8787/mcp"
       }
     }
   }
   ```

3. Restart Claude Desktop. Fermi tools (`search`, `execute`, `open_generated_ui`) should appear.

## Remote (Deployed Worker)

1. Deploy the worker:
   ```bash
   bun run --cwd packages/worker deploy
   ```

2. Set your bearer token secret:
   ```bash
   wrangler secret put FERMI_BEARER_TOKEN --config packages/worker/wrangler.jsonc
   ```

3. Add this to your Claude Desktop MCP config:
   ```json
   {
     "mcpServers": {
       "fermi": {
         "url": "https://fermi.<your-subdomain>.workers.dev/mcp",
         "headers": {
           "Authorization": "Bearer <your-token>"
         }
       }
     }
   }
   ```

4. Restart Claude Desktop.

## Verify Connection

Once connected, ask Claude to use the `search` tool:

> Search for "hello" using the fermi search tool

You should see a mock result returned, confirming the MCP connection works end-to-end.
