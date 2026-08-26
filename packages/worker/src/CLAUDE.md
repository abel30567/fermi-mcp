# Source Root

- **index.ts** — Request router: dispatches to /mcp, /sse, /tg/webhook, /slack/events, /apps/*, /oauth/*. Also handles scheduled() for cron triggers.
- **markdown.d.ts** — TypeScript module declaration for importing .md files as strings (used by skills layer)

## Subdirectories

- **mcp/** — FermiMCP Durable Object and tool registration
- **capabilities/** — Higher-level tool definitions (skills, meta)
- **lib/** — Shared stores, utilities, crypto
- **orchestration/** — Plan mode, team spawn, hooks
- **sandbox/** — JavaScript executor with approval gate
- **channels/** — Telegram, Slack webhook handlers + inference loop
- **cron/** — Scheduled jobs: consolidation, daily brief, skill distillation, capability reindex
- **do/** — Durable Object implementations: LiveCanvas, BrowserSession
- **seeds/** — Built-in skill seeding on first deploy
