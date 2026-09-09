# The Worker (Fermi MCP)

**Status:** the core; every other component is optional. One Cloudflare Worker, one Durable-Object agent, ~60 MCP tools.

The full, source-anchored description lives in [`docs/ARCHITECTURE.md`](https://github.com/abel30567/fermi-mcp/blob/master/docs/ARCHITECTURE.md) in the repo. This page is the runtime model you need to understand the other components.

## Who owns what

- **`FermiMCP` (Durable Object)** owns the MCP session — tool registration, the guardrail pipeline (plan-mode check → approval gate for `risk: high` → deny-hooks → execute + audit).
- **D1** owns memory, messages (+FTS), skills metadata, secrets metadata, audit, hooks, tasks, fleet state, web-session metadata.
- **R2** owns SKILL.md bodies, files, `/apps/*` static hosting, artifacts.
- **KV** owns runtime config (`fleet:config`), approval tokens, allowlists.
- **The task queue (D1 `tasks`)** is the spine connecting everything: channels enqueue, daemons and boxes claim, `task_wait` lets an orchestrator await completion. Queues are namespaced strings; `agent:<id>` and `broker:ops` are fleet-owned and **off-limits to the channel drain** (`isFleetQueue`, `lib/task-store.ts`) — a lesson paid for in production, see [the task-theft incident](/blog/03-task-theft).

## Tool surface

Tool families registered in `src/mcp/register-tools.ts`: memory, skills, search, secrets, tasks, schedules, channels, allowlist, conversations, profile, retrievers, packages, connectors, OAuth, TOTP, filesystem, hooks, plan mode, meta, cloud browser + persistent browser sessions, web sessions, **cloud agents**, and (when `MACOS_MCP_URL` is set) the 25 `mac_*` bridge tools.

Every tool declares `scope`, `risk`, `mutates`, and runs through the same pipeline. `execute` gives hosts a JS sandbox whose only egress is a gateway that expands <code v-pre>{{secret:NAME}}</code> against per-secret host allowlists.

## HTTP surface (beyond `/mcp`)

| Route family | Auth | Purpose |
|--------------|------|---------|
| `/mcp`, `/sse` | OAuth (when enabled) | MCP transports |
| `/tg`, `/slack`, `/dc`, `/wa` webhooks | platform secrets | channels |
| `/admin/*` | `FERMI_BEARER_TOKEN` | fleet launch/status/pin, broker claim/complete, session capture/state, pending tasks |
| `/box/*` | per-box token `<box_id>.<secret>` | the neutrino gateway: poll, heartbeat, artifact, complete, report, session-lease, browser-rpc, inference-auth |
| `/apps/*` | OAuth-gated | static hosting from R2 |

## Cron

Four maintenance jobs (consolidation, daily brief, skill distillation, capability reindex) plus the **fleet reaper** every 5 minutes: TTL-expired boxes get EC2-terminated — and are only marked `destroyed` after EC2 confirms termination, so a box that survives an API hiccup is retried rather than orphaned.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Tools missing on a host | `/mcp` vs `/sse`; auth mode; `MACOS_MCP_URL` for `mac_*` |
| Channel silent | webhook registered? `ANTHROPIC_API_KEY` set? sender allowlisted? |
| `fleet_queue_off_limits` from `task_claim` | working as intended — that queue belongs to a box |
