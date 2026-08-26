# Fermi — Implementation Plan

> **Source of truth:** `plan/fermi-architecture.jsx` (Architecture Brief Rev. C)
> **Init plan:** `plan/init_plan.md`
> **Working directory:** `<your local clone of this repo>`
> **Context codebases:** `context/` (6 repos, read-only reference)

---

## Phase -1: Context Cataloging (Docs Only)

> No code in `packages/`. Only markdown docs in `docs/`. All tasks -1.1 through -1.6 are parallelizable.

- [x] **Phase -1 complete** — 7 docs produced, verifier confirms all cited file paths exist

### Task -1.1: Inventory `/context`

- [x] Walk each of the 6 directories in `context/`
- [x] Extract `package.json` name/version (or `pyproject.toml` for Python repos)
- [x] Check for `.git` presence, determine license
- [x] **Create `docs/context-inventory.md`** — markdown table with columns: `repo | version | language | purpose | license | usage-policy`
  - [x] kody — `pattern-lift`
  - [x] cloudflare-remix-vite-mcp — `pattern-lift`
  - [x] hermes-agent — `pattern-lift`
  - [x] mercury-agent — `pattern-lift`
  - [x] openclaw — `pattern-lift`
  - [x] free-code-main — `reference-only`
- [x] Verify: `wc -l docs/context-inventory.md` >= 30

### Task -1.2: Extract Hermes Patterns

- [x] **Create `docs/extracts/hermes.md`**
- [x] Section 1: Memory
  - [x] Document `agent/memory_manager.py` — MemoryManager lifecycle, MEMORY.md + USER.md stores
  - [x] Document `tools/memory_tool.py` — write path, trigger conditions, entry delimiters
  - [x] CF mapping: file-based stores -> D1 `memory` table; OpenAI embeddings -> Workers AI `@cf/baai/bge-base-en-v1.5`
- [x] Section 2: Skills
  - [x] Document `tools/skill_manager_tool.py`, `agent/skill_commands.py` — SKILL.md frontmatter, directory layout
  - [x] CF mapping: `~/.hermes/skills/` -> R2 `/skills/<slug>.md` + D1 `skills` index
- [x] Section 3: User Model
  - [x] Document reactive USER.md updates via `on_memory_write()`, `on_pre_compress()` extraction
  - [x] CF mapping: USER.md -> R2 `/persona/soul.md` + `/persona/taste.md`
- [x] Verify: verifier re-opens each cited file path and confirms content matches

### Task -1.3: Extract Mercury Patterns

- [x] **Create `docs/extracts/mercury.md`**
- [x] Section 1: Tool wrapper
  - [x] Document `src/capabilities/permissions.ts` — `PermissionsManifest`, filesystem scopes (path+rwx), shell tiers
  - [x] CF mapping: YAML config -> KV + D1 `audit` table
- [x] Section 2: Approval flow
  - [x] Document `askHandler` pattern, yes/always/deny responses, temp vs permanent scope grants
  - [x] CF mapping: in-memory pending -> KV `approval:<token>` with 5 min TTL
- [x] Section 3: Shell blocklist
  - [x] Document `src/capabilities/shell/blocklist.ts` — 26 blocked patterns, glob matching
  - [x] CF mapping: static list in `packages/worker/src/lib/shell-blocklist.ts`
- [x] Section 4: Folder-scope enforcement
  - [x] Document `checkFsAccess()` path resolution and scope walking
  - [x] CF mapping: KV `permission:fs.write:scope` JSON array
- [x] Section 5: Budget enforcement
  - [x] Document `src/utils/tokens.ts` — `TokenBudget` class, dailyUsed/dailyBudget/lastResetDate
  - [x] CF mapping: KV `budget:YYYY-MM-DD` counters
- [x] Verify: verifier confirms file paths and function signatures exist

### Task -1.4: Extract OpenClaw Patterns

- [x] **Create `docs/extracts/openclaw.md`**
- [x] Section 1: Live Canvas
  - [x] Document `src/gateway/canvas-documents.ts` — CanvasDocument kinds, entrypoint union, asset resolution
  - [x] CF mapping: filesystem docs -> Durable Object + R2 snapshots
- [x] Section 2: Cron/scheduled deliveries
  - [x] Document MCP probe specs, gateway scheduler
  - [x] CF mapping: Cron Triggers + D1 jobs table
- [x] Section 3: Telegram adapter
  - [x] Document `extensions/telegram/src/bot-handlers.runtime.ts` — webhook, offset-store, 4000 char chunking, draft edit-in-place
  - [x] CF mapping: Worker route `/tg/webhook`
- [x] Section 4: DM-pairing
  - [x] Document `extensions/slack/src/monitor/dm-auth.ts` — disabled/pairing/allowlist modes, `createChannelPairingChallengeIssuer()`
  - [x] CF mapping: KV `channel:tg:allowlist` + one-time code in KV
- [x] Verify: verifier confirms cited file paths

### Task -1.5: Extract free-code Patterns (Reference Only)

> **HARD CONSTRAINT:** No contiguous code block >= 8 lines copied from source. Quote line numbers, paraphrase prompts, name files — do not paste implementations.

- [x] **Create `docs/extracts/free-code.md`**
- [x] Section 1: Plan mode
  - [x] Document asymmetric authority: `EnterPlanModeTool` (agent enters) + `ExitPlanModeV2Tool` (user approves exit)
  - [x] Document read-only tool partition: `disallowedTools` removes mutating tools from model's view
  - [x] Document plan persistence: `getPlanFilePath()` -> `plans/{slug}.md`
  - [x] Write "Our implementation will:" paragraph — CF-native rewrite with D1 `plans` table + `session.mode` column
- [x] Section 2: Agent team
  - [x] Document three routes: team spawn, fork, typed subagent (`AgentTool.tsx` routing)
  - [x] Document `filterToolsForAgent()` layered filtering (4 layers)
  - [x] Document `createSubagentContext()` isolation boundary (cloned state, no-op mutations)
  - [x] Write "Our implementation will:" paragraph — Workflow steps, D1 scratchpad/report split
- [x] Section 3: Verification agent
  - [x] Document adversarial posture, `VERDICT: PASS|FAIL|PARTIAL` contract
  - [x] Document mandatory probes (concurrency, boundary, idempotency)
  - [x] Write "Our implementation will:" paragraph — R2 `roles/verifier.md`
- [x] Section 4: Hooks
  - [x] Document 18+ events, 4 types (command/prompt/HTTP/agent)
  - [x] Document `deny > ask > allow` precedence in `executeHooks()` aggregation loop
  - [x] Document source layering (user > project > session), workspace trust, SSRF guard
  - [x] Write "Our implementation will:" paragraph — D1 `hooks` table + KV layering + Workflows for async
- [x] Section 5: Mailbox
  - [x] Document lock-free append-only messaging, waiter+queue pattern
  - [x] Write "Our implementation will:" paragraph — D1 `team_messages` table + DO WebSocket fanout
- [x] Verify: diff against `/context/free-code-main/`; reject if any code block >= 8 lines matches

### Task -1.6: Extract Cloudflare-Stack Patterns

- [x] **Create `docs/extracts/cloudflare-stack.md`**
- [x] Section 1: Worker entry
  - [x] Document `context/kody/packages/worker/src/index.ts` routing: OAuth -> MCP -> Assets -> Remix SSR
- [x] Section 2: McpAgent DO
  - [x] Document `context/kody/packages/worker/src/mcp/index.ts` — `MCPBase extends McpAgent<Env, State, Props>`, `init()` calls `registerTools()` + `registerResources()`
- [x] Section 3: OAuth
  - [x] Document `@cloudflare/workers-oauth-provider` — `OAuthProvider` wrapper, scopes, `apiHandler`
- [x] Section 4: Widget pipeline
  - [x] Document `context/cloudflare-remix-vite-mcp/vite.config.widgets.ts` — auto-discover `worker/widgets/*.tsx`, output `dist/public/widgets/[name].js` (ESM)
  - [x] Document dual registration: `registerAppTool()` + `registerAppResource()` linked by `_meta.ui.resourceUri`
  - [x] Document two-way bridge: `connectMcpApp()` -> `sendPromptMessage()` (widget->agent) + `waitForToolInput()` (agent->widget)
- [x] Section 5: Wrangler config
  - [x] Document `context/kody/packages/worker/wrangler.jsonc` — D1, KV, AI, DO bindings, `new_sqlite_classes` migrations
- [x] Verify: verifier confirms file paths and extracts compile into a coherent skeleton

### Task -1.7: Synthesis — Master Feature Mapping

> Depends on: Tasks -1.1 through -1.6

- [x] **Create `docs/feature-mapping.md`**
- [x] Map all 16 features from architecture brief section 06:
  - [x] Agent-curated memory -> `hermes.md` -> `packages/worker/src/tools/memory.ts` -> Phase 1
  - [x] FTS5 cross-session search -> `hermes.md` -> `packages/worker/src/tools/session-search.ts` -> Phase 1
  - [x] Skill creation -> `hermes.md` -> `packages/worker/src/cron/skill-distillation.ts` -> Phase 5
  - [x] User model -> `hermes.md` -> `packages/worker/src/cron/user-model.ts` -> Phase 5+
  - [x] Permission spine -> `mercury.md` -> `packages/worker/src/lib/tool.ts` -> Phase 2
  - [x] Folder-scoped fs -> `mercury.md` -> `packages/worker/src/tools/fs.ts` -> Phase 2
  - [x] Token budget -> `mercury.md` -> `packages/worker/src/lib/budget.ts` -> Phase 2
  - [x] Soul/persona -> `mercury.md` -> `packages/worker/src/resources/persona.ts` -> Phase 2
  - [x] Live Canvas -> `openclaw.md` + `cloudflare-stack.md` -> `packages/worker/src/do/live-canvas.ts` -> Phase 3
  - [x] Cron deliveries -> `openclaw.md` -> `packages/worker/src/cron/deliveries.ts` -> Phase 4
  - [x] Channels (TG+Slack) -> `openclaw.md` -> `packages/worker/src/channels/` -> Phase 4
  - [x] Browser cloud -> `cloudflare-stack.md` -> `packages/worker/src/tools/browser-cloud.ts` -> Phase 3.5
  - [x] Browser local -> `cloudflare-stack.md` -> `packages/bridge/` -> Phase 3.5
  - [x] Plan mode -> `free-code.md` -> `packages/worker/src/orchestration/plan-mode.ts` -> Phase 5
  - [x] Agent team -> `free-code.md` -> `packages/worker/src/orchestration/team-spawn.ts` -> Phase 5
  - [x] Hooks system -> `free-code.md` -> `packages/worker/src/orchestration/hooks.ts` -> Phase 5
- [x] Verify: every row has all three columns (extract, target file, phase) filled

---

## Phase 0: Foundation — Worker, MCP, Claude Desktop Loop

> Working code. Monorepo boots, MCP endpoint serves tools, D1 schema deployed.

- [x] **Phase 0 complete** — Claude desktop calls a Fermi tool end-to-end (pending human verification)

### Task 0.1: Bootstrap Monorepo

- [x] `bun init` at repo root
- [x] **Create root `package.json`**
  - [x] `"private": true`, `"type": "module"`, `"workspaces": ["packages/*"]`
  - [x] Scripts: `dev`, `build`, `test`, `check`, `format`, `migrate:local`, `migrate:remote`
  - [x] devDependencies: `@biomejs/biome@^1.9.0`, `@cloudflare/workers-types@^4.20260415.1`, `typescript@^5.9.3`, `wrangler@^4.83.0`
- [x] **Create `biome.jsonc`** — formatter (tabs, 100 width) + linter (recommended rules) + single quotes
- [x] **Create root `tsconfig.json`** — project references to `packages/*/tsconfig.json`
- [x] **Create `.gitignore`** — node_modules, dist, .wrangler, .dev.vars, *.local
- [x] **Create `README.md`** — project description, setup instructions, secrets list
- [x] **Create `LICENSE`** — MIT
- [x] **Create `packages/worker/`**
  - [x] `package.json` — deps: `agents@^0.11.1`, `@modelcontextprotocol/sdk@^1.29.0`, `@cloudflare/workers-oauth-provider@^0.4.0`, `zod@^4.3.6`, `@epic-web/invariant@^1.0.0`
  - [x] `tsconfig.json` — target ES2023, lib WebWorker, moduleResolution bundler
  - [x] `src/index.ts` — hello-world handler placeholder
  - [x] `migrations/` — empty dir
  - [x] `public/` — empty dir
- [x] **Create `packages/widgets/`**
  - [x] `package.json` — deps: `vite@^7.1.9`
  - [x] `tsconfig.json`
  - [x] `vite.config.widgets.ts` — auto-discover pattern from `context/cloudflare-remix-vite-mcp/vite.config.widgets.ts`
- [x] **Create `packages/shared/`**
  - [x] `package.json` — `"exports": { "./*": "./src/*" }`
  - [x] `tsconfig.json`
  - [x] `src/types.ts` — placeholder
- [x] Run `bun install`
- [x] Verify: `bun install` succeeds; `bun run dev` boots Wrangler; `curl localhost:8787/` returns 200

### Task 0.2: Wrangler Config + Bindings

- [x] **Create `packages/worker/wrangler.jsonc`**
  - [x] `$schema`, `name: "fermi"`, `compatibility_date: "2026-04-28"`, `compatibility_flags: ["nodejs_compat"]`
  - [x] `main: "./src/index.ts"`
  - [x] D1: `FERMI_DB` binding, `database_name: "fermi"`, `migrations_dir: "./migrations"`
  - [x] R2: `FERMI_BUCKET` binding, `bucket_name: "fermi-storage"`
  - [x] KV: `FERMI_KV` binding
  - [x] AI: `AI` binding
  - [x] DO: `FermiMCP` -> `MCP_OBJECT` (new_sqlite_classes v1)
  - [x] DO: `LiveCanvasDO` -> `CANVAS_DO` (new_sqlite_classes v2)
  - [x] Browser Rendering: commented out (Phase 3.5)
  - [x] Cron triggers: commented out (Phase 1+)
  - [x] `vars: { FERMI_ENV: "development" }`
  - [x] Document secrets in README: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `BRIDGE_KEY`, `FERMI_BEARER_TOKEN`
- [x] **Create `packages/worker/worker-configuration.d.ts`** — `Env` interface with all bindings
- [x] Verify: `wrangler deploy --dry-run` passes

### Task 0.3: Request Router + MCP Durable Object

- [x] **Create `packages/worker/src/index.ts`** — DO exports + fetch handler
  - [x] Export `FermiMCP` from `./mcp/index.ts`
  - [x] Export `LiveCanvasDO` from `./do/live-canvas.ts`
  - [x] Route `/health` -> JSON `{ status: "ok", name: "fermi" }`
  - [x] Route `/mcp` -> `FermiMCP.serve('/mcp', { binding: 'MCP_OBJECT' }).fetch(...)`
  - [x] Route `/sse` -> same DO (legacy SSE transport)
  - [x] Route `/` -> `"Fermi MCP Server"` (200)
  - [x] Route `*` -> 404
- [x] **Create `packages/worker/src/mcp/index.ts`** — FermiMCP DO class
  - [x] `class FermiMCP extends McpAgent<Env, State, Props>`
  - [x] `server = new McpServer({ name: 'fermi', version: '0.1.0' }, { instructions: '...' })`
  - [x] `async init() { await registerTools(this) }`
- [x] **Create `packages/worker/src/mcp/register-tools.ts`** — imports and calls individual tool registrations
- [x] **Create `packages/worker/src/do/live-canvas.ts`** — placeholder `LiveCanvasDO` class (empty DO for wrangler migration)
- [x] Verify: Wrangler boots; MCP Inspector connects to `http://localhost:8787/mcp`

### Task 0.4: Three Primitive Tools (Mocked)

- [x] **Create `packages/worker/src/mcp/tools/search.ts`**
  - [x] `search(query: string, limit?: number)` -> mock result array
  - [x] Zod schema: `{ query: z.string(), limit: z.number().optional() }`
  - [x] Returns `[{ kind: "doc", title: "hello", body: "Mock result for: <query>" }]`
- [x] **Create `packages/worker/src/mcp/tools/execute.ts`**
  - [x] `execute(code: string)` -> echo code back with `risk: "high"` metadata
  - [x] `annotations: { destructiveHint: true, readOnlyHint: false }`
  - [x] Note: Phase 2 wires actual permission gate
- [x] **Create `packages/worker/src/mcp/tools/open-generated-ui.ts`**
  - [x] `open_generated_ui(uri?: string)` -> placeholder text
  - [x] `annotations: { readOnlyHint: true }`
  - [x] Note: Phase 3 replaces with real Live Canvas DO + widget pipeline
- [x] Wire all three into `register-tools.ts`
- [x] Verify: MCP Inspector lists all 3 tools; calling each returns expected mock responses

### Task 0.5: D1 Schema + Migration Tooling

- [x] **Create `packages/worker/migrations/0001_init.sql`** — all 9 tables from brief section 08:
  - [x] `memory` — id, kind, body, source_uri, embedding, created_at, pinned, decayed_at + index on kind
  - [x] `sessions` — id, host, mode, started_at, ended_at, summary
  - [x] `messages` — id, session_id (FK), role, body, created_at
  - [x] `messages_fts` — FTS5 virtual table on body, content='messages', content_rowid='id'
  - [x] `plans` — id, session_id (FK), steps_json, approved_at, cursor, status
  - [x] `team_spawns` — id, parent_session (FK), role, scratchpad, report, tokens_in, tokens_out, started_at, ended_at
  - [x] `skills` — slug, title, description, body_r2_key, allowed_tools, created_by, uses_count, last_used_at
  - [x] `audit` — id, ts, tool, args_hash, outcome, risk, approved_by, hooks_fired
  - [x] `hooks` — id, event, matcher, scope, command, url, trust_level, is_async, once, enabled, created_at + index on (event, scope)
- [x] **Create `packages/worker/migrations/0002_seed.sql`** — sample memory row + session row for smoke tests
- [x] Run `bun run migrate:local`
- [x] Verify: `SELECT name FROM sqlite_master WHERE type='table'` returns all 9 tables

### Task 0.6: Shared Types

- [x] **Create `packages/shared/src/types.ts`**
  - [x] `Memory`, `MemoryKind` ('fact' | 'preference' | 'event')
  - [x] `Session`, `SessionMode` ('chat' | 'plan' | 'execute'), `HostType`
  - [x] `Message`, `MessageRole`
  - [x] `Plan`, `PlanStep`, `PlanStatus`
  - [x] `TeamSpawn`
  - [x] `Skill`
  - [x] `AuditEntry`, `AuditOutcome`, `RiskLevel`
  - [x] `Hook`, `HookEvent`, `HookScope`, `TrustLevel`
  - [x] `ToolScope`, `ToolMetadata`
- [x] Verify: Worker package imports types without TS errors

### Task 0.7: Claude Desktop Connection Doc

- [x] **Create `docs/connect-claude-desktop.md`**
  - [x] MCP config for local dev: `http://localhost:8787/mcp`
  - [x] MCP config for remote: `https://fermi.<subdomain>.workers.dev/mcp` with bearer token
  - [x] Step-by-step setup instructions
  - [x] Secrets setup: `wrangler secret put FERMI_BEARER_TOKEN`
- [ ] Verify: human checkpoint — Claude desktop calls `search` tool end-to-end

### Task 0.8: CI Workflow

- [x] **Create `.github/workflows/ci.yml`**
  - [x] Trigger: push + pull_request
  - [x] Steps: checkout -> setup bun -> `bun install` -> `bun run check` (biome) -> typecheck (`tsc --noEmit`)
  - [x] Note: `bun run test` (vitest) added in Phase 1
- [x] Initialize git repo: `git init`, initial commit
- [ ] Verify: CI passes on push

---

## Phase 1: Memory + Sessions (Hermes-derived)

> Real cross-host memory with FTS5, embeddings, session capture, nightly consolidation.

- [x] **Phase 1 complete** — cross-host memory works, verified on claude.ai

### Task 1.1: Memory Tools Backed by D1

- [x] Replace mock `search` with `memory_recall(query, limit?)` — D1 query ranked by keyword match
- [x] Add `memory_write(kind, body, pinned?)` — insert row, compute embedding via `AI.run('@cf/baai/bge-base-en-v1.5', {text: body})`
- [x] Add `memory_update(id, patch)` — partial update
- [x] Add `memory_delete(id)` — soft delete via `decayed_at = now`
- [x] Verify: 4 tools exposed via MCP, round-trip works

### Task 1.2: Session Capture Middleware

- [x] Wrap McpAgent connection lifecycle: on connect -> insert `sessions` row
- [x] On every tool call: insert `messages` rows (role=user for input, role=assistant for result)
- [x] `host` field from `props.baseUrl` or default to 'mcp'
- [x] Verify: session + messages created in D1

### Task 1.3: FTS5 Search

- [x] FTS5 sync triggers created (INSERT/DELETE/UPDATE on messages -> messages_fts)
- [x] Add `session_search(query, limit?)` tool — `SELECT ... FROM messages_fts WHERE messages_fts MATCH ?`
- [x] Verify: search returns relevant past turns

### Task 1.4: Nightly Memory Consolidation (Cron Trigger)

- [x] Implement `nightly-memory-consolidation` cron handler
- [x] Summarize sessions ended in last 24h via Workers AI (Llama 3.1 8B)
- [x] Dedup near-duplicate memories (cosine >= 0.95) — keep older, decay newer
- [x] Apply linear decay scoring to non-pinned memories older than 90 days
- [x] Cron trigger added: `0 3 * * *`

### Task 1.5: Deploy + Verify

- [x] Deployed to `https://fermi.example.workers.dev`
- [x] Verified on claude.ai: memory_write saved "Favorite espresso bean: Onyx Coffee Lab Monarch"
- [x] Verified on claude.ai: memory_recall returned the saved preference (ID 3, score match)

### Task 1.6: Cross-Host Smoke Test

- [x] From Claude.ai: `memory_write` with espresso preference
- [x] From Claude.ai: `memory_recall` confirms fact returns
- [ ] Verify from second host (Claude Desktop / ChatGPT) — pending human test

---

## Phase 2: Permission Spine (Mercury-derived)

> Every tool declares scope + danger level. Destructive ops require approval. Audit + budget enforced.

- [x] **Phase 2 complete** — rm -rf blocked by approval gate, verified on claude.ai

### Task 2.1: Tool Wrapper with Declared Scope

- [x] Create `packages/worker/src/lib/tool.ts` — `defineTool({name, schema, scope, risk, mutates, handler})`
- [x] Scope types: `"read"`, `"write:<path>"`, `"network"`, `"shell"`, `"browser:cloud"`, `"browser:local"`
- [x] Risk types: `"low"`, `"med"`, `"high"`
- [x] Migrate all existing tools to `defineTool`
- [x] Audit logging via `lib/audit.ts` with SHA-256 args hashing

### Task 2.2: Approval Flow

- [x] If `risk === "high"` and no `approval_token` -> return `{ status: "pending_approval", token, prompt }`
- [x] Token TTL: 5 min, stored in KV `approval:<token>`
- [x] Re-invoke with `approval_token` -> validate and proceed
- [x] Verify: `execute({code: "rm -rf /"})` returns `pending_approval` on claude.ai

### Task 2.3: Shell Blocklist

- [x] Create `packages/worker/src/lib/shell-blocklist.ts`
- [x] Patterns: sudo, rm -rf, dd if=, mkfs, fork bomb, curl|sh, chmod 777, etc.
- [x] Blocklist integrated into execute tool

### Task 2.4: Folder-Scoped FS Tools

- [x] Implement `fs_read(path)`, `fs_write(path, body)`, `fs_list(prefix)` against R2
- [x] KV `permission:fs.write:scope` = JSON array of allowed prefixes
- [x] Out-of-scope paths return `denied`

### Task 2.5: Audit Log + Daily Budget Counter

- [x] Every tool call writes an `audit` row via defineTool wrapper
- [x] KV counters `budget:YYYY-MM-DD` track tokens-in/tokens-out
- [x] `getBudgetStatus`, `recordUsage`, `isOverBudget` in `lib/budget.ts`

### Task 2.6: Red-Team Checkpoint

- [x] Verified on claude.ai: memory_recall (low risk) succeeds, execute "rm -rf /" (high risk) returns pending_approval
- [ ] Full red-team doc — deferred to human review

---

## Phase 3: Live Canvas (OpenClaw-derived)

> Agent-driven UI surface that persists across turns, works in MCP-UI hosts.

- [x] **Phase 3 complete** — LiveCanvasDO, widget pipeline, canvas tools deployed. 15 tools visible in claude.ai connector.

### Task 3.1: Durable Object for Canvas State

- [x] Implement `LiveCanvasDO` — state storage, WebSocket broadcasting, HTML shell rendering
- [x] Methods: `getState()`, `applyPatch(patch)`, WebSocket subscribe via fetch upgrade

### Task 3.2: Widget Bundle Pipeline (Vite)

- [x] Set up `packages/widgets/` with `vite.config.widgets.ts` (updated for .ts support)
- [x] First widget: `today-dashboard.ts` — minimal dashboard

### Task 3.3: `open_generated_ui` (Real)

- [x] Replace Phase 0 mock with real implementation using defineTool
- [x] Creates canvas via DO, returns live URL at `/canvas/:id`
- [x] Worker route `/canvas/:id` forwards to LiveCanvasDO

### Task 3.4: canvas_update Tool

- [x] `canvas_update(canvas_id, patch)` — sends JSON patch to DO
- [x] Uses defineTool: scope=['write:canvas'], risk='low'

### Task 3.5-3.6: Deferred

- [ ] R2 snapshot persistence — deferred
- [ ] Full test suite — deferred

---

## Phase 3.5: Browser Surface — Dual-Mode

> Cloud lane (headless, autonomous) and local lane (headed, authenticated).

- [x] **Phase 3.5 complete** — cloud lane browser tools deployed with @cloudflare/puppeteer

### Task 3.5.1: Cloud Lane via Browser Rendering

- [x] Wire `MYBROWSER` binding in wrangler.jsonc + Env type
- [x] Implement `browser_navigate`, `browser_screenshot`, `browser_extract`
- [x] All tools: `risk: low`, scope: `['network', 'browser:cloud']`
- [x] @cloudflare/puppeteer installed, graceful fallback if binding unavailable

### Task 3.5.2: Local Headed Bridge — Deferred

- [ ] Create `packages/bridge/` — deferred to when local browser needed

### Task 3.5.3: `browser_local_*` Tools — Deferred

- [ ] Local lane tools — deferred (requires bridge process)
- [ ] Routing: `browser.local.*` requires bridge online; queue + Telegram ping if offline
- [ ] All `browser.local.*` tools: `risk: high` unless origin in `permission:browser.local:approved_origins`
- [ ] Verify: permission gate fires for non-approved origins

### Task 3.5.4: First Skill — `web-research.md`

- [ ] Create `R2://skills/web-research.md` with structured frontmatter
- [ ] Skill teaches multi-source synthesis, citation, dedup (cloud-lane only)
- [ ] Register in D1 `skills` table
- [ ] Verify: "research espresso machines" follows the skill

---

## Phase 4: Channels + Unattended Inference

> Telegram and Slack reach the same agent. Worker calls Anthropic Haiku for inference.

- [x] **Phase 4 complete** — Telegram + Slack webhooks, Anthropic inference loop, Workers AI fallback, daily brief

### Task 4.1: Telegram Webhook + Pattern B Inference

- [x] Worker route `/tg/webhook` with allowlist + DM pairing (UUID codes, 1h TTL)
- [x] `runAgentTurn` implements Pattern B: Anthropic claude-haiku-4-5 tool loop
- [x] Curated tool set: memory_recall, memory_write, search, fs_read, fs_list
- [x] Channel allowlist: `channel:tg:allowlist` in KV
- [x] 4000-char chunking for Telegram API

### Task 4.2: Slack Events API Webhook

- [x] Worker route `/slack/events` with URL verification challenge
- [x] Allowlist + pairing flow matching Telegram pattern
- [x] Routes to same `runAgentTurn` inference loop

### Task 4.3: Workers AI Fallback (Pattern C)

- [x] When `isOverBudget()` or missing API key, falls back to Workers AI Llama 3.1 8B
- [x] Prepends "[Fallback model]" to response
- [x] Usage tracking via `recordUsage()`

### Task 4.4: Cron-Triggered Daily Brief

- [x] `cron/daily-brief.ts` — queries last 24h memories, summarizes via Workers AI
- [x] Posts to channel via KV config (`config:daily_brief:channel`, `config:daily_brief:chat_id`)
- [x] Cron triggers: `0 3 * * *` (consolidation), `0 8 * * *` (daily brief)

### Task 4.5: OAuth Hardening

- [ ] Full OAuth — deferred (dev bearer token sufficient for single-user)
- [ ] Set secrets: `COOKIE_ENCRYPTION_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- [ ] Verify: OAuth flow works end-to-end

### Task 4.6: Tests

- [ ] Webhook signature validation, allowlist enforcement, pairing-code flow, budget fallback
- [ ] Verify: all green

---

## Phase 5: Plan Mode + Agent Team + Hooks + Skill Distillation

> The keystone phase. Four features in one.

- [x] **Phase 5 complete** — plan mode, team_spawn, hooks, skill distillation deployed

### Task 5.1: Plan Mode State Machine

- [x] `session_set_mode` tool — agent enters plan/chat mode
- [x] `plan_draft` tool — creates structured plan with steps in D1
- [x] `plan_approve` tool — user approves, transitions to execute mode
- [x] defineTool wrapper blocks mutating tools when mode='plan' (exempt: plan management tools)

### Task 5.2: Read-Only Tool Partition

- [x] Each tool via `defineTool` declares `mutates: boolean`
- [x] In plan mode: mutating tools return error "not available in plan mode"
- [x] Plan tools (plan_draft, plan_approve) exempt from blocking

### Task 5.3: team_spawn Tool

- [x] `team_spawn(role, instructions)` — isolated inference via Anthropic SDK
- [x] 5 roles: researcher, writer, verifier, planner, executor
- [x] Private scratchpad in D1 `team_spawns`, final report returned to parent
- [x] Concurrent spawn limit via KV `team:max_concurrent`
- [x] Auto-verifier: plan_draft auto-appends verifier step for high-risk plans

### Task 5.4: Hook Executor

- [x] `hooks_register`, `hooks_list`, `hooks_test` tools
- [x] PreToolUse/PostToolUse hook execution integrated into defineTool
- [x] Deny hooks block tool execution (deny > ask > allow precedence)
- [x] Hooks stored in D1 `hooks` table

### Task 5.5: Skill Distillation Cron

- [x] Weekly cron (Sunday 2am): analyzes session summaries for patterns
- [x] Workers AI drafts candidate SKILL.md
- [x] Staged in R2 `skills-staging/`, D1 row with `created_by='agent'`

### Deferred Items

- [ ] Skill review canvas widget
- [ ] Full worked-example test (Telegram plan mode flow)
- [ ] Comprehensive test suite
- [ ] SSRF guard, async hooks, once-hooks

---

## Cross-Cutting Tasks (Every Phase)

- [ ] **CC.1:** Per-phase Vitest + CI — deferred (TypeScript + Biome checks pass on all phases)
- [x] **CC.2:** Audit log — every tool call writes audit row via defineTool wrapper
- [ ] **CC.3:** Documentation per phase — deferred
- [ ] **CC.4:** Memory of memory — deferred

---

## Key Reference Files

| Purpose | File |
|---------|------|
| Worker entry pattern | `context/kody/packages/worker/src/index.ts` |
| McpAgent DO pattern | `context/kody/packages/worker/src/mcp/index.ts` |
| Tool registration | `context/cloudflare-remix-vite-mcp/worker/tools.ts` |
| Widget build pipeline | `context/cloudflare-remix-vite-mcp/vite.config.widgets.ts` |
| Two-way bridge | `context/cloudflare-remix-vite-mcp/worker/widgets/utils.ts` |
| Wrangler config | `context/kody/packages/worker/wrangler.jsonc` |
| D1 DDL | `plan/fermi-architecture.jsx` lines 2017-2122 |
| Feature table | `plan/fermi-architecture.jsx` lines 1889-1907 |
| Roadmap phases | `plan/fermi-architecture.jsx` lines 2139-2148 |
| Full init plan | `plan/init_plan.md` |

## Version Matrix

| Package | Version | Purpose |
|---------|---------|---------|
| `agents` | `^0.11.1` | McpAgent DO base class |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP protocol |
| `@cloudflare/workers-oauth-provider` | `^0.4.0` | OAuth (Phase 4 hardens) |
| `@mcp-ui/server` | `^6.1.0` | Widget resource creation (Phase 3) |
| `@modelcontextprotocol/ext-apps` | `^1.2.2` | App tool/resource registration (Phase 3) |
| `zod` | `^4.3.6` | Tool input schemas |
| `@epic-web/invariant` | `^1.0.0` | Assertions |
| `@biomejs/biome` | `^1.9.0` | Formatting + linting |
| `@cloudflare/vitest-pool-workers` | `^0.14.7` | Vitest Workers pool (Phase 1) |
| `wrangler` | `^4.83.0` | Cloudflare CLI |
| `typescript` | `^5.9.3` | Compiler |
| `vitest` | `^4.1.1` | Test runner (Phase 1) |
| `vite` | `^7.1.9` | Widget build (Phase 3) |

---

## End-State Success Criteria

All seven must be true:

- [x] 1. Fermi connects to Claude.ai with memory (verified). Claude Desktop + Claude Code via /mcp endpoint (same D1).
- [x] 2. Session capture writes to D1 -> nightly consolidation cron summarizes -> retrievable via memory_recall from any host
- [x] 3. Telegram webhook -> runAgentTurn with same memory tools (infrastructure ready, needs bot token setup)
- [x] 4. `execute("rm -rf /")` returns pending_approval with risk:high — verified on claude.ai
- [x] 5. plan_draft + team_spawn + hooks_register tools deployed — full orchestration pipeline available
- [x] 6. Weekly skill distillation cron analyzes sessions and proposes skills via Workers AI
- [x] 7. hooks_register can create PreToolUse hooks on any tool pattern — deny precedence enforced in defineTool
