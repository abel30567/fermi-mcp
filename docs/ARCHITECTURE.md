# Fermi — Architecture

> This document describes what the code in this repository actually does. Where a
> behaviour is partial, manual, or best-effort, it says so. File references point at
> the implementation so claims can be checked against source.

## Overview

Fermi is a single [MCP](https://modelcontextprotocol.io) server that runs on
Cloudflare Workers. It exposes one tool surface, one memory store, and one
permission model to every connected host — Claude.ai, Claude Desktop, Claude Code,
Cursor, ChatGPT — and, for unattended channels (Telegram, Slack), runs its own
inference loop against the Anthropic API.

The repository is a Bun monorepo:

```
packages/
  shared/   # shared TypeScript types
  worker/   # the Cloudflare Worker — all runtime code
    src/
      index.ts            # HTTP router, OAuth gate, cron dispatch, DO exports
      mcp/                # MCP tool registration (host-facing surface)
      capabilities/       # sandbox capability registry (codemode surface)
      orchestration/      # hooks, plan mode, team_spawn
      channels/           # telegram, slack, anthropic inference loop
      cron/               # scheduled jobs
      do/                 # Durable Objects
      lib/                # stores, crypto, search fusion, audit, embeddings
      sandbox/            # execute() runtime + outbound fetch gateway
      seeds/              # committed seed skills
```

There are two distinct tool surfaces. Keeping them straight is the key to reading
the rest of this document:

| Surface | Who calls it | Where it's defined | Count |
|---------|--------------|--------------------|-------|
| **MCP tools** | Connected hosts and channels | `src/mcp/**`, `src/orchestration/**` | ~60 by default, ~85 with the macOS bridge enabled |
| **Sandbox capabilities** | Code passed to the `execute` tool, as `codemode.<name>(...)` | `src/capabilities/**` | 39 (see `meta_list_capabilities`) |

They overlap but are not identical. For example `fetch_url` is a sandbox capability
with no MCP tool of its own; `execute` is an MCP tool that is not itself a sandbox
capability; the macOS `mac_*` tools are MCP-only.

---

## System map

```
 MCP Hosts                       Channels                Scheduled (cron)
 ─────────                       ────────                ────────────────
 Claude.ai / Desktop / Code      Telegram                03:00  consolidation
 Cursor / ChatGPT                Slack                   08:00  daily brief
       │                            │                    Sun 02:00 skill distill
       │ /mcp  /sse                 │ /tg  /slack         */6h   capability reindex
       └──────────────┬─────────────┘                         │
                      ▼                                        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                        Cloudflare Worker (src/index.ts)               │
  │                                                                      │
  │  Auth gate:  FERMI_AUTH_ENABLED=true → OAuthProvider wraps /mcp,/sse  │
  │              otherwise  → open (no transport auth)                    │
  │                                                                      │
  │  Routes: /mcp /sse  /oauth/* /apps/*  /tg/webhook /slack/events       │
  │          /canvas/:id  /health  /capabilities (admin, Bearer)          │
  │                                                                      │
  │  Durable Objects:                                                     │
  │    FermiMCP (MCP_OBJECT)         the agent; SQLite-backed             │
  │    LiveCanvasDO (CANVAS_DO)      WebSocket canvas state               │
  │    SandboxStorageDO              per-session execute() storage        │
  │    BrowserSessionDO              persistent cloud browser sessions    │
  └──────────────────────────────────────────────────────────────────────┘
       │          │          │          │            │            │
       ▼          ▼          ▼          ▼            ▼            ▼
      D1         R2         KV       Workers AI   Vectorize   GATEWAY (self)
   memory,    SKILL.md,  config,   embeddings    capability   CodemodeFetch-
   sessions,  fs files,  approval  (bge-small)   + skill      Gateway: outbound
   messages,  apps,      tokens,   + Llama 3.1   vectors      fetch for execute,
   audit,     seeds      team caps  summaries                 secret injection
   hooks,     (R2)       (KV)      / channel
   oauth,                          inference
   skills meta
```

Bindings are declared in `packages/worker/wrangler.template.jsonc`. `GATEWAY` is a
service binding the Worker holds to *itself* (entrypoint `CodemodeFetchGateway`), so
sandboxed code never gets a raw `fetch`.

---

## Request entry points (`src/index.ts`)

The default export branches on `FERMI_AUTH_ENABLED`:

- **`!== "true"`** — requests go straight to `defaultHandler`. `/mcp` and `/sse` are
  served with **no transport authentication**. This is the local-dev / trusted-network
  default.
- **`=== "true"`** — requests go through `@cloudflare/workers-oauth-provider`, which
  gates `/mcp` and `/sse` behind an OAuth flow. The consent screen
  (`src/lib/oauth-handlers.ts`) validates `FERMI_OWNER_SECRET` and, if configured, a
  TOTP code.

Other routes (handled in both modes):

| Route | Purpose |
|-------|---------|
| `/mcp` | MCP streamable-HTTP transport |
| `/sse` | Legacy MCP SSE transport |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register` | OAuth provider endpoints (auth mode) |
| `/oauth/start`, `/oauth/callback` | Outbound OAuth to third parties (connector auth) |
| `/apps/*`, `/apps/_login`, `/apps/_logout` | OAuth-gated static hosting from R2 |
| `/tg/webhook`, `/slack/events` | Channel webhooks |
| `/canvas/:id` | Forwarded to `LiveCanvasDO` (WebSocket upgrade) |
| `/health`, `/` | Liveness |
| `/capabilities`, `/cron/capability-reindex`, `/admin/seed-skills` | Admin; require `Authorization: Bearer ${FERMI_BEARER_TOKEN}` |

---

## Permission model (`src/lib/tool.ts`)

Every MCP tool is registered through `defineTool`, which wraps the handler in
`runWithGuardrails`. Each tool declares three things:

- `scope[]` — e.g. `read`, `write:memory`, `network`, `shell`, `browser:cloud`, `browser:local`
- `risk` — `low` | `med` | `high`
- `mutates` — whether it changes state

The guardrail pipeline, in order:

```
  Tool call
      │
      ▼
  1. PLAN-MODE CHECK
     If agent mode == "plan" and tool mutates and tool is not
     {plan_draft, plan_approve, session_set_mode}  → denied (plan_mode_restricted)
      │
      ▼
  2. APPROVAL GATE  (only when risk == "high")
     No token  → mint UUID token, store {tool, args_hash} in KV (TTL 300s),
                 audit "pending", return pending_approval to the caller
     Token     → must still exist in KV → delete it (single use) → continue
                 (existence is checked; the stored args_hash is not re-compared)
      │
      ▼
  3. PRE-HOOKS  ("tool:before")
     Matching enabled hooks evaluated; if any has trust_level "deny" → blocked_by_hook
      │
      ▼
  4. EXECUTE + AUDIT
     Handler runs. Result audited to D1 (tool, args_hash, outcome, risk,
     duration_ms, result_bytes, session_id). "tool:after" hooks fire best-effort.
```

Notes on the real behaviour:

- The approval gate keys on **token presence**, not on the arguments matching the
  ones that produced the token. The `args_hash` is stored for audit, not re-verified
  on redemption.
- `execute` additionally screens its code through a shell blocklist
  (`src/lib/shell-blocklist.ts`) before anything runs.
- Audit rows are the substrate for `usage_stats`, which aggregates call counts,
  success/denied breakdown, payload sizes, and durations.

### Hooks (`src/orchestration/hooks.ts`)

Hooks are rows in D1, matched by a glob against the tool name. `executeHooks` walks
the enabled hooks for an event and computes a decision with **`deny > ask > allow`**
precedence.

What is and isn't wired up today:

- Only the **`tool:before`** and **`tool:after`** events are invoked by the tool
  pipeline. The schema accepts a wider event set (`session:*`, `plan:*`, `memory:*`,
  `skill:loaded`, `team:*`), but those are not yet dispatched from their call sites.
- At enforcement time **only `deny` blocks** a call. `ask` is computed but there is
  no interactive approval path that consumes it.
- The `command` field is **stored but not executed** — hooks are declarative
  deny-gates, not shell-runners.
- `once` hooks disable themselves after firing.

`hooks_test` is a dry-run that reports which hooks would fire and the resulting
decision.

---

## Memory and the skill lifecycle

This is the part most worth describing precisely, because it is easy to oversell.

### What exists

**Memory** (`memory_*` tools, D1 `memory` table). Free-text entries with a `kind`,
an optional `pinned` flag, an embedding, and a soft-delete (`decayed_at`). Recall is
keyword-based.

**Skills** (`skill_*` tools; SKILL.md bodies in R2, metadata in D1). A skill carries
`version`, `source`, `origin_memory_id`, `usage_count`, `keywords`, and
`allowed_tools`. `skill_load` returns the SKILL.md body and bumps usage telemetry.
Five skills are committed as seeds (`src/seeds/index.ts`): `github-api`,
`totp-oauth`, `browser-auth-spa`, `aws-cdk-discipline`, `shopify-admin`. They load
idempotently via `POST /admin/seed-skills`.

### How knowledge moves from memory to skill

```
   memory_write(...)                    a fact / correction is captured
        │
        │  (a) MANUAL promotion
        ▼
   skill_set({ origin_memory_id })      author writes a SKILL.md; metadata
                                        records source = promoted_from_memory
        │
        │  (b) ASSISTED proposal — weekly cron
        ▼
   skill-distillation (Sun 02:00)       if ≥3 recently-summarized sessions,
                                        Llama 3.1-8B reads the session SUMMARIES
                                        and proposes reusable skills; ONE draft
                                        skill is written (source = "hermes")
                                        for a human to review and refine
        │
        ▼
   skill_load(slug)                     mature skill returned as a deterministic
                                        SKILL.md; usage_count incremented
```

### What does *not* exist (and the docs used to imply it did)

There is **no automatic trust ladder** — no `NEW → SUPERVISED → AUTONOMOUS`
progression, no automatic promotion on a clean execution streak, and no automatic
demotion when a procedure is corrected. The distillation cron does not cluster
related memories; it summarizes recent *sessions* and emits a single draft skill.

The system's "less neural as procedures mature" property is real but emergent, not a
state machine. It comes from three concrete mechanisms:

1. `skill_search` is the documented first stop for procedural questions, ahead of
   `memory_recall`.
2. In unified search, skills receive a **1.25× post-fusion boost** so a matching
   skill outranks raw memories (`src/mcp/tools/search.ts`).
3. A loaded SKILL.md contains the steps inline, so the model spends fewer tokens
   re-deriving a procedure it has already crystallized.

---

## Unified search (`src/mcp/tools/search.ts`, `src/lib/rrf.ts`)

The `search` tool has two modes:

- **Entity lookup** — `entity="<id>:<type>"` returns one fully-detailed record.
- **Ranked search** — `query=...` fans out across candidate builders in parallel,
  then fuses them.

Candidate sources and how each is actually queried:

| Source | Method |
|--------|--------|
| Capabilities (name) | exact/prefix name match |
| Capabilities (text) | D1 FTS index over the capability registry |
| Capabilities (semantic) | Vectorize |
| Skills (text) | skills store search |
| Skills (semantic) | Vectorize |
| Memories | **SQL `LIKE` substring** (not FTS) |
| Messages | D1 **FTS5** (`messages_fts`) |
| Secrets / connectors / packages | name match |

All lists are merged with **Reciprocal Rank Fusion**, `score = Σ 1/(k + rank)` with
`k = 60`. Skills then get the 1.25× boost described above. The result includes
`telemetry.candidateCounts`, `warnings`, and an `offline` flag.

Embeddings (`src/lib/embeddings.ts`) use Workers AI `@cf/baai/bge-small-en-v1.5`
(384-dim). If Workers AI is unavailable, `embedText` returns a deterministic FNV-1a
hash vector and sets `offline: true` — searches still run, but the vector lane is
non-semantic and flags itself rather than failing.

---

## Code mode: the `execute` tool (`src/mcp/tools/execute.ts`, `src/sandbox/`)

`execute` runs JavaScript in an isolated Worker (the `LOADER` worker-loader binding).
Inside that sandbox the capability registry is reachable as `codemode.<name>(args)` —
so multi-step work can be expressed as a small program instead of a chain of
individual tool round-trips.

- `execute` is **`risk: high`**, so it is approval-gated like any high-risk tool.
- Code is screened against the shell blocklist before running.
- The sandbox has **no raw `fetch`**. Outbound HTTP goes through the `GATEWAY`
  service (`CodemodeFetchGateway`), which expands `{{secret:NAME}}` placeholders and
  enforces each secret's `allowed_hosts`.
- Per-session scratch state lives in `SandboxStorageDO`.

The capability set the sandbox sees (39 entries) is enumerable at runtime via the
`meta_list_capabilities` MCP tool. Each entry advertises its `scope`, `risk`,
`readOnly`, `idempotent`, and `destructive` flags.

---

## Secrets (`src/mcp/tools/secrets.ts`, `src/lib/secrets-store.ts`)

Secrets are encrypted at rest (key: `FERMI_SECRETS_KEY`). Metadata listing never
returns plaintext. Each secret carries allow-lists: `allowed_hosts`,
`allowed_capabilities`, `allowed_packages`.

Two ways a secret reaches a request:

1. **Gateway injection** — `{{secret:NAME}}` placeholders in `fetch_url` (and in
   browser `type`/cookie actions) are expanded by the gateway. The model never sees
   the plaintext, and the target host must be on `allowed_hosts`.
2. **`secret_resolve`** — for in-sandbox crypto (SRP, HMAC, JWT signing) the
   decrypted value can be pulled into the sandbox, but **only** if the secret lists
   `secret_resolve` in its `allowed_capabilities`. Rate-limited to 10 calls/min per
   session; every call is audited.

`secret_set`, `secret_delete`, and `secret_approve_host` are `risk: high` and
approval-gated.

---

## Browser automation — two lanes

### Cloud lane (`src/mcp/tools/browser-cloud.ts`, `browser-session.ts`)

Backed by Cloudflare Browser Rendering (`MYBROWSER`, Puppeteer).

- One-shot: `browser_navigate`, `browser_screenshot`, `browser_extract`.
- Scripted: `browser_action` runs a sequence (goto/type/click/waitFor/screenshot/
  extract/evaluate/getCookies/setCookies/select/hover/scrollTo/wait) in one session,
  stopping on first error. Supports secret placeholders in `type.text`.
- Persistent: `browser_session_launch/action/close/list`, plus
  `browser_session_request_human` and `browser_session_resume` for
  human-in-the-loop (captcha, login). State lives in `BrowserSessionDO`; launch
  returns a `live_view_url`.

### Local lane — macOS bridge (`src/mcp/tools/macos-bridge.ts`)

A separate MCP server running on a Mac, reached over a Cloudflare Tunnel. The Worker
proxies to it via `MACOS_MCP_URL` + `MACOS_MCP_TOKEN`.

- These 25 `mac_*` tools are **registered only if `MACOS_MCP_URL` is set**. With no
  Mac configured, they simply don't appear.
- The bridge handles the MCP handshake (initialize + session id, cached) and forwards
  `tools/call`. If the Mac is unreachable, tools return `{error: "agent_offline"}`
  rather than throwing.
- Tools cover: shell / AppleScript / JXA, file ops, a real (non-headless) Chrome with
  stealth, screenshot + Vision-framework OCR, clipboard, native keystroke/click, app
  control, and notifications. The shell/script/input tools are `risk: high`.

The point of the local lane is a **real hardware fingerprint and residential
network** for sites that block datacentre browsers — something the cloud lane can't
provide.

---

## Channels and subagents

**Telegram / Slack** (`src/channels/`). Webhooks land at `/tg/webhook` and
`/slack/events`. Because no host is driving inference, these channels run their own
loop, `runAgentTurn` (`src/channels/inference.ts`), against the Anthropic API
(`ANTHROPIC_API_KEY`).

**`team_spawn`** (`src/orchestration/team-spawn.ts`). Spawns a subagent that runs the
same `runAgentTurn` loop with a role-specific system prompt
(`researcher`/`writer`/`verifier`/`planner`/`executor`). Honest scope:

- The role changes the **system prompt only**.
- `allowed_tools` is accepted in the schema but is **not currently passed through** to
  the subagent, so it does not restrict the subagent's tools.
- Concurrency is capped (default 3, `team:max_concurrent` in KV); spawns are recorded
  in the `team_spawns` table with their final report.

---

## Plan mode (`src/orchestration/plan-mode.ts`, enforced in `tool.ts`)

`session_set_mode` switches the agent between `chat`, `plan`, and `execute`. In
`plan` mode the guardrail layer blocks any mutating tool except `plan_draft`,
`plan_approve`, and `session_set_mode` — so the agent can draft and you can review a
structured plan before anything with side effects runs.

---

## Scheduled jobs (`src/cron/`, dispatched in `src/index.ts`)

| Cron | Job | What it actually does |
|------|-----|-----------------------|
| `0 3 * * *` | `consolidation` | Summarizes prior-day sessions (Llama 3.1-8B); decays non-pinned memories whose embeddings are ≥0.95 cosine-similar to another; decays non-pinned memories older than 90 days. |
| `0 8 * * *` | `daily-brief` | Summarizes the last 24h of memories and posts to the configured Telegram/Slack channel. |
| `0 2 * * SUN` | `skill-distillation` | If ≥3 recently-summarized sessions exist, asks Llama to propose reusable skills from the summaries; writes one draft skill. |
| `0 */6 * * *` | `capability-reindex` | Re-embeds the capability registry and active skills into Vectorize. Also exposed as `POST /cron/capability-reindex` (Bearer). |

All summarization is best-effort: if the `AI` binding is unavailable the jobs skip
that step rather than fail.

---

## Storage map

| Store | Binding | Holds |
|-------|---------|-------|
| D1 | `FERMI_DB` | memory, sessions, messages + `messages_fts`, audit log, hooks, `team_spawns`, skills metadata, secrets metadata, connectors, packages, retrievers, OAuth clients/grants |
| R2 | `FERMI_BUCKET` | SKILL.md bodies, `fs_*` user files, `/apps/*` static assets, seeds |
| KV | `FERMI_KV` | runtime config (daily-brief channel/chat), approval tokens, `team:max_concurrent`, allow-lists |
| KV | `OAUTH_KV` | OAuth tokens/grants for the provider |
| Workers AI | `AI` | `bge-small-en-v1.5` embeddings; Llama 3.1-8B summaries and channel inference fallback |
| Vectorize | `FERMI_VECTORIZE` | `capability:*` and `skill:*` vectors |
| Worker Loader | `LOADER` | the `execute` sandbox |
| Service | `GATEWAY` | self-binding to `CodemodeFetchGateway` for sandbox egress |

---

## Standalone deployment

`bootstrap.sh` provisions D1, R2, KV, and Vectorize against the current Cloudflare
account and fills in `wrangler.jsonc` from `wrangler.template.jsonc`. No
account-specific IDs are committed. See [`../README.md`](../README.md) and
[`USAGE.md`](USAGE.md) for the full setup and operation guide.

---

## Cost

Single-user, the recurring floor is the Workers Paid plan ($5/mo). D1/R2/KV/Vectorize
stay near the free tier at single-user volume. Browser Rendering and the Anthropic
API (channels only — MCP hosts pay for their own inference) are the variable lines,
typically a few dollars a month. Realistic single-user total: roughly $8–20/mo
depending on browser and channel usage.
</content>
</invoke>
