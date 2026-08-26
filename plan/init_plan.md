# Fermi — Project Initialization Plan

> **Audience:** the Claude Code agent team that will execute this plan.
> **Source of truth:** `Architecture Brief // 2026.04.28 // Rev. C` (the React artifact).
> **Reference codebases:** mounted read-only at `/context/`.
> **Stack target:** mirror [`kentcdodds/kody`](https://github.com/kentcdodds/kody) — Bun monorepo, Cloudflare Workers, Remix 3 UI, OAuth-protected MCP, Durable Object–backed `McpAgent`, TypeScript end-to-end.

---

## How to read this document

This plan is broken into **9 numbered phases**, each with **tasks** and **subtasks** the agent team executes.

- **Phase −1** is mandatory context exploration. No code is written before it completes.
- **Phase 0** stands up the foundation (Worker + MCP + Claude desktop loop).
- **Phases 1–6** map 1:1 to the architecture brief's roadmap (P1–P5 in the brief).
- Every task has: `goal`, `inputs` (files in `/context` to consult), `deliverable`, `verification`, and a suggested `agent role` (researcher / explorer / writer / verifier / planner / executor).
- **Tests are added per-phase as features land.** Each phase ends with a verifier subagent re-running the checkpoint.
- **`/context` is read-only.** Nothing inside it gets modified. Code we ship lives in `/workspace` (or whatever the repo root becomes).

### Hard rules for the agent team

1. **Never copy source from `/context/free-code`.** It is reference-only — read patterns, write our own implementation. All other reference repos may be pattern-lifted with attribution in code comments.
2. **Plan-mode-first.** For any task marked `risk: med` or `risk: high`, enter plan mode, draft the plan, and wait for human approval before executing.
3. **Verifier on every phase.** Phase exit requires a verifier subagent's report with `VERDICT: PASS`.
4. **One PR per task.** Keep diffs small and reviewable.
5. **Skill files first.** When a task touches Word docs, PDFs, frontend design, etc., read the matching `SKILL.md` before writing code.

---

## Phase −1: `/context` exploration & cataloging

**Goal:** before a single line of Worker code gets written, produce a catalog of every reference codebase and a short, opinionated extraction of the patterns we'll use. This becomes the single source of truth that every later phase reads from.

**Duration:** ~3 days. **Risk:** low. **Default agent:** researcher (parallelizable).

### Task −1.1 — Inventory `/context`

- **Goal:** know exactly what's mounted and at what version.
- **Subtasks:**
  - Walk `/context/` two levels deep; record each top-level directory's purpose.
  - For each repo: extract `package.json` name + version, last commit (if `.git` present), and a one-line "what this is."
  - Produce `/workspace/docs/context-inventory.md`.
- **Deliverable:** Markdown table with columns `repo`, `version`, `language`, `purpose`, `license`, `usage-policy` (`reference-only` for free-code, `pattern-lift` for everything else).
- **Verification:** `wc -l docs/context-inventory.md` ≥ 30; contains a row for every directory in `/context/`.

### Task −1.2 — Extract Hermes patterns

- **Goal:** capture how Hermes does memory, skill distillation, and the dialectic user model.
- **Inputs:** `/context/hermes-agent/` (or whatever the dir is named).
- **Subtasks:**
  - Find the memory write path. Document the schema, the trigger conditions, the embedding model used.
  - Find the skill-creation loop. Document: how does it cluster successful runs, and what's the prompt that drafts the SKILL.md?
  - Find the user-model background process. Document the cron interval, the prompt, the storage shape.
- **Deliverable:** `/workspace/docs/extracts/hermes.md` — three sections (memory, skills, user-model), each with: a 5-line summary, the relevant file paths in `/context/hermes-agent/`, the schema we'll port, and a "Cloudflare mapping" paragraph (e.g. "their SQLite memory table → our D1 `memory` table; their OpenAI embedding call → Workers AI `@cf/baai/bge-base-en-v1.5`").
- **Verification:** verifier re-opens each cited file path, confirms the cited line ranges actually contain what the extract claims.

### Task −1.3 — Extract Mercury patterns

- **Goal:** capture the permission spine, scope rules, and audit shape.
- **Inputs:** `/context/mercury-agent/`.
- **Subtasks:**
  - Find the tool wrapper. Document how each tool declares scope + danger level.
  - Find the approval flow. Document the state machine (request → pending → approved/denied).
  - Find the shell blocklist + folder-scope enforcement. List the regex/glob rules.
  - Find the audit log writer. Document the row shape.
  - Find the daily-budget enforcement.
- **Deliverable:** `/workspace/docs/extracts/mercury.md` — five sections matching the subtasks above. Each with file paths and a Cloudflare mapping.
- **Verification:** verifier confirms file paths.

### Task −1.4 — Extract OpenClaw patterns

- **Goal:** capture Live Canvas, scheduled deliveries, and the multi-channel inbox shape.
- **Inputs:** `/context/openclaw/`.
- **Subtasks:**
  - Find the Live Canvas implementation. Document the persistence model, the two-way bridge, and the MCP-UI surface.
  - Find the cron + scheduled deliveries pipeline.
  - Find the Telegram + Slack adapters. **Do not** extract WhatsApp/iMessage/Signal — they are explicitly out of scope.
  - Find the DM-pairing pattern (one-time code for unknown senders).
- **Deliverable:** `/workspace/docs/extracts/openclaw.md`.
- **Verification:** verifier confirms file paths.

### Task −1.5 — Extract free-code patterns (reference-only)

- **Goal:** the architecture brief cites free-code extensively for plan mode, the agent team, and hooks. Re-derive those extracts from the actual source so we know what we're rebuilding.
- **Inputs:** `/context/free-code/` — **read-only, no copying.**
- **Subtasks:**
  - **Plan mode.** Open `EnterPlanModeTool.ts`, `ExitPlanModeV2Tool.ts`, `planAgent.ts`. Confirm the asymmetric authority pattern (agent enters, user must approve exit). Confirm the read-only tool partition (mutating tools removed from the model's view, not refused). Document the prompt strings we'll write our own version of.
  - **Agent team.** Open `AgentTool.tsx`, `agentToolUtils.ts` (`filterToolsForAgent`), `forkedAgent.ts` (`createSubagentContext`), `runAgent.ts`. Document the three routes (team spawn, fork, typed subagent), the isolation boundary, the three execution modes (worktree, background, foreground).
  - **Verification agent.** Open `verificationAgent.ts`. Document the adversarial posture and the `VERDICT: PASS|FAIL|PARTIAL` output contract.
  - **Hooks.** Open the hooks schema (`HOOK_EVENTS`, the four hook types) and the executor (`executeHooks` aggregation loop). Document the precedence rule (`deny > ask > allow`), source layering (user > project > session), workspace trust, SSRF guard, async hooks.
  - **TeamCreate + mailbox.** Open `TeamCreateTool` + `teammateMailbox.ts`. Document how teammate inboxes work and the lock pattern.
- **Deliverable:** `/workspace/docs/extracts/free-code.md` — one section per subtask above. Each section ends with a **"Our implementation will:"** paragraph that describes our Cloudflare-native rewrite.
- **Hard constraint:** **no source code from `/context/free-code` may be copied into `/workspace`.** Quote line numbers, paraphrase prompts, name files — do not paste implementations. The verifier checks this on PR.
- **Verification:** verifier diffs `/workspace/docs/extracts/free-code.md` against `/context/free-code/`; rejects if any contiguous code block ≥ 8 lines matches a free-code source file.

### Task −1.6 — Extract Cloudflare-stack patterns from `kentcdodds/kody` and `cloudflare-remix-vite-mcp`

- **Goal:** copy the structural skeleton we'll start from.
- **Inputs:** `/context/kody/`, `/context/cloudflare-remix-vite-mcp/`.
- **Subtasks:**
  - Document kody's `packages/worker/src/index.ts` request-routing order: OAuth → MCP → static assets → Remix server handler.
  - Document kody's chat-agent plumbing (Durable Object, `McpAgent` extension, tool registration).
  - Document the OAuth provider it uses (likely the Cloudflare workers-oauth-provider lib).
  - Document the `cloudflare-remix-vite-mcp` widget bundle pipeline: `vite.config.widgets.ts`, the `dist/public/widgets/*.js` output, the `_meta.ui.resourceUri` registration. This is what our **Live Canvas** will be built on.
- **Deliverable:** `/workspace/docs/extracts/cloudflare-stack.md` — five sections (worker entry, McpAgent, OAuth, widget pipeline, Wrangler config).
- **Verification:** verifier confirms file paths and that the extracts compile mentally into a coherent skeleton.

### Task −1.7 — Synthesis: master mapping

- **Goal:** one document that maps every feature row in §06 of the brief to a concrete file we'll write and a concrete extract from Phase −1.
- **Subtasks:**
  - Re-create the §06 feature table in `/workspace/docs/feature-mapping.md` with three new columns: `extract` (which Phase −1 doc), `target file` (what we write in our repo), `phase` (which phase delivers it).
- **Deliverable:** `/workspace/docs/feature-mapping.md`.
- **Verification:** verifier checks every row has all three columns filled.

### Phase −1 Checkpoint

> ✅ Five extract docs + an inventory + a feature-mapping. Verifier subagent re-runs every cited file path and confirms it exists. No code in `/workspace/packages/` yet.

---

## Phase 0: Foundation — Worker, MCP, Claude desktop loop

**Goal:** stand up the monorepo, the Worker, the OAuth-protected MCP endpoint, three primitive tools, and confirm Claude desktop can call them end-to-end.

**Duration:** Week 1–2. **Risk:** low. **Default agent:** executor.

### Task 0.1 — Bootstrap the monorepo (kody-shaped)

- **Goal:** a Bun workspace with `packages/worker` and `packages/widgets`, mirroring kody.
- **Subtasks:**
  - `bun init` at repo root. Set `"private": true`, `"workspaces": ["packages/*"]`.
  - Create `packages/worker/` with `package.json`, `wrangler.jsonc`, `tsconfig.json`.
  - Create `packages/widgets/` (Remix 3 UI surface — for the Live Canvas later).
  - Create `packages/shared/` for cross-package types (Memory, PlanStep, HookEvent, etc.).
  - Add `biome.jsonc` for formatting/linting (kody uses Biome).
  - Add `.gitignore`, `README.md` (paste §00 of the brief), `LICENSE` (MIT or owner's choice).
- **Deliverable:** `bun install` succeeds; `bun run --cwd packages/worker dev` boots Wrangler against a hello-world handler.
- **Verification:** `curl localhost:8787/` returns `200`.

### Task 0.2 — Wrangler config + bindings

- **Goal:** declare every Cloudflare primitive we know we'll use, even if not yet wired.
- **Inputs:** `/workspace/docs/extracts/cloudflare-stack.md` (kody's wrangler.jsonc).
- **Subtasks:**
  - In `wrangler.jsonc`: declare a D1 database `FERMI_DB`, an R2 bucket `FERMI_BUCKET`, a KV namespace `FERMI_KV`, a Durable Object class `LiveCanvasDO`, a Browser Rendering binding `MYBROWSER`, and the AI binding `AI`.
  - Add `[vars]` for non-secret config; `[secrets]` documented in `README.md` (Anthropic key, Telegram token, Slack tokens, bridge auth — to be set with `wrangler secret put`).
  - Cron Triggers: declare placeholders for `nightly-memory-consolidation` (daily 3am) and `bridge-heartbeat` (every 5 min).
- **Deliverable:** `wrangler deploy --dry-run` passes.
- **Verification:** verifier reads the file and confirms each binding from §07 of the brief is present (or annotated as Phase-N).

### Task 0.3 — Request router (kody-shaped)

- **Goal:** `packages/worker/src/index.ts` mirrors kody's order: OAuth → MCP → static assets → Remix handler.
- **Inputs:** `/workspace/docs/extracts/cloudflare-stack.md`.
- **Subtasks:**
  - Install `agents` (Cloudflare's `McpAgent`), `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`.
  - Wire OAuth handler at `/oauth/*`. Start with a **single-bearer-token** mode (config-flag) for dev; full OAuth lands in Phase 4.
  - Wire MCP at `/mcp` (streamable-http) and `/sse` (legacy SSE) using `McpAgent`.
  - Wire a 404 → static asset fallback (will hold Remix later).
- **Deliverable:** local Wrangler boots, MCP Inspector connects to `http://localhost:8787/mcp`.
- **Verification:** MCP Inspector's "List Tools" returns the three tools from Task 0.4.

### Task 0.4 — Three primitive tools (mocked)

- **Goal:** the brief's "code-mode style search/execute" surface plus a canvas opener — all mocked, just so the loop works.
- **Subtasks:**
  - `search(query: string)` → returns hardcoded `[{kind: "doc", title: "hello"}]`.
  - `execute(code: string)` → echoes `code` back; **must call the permission gate** (Task 2.1) once it exists. For now, marks itself `risk: high` in metadata.
  - `open_generated_ui(uri: string)` → returns an MCP-UI resource pointing at a static `widgets/hello.html`.
  - Each tool declared via `McpAgent`'s `server.tool(name, inputSchema, handler)` with Zod schemas.
- **Deliverable:** all three tools listed by MCP Inspector and round-trip successfully.
- **Verification:** verifier subagent connects MCP Inspector, calls each tool, confirms results.

### Task 0.5 — D1 schema + migration tooling

- **Goal:** the schemas from §08 of the brief are deployed and migratable.
- **Subtasks:**
  - Create `packages/worker/migrations/0001_init.sql` with: `memory`, `sessions`, `messages`, `messages_fts`, `plans`, `team_spawns`, `skills`, `audit`, `hooks` tables (exact DDL from §08).
  - Wire `bun run db:migrate:local` and `bun run db:migrate:remote` scripts.
  - Add a tiny seed file `0002_seed.sql` that inserts a sample memory row for smoke tests.
- **Deliverable:** `wrangler d1 execute FERMI_DB --local --file=migrations/0001_init.sql` succeeds.
- **Verification:** verifier runs `SELECT name FROM sqlite_master WHERE type='table'` and confirms all nine tables present.

### Task 0.6 — Connect to Claude desktop (manual loop)

- **Goal:** the brief's Phase 0 checkpoint — Claude desktop calls a Fermi tool end-to-end.
- **Subtasks:**
  - Deploy to `workers.dev` (`bun run --cwd packages/worker deploy`).
  - Document the MCP config block for Claude desktop's `Settings > Developer > Edit Config` in `/workspace/docs/connect-claude-desktop.md`.
  - Add a screenshot/transcript showing Claude desktop calling `search` successfully.
- **Deliverable:** manual confirmation of the loop.
- **Verification:** human checkpoint (the human owner runs the test).

### Phase 0 Checkpoint

> ✅ "I can ask Claude desktop 'use my agent to add a memory' and it works." — brief §09 Phase 0.

---

## Phase 1: Memory + sessions (Hermes-derived)

**Goal:** real cross-host memory with FTS5, embeddings, session capture, and nightly consolidation.

**Duration:** Week 3–5. **Risk:** low. **Default agent:** executor + researcher (for the consolidation prompt).

### Task 1.1 — Memory tools backed by D1

- **Inputs:** `/workspace/docs/extracts/hermes.md`.
- **Subtasks:**
  - Replace mock `search` with `memory.recall(query, limit?)` — D1 query against `memory` table, ranked by hybrid (FTS5 + embedding cosine).
  - Add `memory.write(kind, body, pinned?)` — inserts row, computes embedding via Workers AI binding (`AI.run('@cf/baai/bge-base-en-v1.5', {text: body})`), stores BLOB.
  - Add `memory.update(id, patch)`, `memory.delete(id)` (soft, sets `decayed_at`).
- **Deliverable:** four tools exposed via MCP.
- **Verification:** test from Task 1.6.

### Task 1.2 — Session capture middleware

- **Inputs:** brief §08 (sessions/messages tables).
- **Subtasks:**
  - Wrap the `McpAgent` connection lifecycle: on connect, insert `sessions` row; on disconnect, set `ended_at`.
  - On every tool call: insert `messages` rows (role=`user` for input, role=`assistant` for tool result preview).
  - The `host` field comes from a request header (`x-fermi-host`) or User-Agent fallback.
- **Deliverable:** every conversation produces a session + messages trail in D1.
- **Verification:** verifier connects from MCP Inspector, exchanges 3 turns, queries `SELECT count(*) FROM messages WHERE session_id = ?` and confirms the count.

### Task 1.3 — FTS5 search

- **Subtasks:**
  - Confirm `messages_fts` virtual table from Task 0.5 is correctly tied to `messages` via `content` and `content_rowid`.
  - Add `session.search(query, range?)` tool that runs `SELECT ... FROM messages_fts WHERE messages_fts MATCH ?`.
  - Add embedding-based reranking on the top-30 FTS5 results.
- **Deliverable:** `session.search("espresso machine")` returns relevant past turns from any host.
- **Verification:** smoke test in Task 1.6.

### Task 1.4 — Nightly memory consolidation (Cron Trigger)

- **Inputs:** `/workspace/docs/extracts/hermes.md` § "memory consolidation".
- **Subtasks:**
  - Implement the `nightly-memory-consolidation` cron handler.
  - For each session that ended in the last 24h: summarize via Workers AI (cheap model), write summary to `sessions.summary`.
  - Dedup near-duplicate `memory` rows (cosine ≥ 0.95) — keep the older, mark newer as `decayed_at = now`.
  - Apply linear decay scoring to non-pinned memories older than 90 days.
- **Deliverable:** `wrangler cron trigger nightly-memory-consolidation` works locally.
- **Verification:** seed three duplicate memories, run cron, confirm two are decayed.

### Task 1.5 — Per-phase tests

- **Subtasks:**
  - Add Vitest with `@cloudflare/vitest-pool-workers` to `packages/worker`.
  - Tests: `memory.write` round-trip, `memory.recall` ranking sanity, `session.search` FTS5 hit, cron consolidation dedup.
- **Deliverable:** `bun run test` passes; CI workflow added (`.github/workflows/ci.yml` — install Bun, run test).
- **Verification:** all green.

### Task 1.6 — Cross-host smoke test

- **Goal:** brief §09 Phase 1 checkpoint — fact stored from Claude Code is recalled in ChatGPT next session.
- **Subtasks:**
  - From Claude Code: call `memory.write` with a unique fact ("the user's preferred espresso bean is Onyx Coffee Lab Monarch").
  - From ChatGPT (Apps SDK / MCP connection): call `memory.recall("espresso bean")`, confirm the fact returns.
- **Verification:** human checkpoint (verifier subagent can't drive two MCP hosts; the human runs this).

### Phase 1 Checkpoint

> ✅ "Cross-host memory works. Search returns useful results in <500ms." — brief §09 Phase 1.

---

## Phase 2: Permission spine (Mercury-derived)

**Goal:** every tool declares scope + danger level. Destructive ops require approval. Audit + budget enforced.

**Duration:** Week 6–7. **Risk:** medium. **Default agent:** executor + verifier.

### Task 2.1 — Tool wrapper with declared scope

- **Inputs:** `/workspace/docs/extracts/mercury.md`.
- **Subtasks:**
  - Create `packages/worker/src/lib/tool.ts`: a higher-order `defineTool({name, schema, scope, risk, handler})` that wraps `server.tool` and adds metadata.
  - `scope`: `"read"` | `"write:<path-glob>"` | `"network"` | `"shell"` | `"browser:cloud"` | `"browser:local"`.
  - `risk`: `"low"` | `"med"` | `"high"`.
  - All existing tools (Phase 0 + Phase 1) get migrated to `defineTool`.
- **Deliverable:** every tool returns its metadata via `tool.metadata` for inspection.
- **Verification:** unit test confirms metadata round-trip.

### Task 2.2 — Approval flow

- **Subtasks:**
  - On tool call: if `risk === "high"` and no `approval_token` in args, return `{ status: "pending_approval", token: <uuid>, prompt: "<human-readable diff>" }`.
  - Token TTL: 5 min, stored in KV under `approval:<token>`.
  - User re-invokes the same tool with `approval_token` argument — gate validates and proceeds.
  - Approval can also be granted by reply to a Telegram message (Phase 4 will wire this).
- **Deliverable:** `execute({code: "rm -rf /"})` returns `pending_approval`; with token, it (still) refuses because of the blocklist (Task 2.3).
- **Verification:** test in Task 2.6.

### Task 2.3 — Shell blocklist

- **Subtasks:**
  - Implement a regex/glob blocklist: `sudo`, `rm -rf /`, `rm -rf ~`, `dd if=`, `mkfs`, `> /dev/sd*`, `:(){:|:&};:` (fork bomb), unrestricted `curl | sh`, etc.
  - The blocklist runs **before** approval-token check — these are never allowed.
  - Blocklist rules live in `packages/worker/src/lib/shell-blocklist.ts` with explanatory comments per rule.
- **Deliverable:** blocklisted commands return a `denied` audit row with the matched rule.
- **Verification:** unit test for each rule.

### Task 2.4 — Folder-scoped fs tools

- **Subtasks:**
  - Implement `fs.read(path)`, `fs.write(path, body)`, `fs.list(prefix)` against R2.
  - `permission:fs.write:scope` in KV is a JSON array of allowed prefixes (`["/notes", "/projects"]` from the brief).
  - Out-of-scope paths return `denied` immediately.
- **Deliverable:** `fs.write("/etc/passwd", ...)` returns `denied`.
- **Verification:** test.

### Task 2.5 — Audit log + daily-budget counter

- **Subtasks:**
  - Every tool call writes an `audit` row (regardless of outcome).
  - KV counters `budget:YYYY-MM-DD` track tokens-in/tokens-out per day.
  - System-prompt middleware: above 70% of `config:budget.daily`, prepend "Be concise; the user is over budget today."
  - Above 100%: tool calls that consume tokens (Pattern B/C inference) refuse with `budget_exhausted`.
- **Deliverable:** `bun run audit:tail` script tails recent rows.
- **Verification:** test that 100% budget triggers refusal on a Telegram-style invocation (mocked here, real in Phase 4).

### Task 2.6 — Red-team checkpoint

- **Goal:** brief §09 Phase 2 checkpoint.
- **Subtasks:**
  - Spawn a **verifier subagent** (manual `team.spawn` will land in Phase 5; for now, this is a separate Claude Code session) with the explicit goal: "Try to make Fermi `rm -rf` something or write outside scope. Report PASS/FAIL/PARTIAL."
  - Document the attack attempts in `/workspace/docs/redteam-phase2.md`.
- **Deliverable:** verdict PASS.
- **Verification:** human signoff.

### Phase 2 Checkpoint

> ✅ "Manual red-team: try to make the agent rm -rf or write outside scope. It refuses." — brief §09 Phase 2.

---

## Phase 3: Live Canvas (OpenClaw-derived)

**Goal:** agent-driven UI surface that persists across turns and works in MCP-UI hosts (ChatGPT Apps SDK, Claude desktop).

**Duration:** Week 8–10. **Risk:** medium. **Default agent:** executor + writer.

### Task 3.1 — Durable Object for canvas state

- **Inputs:** `/workspace/docs/extracts/openclaw.md`, `/workspace/docs/extracts/cloudflare-stack.md` § widget pipeline.
- **Subtasks:**
  - Implement `LiveCanvasDO` class. Storage: `state` (JSON), `history` (append log), `subscribers` (WebSocket connections).
  - Methods: `getState()`, `applyPatch(patch)`, `subscribe(ws)`.
  - Snapshot to R2 every N writes for durability.
- **Deliverable:** unit test confirms state persistence across DO eviction.

### Task 3.2 — Widget bundle pipeline (Remix 3 + Vite)

- **Inputs:** `/workspace/docs/extracts/cloudflare-stack.md` § widget pipeline (cloudflare-remix-vite-mcp).
- **Subtasks:**
  - Set up `packages/widgets/` with `vite.config.widgets.ts`. Output bundles to `packages/worker/dist/public/widgets/<name>.js`.
  - First widget: `today-dashboard` — shows today's reminders + recent memories + quick actions.
  - Wire `_meta.ui.resourceUri` and CSP settings (MCP Apps standard).
- **Deliverable:** `bun run --cwd packages/widgets build` produces a working bundle.

### Task 3.3 — `open_generated_ui` (real)

- **Subtasks:**
  - Replace Phase 0's mock with real impl. The tool returns a `resource` block pointing at the widget URL with `_meta.ui.resourceUri` and a fresh `canvas_id`.
  - Worker route `/canvas/:id` serves the widget HTML, instantiates a `LiveCanvasDO`, opens a WebSocket.
- **Deliverable:** opening the canvas in ChatGPT renders the dashboard.

### Task 3.4 — Two-way bridge (Kent's pattern)

- **Inputs:** `cloudflare-remix-vite-mcp` calculator widget (the Tron easter-egg pattern).
- **Subtasks:**
  - Widget side: `App.connect()` via the MCP Apps JSON-RPC bridge.
  - Widget can post messages back to the agent via `ui/notifications/tool-input` (or equivalent).
  - Agent side: receives the message, can update state via `canvas.update(canvas_id, patch)` tool.
- **Deliverable:** clicking a button in the dashboard fires a tool call back to the agent.

### Task 3.5 — Persistence + recovery

- **Subtasks:**
  - On each significant state change, write a snapshot to `R2://canvas/<canvas_id>.json`.
  - Refresh path: re-instantiate DO from R2 if storage is empty.
- **Verification:** open canvas, refresh browser, state survives.

### Task 3.6 — Tests

- Vitest tests for DO persistence, widget render snapshot, websocket message round-trip.

### Phase 3 Checkpoint

> ✅ "I open a canvas in ChatGPT, it survives a refresh, and updates from Claude desktop are reflected." — brief §09 Phase 3.

---

## Phase 3.5: Browser surface — dual-mode

**Goal:** cloud lane (headless, autonomous) and local lane (headed, authenticated). Permission rules know the difference.

**Duration:** Week 11. **Risk:** high (local lane touches real identity). **Default agent:** executor + verifier.

### Task 3.5.1 — Cloud lane via Browser Rendering binding

- **Subtasks:**
  - Wire `MYBROWSER` binding in handlers.
  - Implement `browser.cloud.navigate`, `.click`, `.fill`, `.extract`, `.screenshot` against `@cloudflare/puppeteer`.
  - All `browser.cloud.*` tools default to `risk: low`, scope: `"network"` + `"browser:cloud"`.
- **Deliverable:** scrape a public site (e.g. example.com), extract title, screenshot.
- **Verification:** test.

### Task 3.5.2 — Local headed bridge

- **Inputs:** brief §04 "The local bridge — minimal shape".
- **Subtasks:**
  - Create `packages/bridge/` (a small Node + Playwright process — not deployed to Cloudflare; runs on the human's Mac).
  - Implements the WebSocket protocol from the brief: receive `{id, op, args}`, run on a persistent Chromium profile, return `{id, ok, result}`.
  - Heartbeat every 5s. Updates KV `bridge:online` flag.
  - **Dedicated Chromium profile** — **not** the user's everyday browser. The bridge launches `~/Library/Application Support/Chromium/FermiProfile`.
  - Bridge auth: `BRIDGE_KEY` env var, rotated weekly.
- **Deliverable:** `bun run --cwd packages/bridge dev` connects to deployed Worker via Cloudflare Tunnel; KV flag flips to `1`.

### Task 3.5.3 — `browser.local.*` tools + routing logic

- **Subtasks:**
  - Mirror the cloud-lane tool surface: `browser.local.navigate`, `.click`, `.fill`, `.extract`, `.takeover`.
  - `.takeover` sends a notification to the user, pauses bridge, lets user drive Chrome manually for N minutes.
  - Routing logic in Worker: `browser.local.*` requires bridge online; queue + Telegram-ping if offline.
  - **All `browser.local.*` tools default to `risk: high`** unless the origin is in `permission:browser.local:approved_origins`.
- **Deliverable:** local bridge can navigate to a logged-in site (e.g. github.com) and scrape user data.
- **Verification:** verifier confirms permission gate fires for non-approved origins.

### Task 3.5.4 — First skill: `web-research.md`

- **Subtasks:**
  - Create `R2://skills/web-research.md` — a Markdown skill with structured frontmatter (`name`, `description`, `allowed_tools`, `triggers`).
  - The skill body teaches multi-source synthesis, citation, dedup. Cloud-lane only.
  - Skill is registered in D1 `skills` table.
- **Deliverable:** invoking "research the best espresso machines under $1500" follows the skill.

### Phase 3.5 Checkpoint

> ✅ "Cron task scrapes a public site cleanly via cloud. A bill-pay flow waits for me to approve, then runs headed and I watch it." — brief §09 Phase 3.5.

---

## Phase 4: Channels + unattended inference

**Goal:** Telegram and Slack reach the same agent. Worker calls Anthropic Haiku for the inference loop. Workers AI fallback.

**Duration:** Week 12–13. **Risk:** medium. **Default agent:** executor.

### Task 4.1 — Telegram webhook + Pattern B inference

- **Inputs:** `/workspace/docs/extracts/openclaw.md` § Telegram + DM-pairing.
- **Subtasks:**
  - Worker route `/tg/webhook` validates Telegram signature, routes to a `runAgentTurn` function.
  - `runAgentTurn` implements the tool-loop **manually** (Pattern B from brief §03): calls `anthropic.messages.create({...tools, messages})`, executes any tool calls, loops until `stop_reason === "end_turn"`.
  - Channel allowlist: `channel:tg:allowlist` in KV.
  - Unknown sender: Telegram prompts a one-time pairing code that the user must echo from a connected MCP host (DM-pairing pattern from OpenClaw).

### Task 4.2 — Slack Events API webhook

- **Subtasks:**
  - Same shape as Telegram: webhook validation, runAgentTurn, allowlist.
  - Both DMs and `@fermi` mentions in channels are accepted (per allowlist).

### Task 4.3 — Workers AI fallback (Pattern C)

- **Subtasks:**
  - When Anthropic budget is exhausted (Phase 2 budget gate fires), `runAgentTurn` falls back to Workers AI's hosted Llama-class model.
  - Fallback explicitly tells the user: "Switching to fallback model — replies may be lower-quality."

### Task 4.4 — Cron-triggered daily brief

- **Subtasks:**
  - New cron `daily-brief` (configurable time per channel).
  - Pulls last 24h of memories + reminders + skill proposals, summarizes via Workers AI, posts to chosen channel.
  - Channel chosen via `config:daily_brief:channel` in KV.

### Task 4.5 — OAuth hardening (full)

- **Subtasks:**
  - Replace dev bearer token with full OAuth via `@cloudflare/workers-oauth-provider`.
  - GitHub OAuth provider for the human owner; allowlist via `me@<domain>`.
  - `wrangler secret put COOKIE_ENCRYPTION_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

### Task 4.6 — Tests

- Webhook signature validation, allowlist enforcement, pairing-code flow, budget fallback to Workers AI.

### Phase 4 Checkpoint

> ✅ "Telegram me at 2am, get a useful answer that uses my memory and respects budget." — brief §09 Phase 4.

---

## Phase 5: Plan mode + agent team + hooks + skill distillation

**This is the keystone phase.** The brief calls these "four features in one" — ship them together.

**Duration:** Week 14–17. **Risk:** high. **Default agent:** planner → executor → verifier (this phase deliberately exercises its own machinery).

### Task 5.1 — Session.mode state machine

- **Inputs:** `/workspace/docs/extracts/free-code.md` § plan mode.
- **Subtasks:**
  - Add `mode` column to `sessions` (already in §08 schema). Default `"chat"`.
  - Two MCP tools: `session.set_mode("chat" | "plan")` (the agent calls this) and `plan.approve(plan_id)` (the user calls this).
  - **Asymmetric authority:** `session.set_mode("plan")` requires no approval. `session.set_mode("execute")` is **only** reachable through `plan.approve`.
  - In plan mode, `runAgentTurn` swaps the system prompt to the plan-mode template and **filters the tool list** to the read-only set before sending to the model.

### Task 5.2 — Read-only tool partition

- **Subtasks:**
  - Each tool registered via `defineTool` declares `mutates: boolean`.
  - In plan mode, tools where `mutates === true` are removed from the registry returned to the model.
  - **Critical:** mutating tools must be uncallable, not "asked nicely not to call." The model never sees them in plan mode.

### Task 5.3 — `plan.draft` tool (the agent's planning surface)

- **Subtasks:**
  - In plan mode, the agent must call `plan.draft({steps: PlanStep[]})` to commit a plan.
  - The plan is persisted to D1 `plans` table + an R2 file at `R2://plans/<plan_id>.json` (resume-from-cursor pattern).
  - Plan exit produces a tool result that mirrors free-code's `ExitPlanModeV2Tool` output: surfaces the plan for approval, mentions team-spawn opportunities if `team.spawn` is available.

### Task 5.4 — `team.spawn` tool (single delegation tool)

- **Inputs:** `/workspace/docs/extracts/free-code.md` § agent team.
- **Subtasks:**
  - One MCP tool: `team.spawn({role, instructions, allowed_tools?, team_name?})`.
  - Routing logic mirroring free-code's `AgentTool.call()`:
    1. If `team_name + name` present → full team spawn (write to mailbox, append task list).
    2. Else if `subagent_type` is omitted and fork is enabled → fork (inherit parent context).
    3. Else → typed standalone subagent (default).
  - Each spawn = a Cloudflare **Workflow** step. Private scratchpad in `team_spawns.scratchpad` (D1). Final report in `team_spawns.report` — only the report is returned to the parent.
  - Hard caps: `team:max_concurrent = 3`, `team:max_depth = 2`. These are KV-backed counters checked on every spawn.

### Task 5.5 — Six starter roles in R2

- **Subtasks:**
  - Write Markdown files to `R2://roles/`:
    - `researcher.md` (read-only, browser.cloud.* + memory.recall + web_search)
    - `explorer.md` (read-only filesystem walk + memory.recall)
    - `writer.md` (memory.recall + fs.write to scoped paths)
    - `verifier.md` (browser.cloud.* + web_search; **adversarial posture from `/workspace/docs/extracts/free-code.md` § verification agent**; outputs `VERDICT: PASS|FAIL|PARTIAL`)
    - `planner.md` (no tools — pure thinking)
    - `executor.md` (whatever the plan permits — gated per-step)
- **Hard rule:** the prompt strings are written from scratch. Free-code's prompts are read for shape only.

### Task 5.6 — Auto-verifier injection

- **Subtasks:**
  - When `plan.draft` is called: scan steps for `risk: "high"`. If any, automatically append a final step `team.spawn({role: "verifier", instructions: "Re-verify steps 1–N. Output VERDICT line."})`.
  - User sees the verifier step in the approval surface.

### Task 5.7 — Hook executor

- **Inputs:** `/workspace/docs/extracts/free-code.md` § hooks.
- **Subtasks:**
  - Implement events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart`. (Subset of free-code's 27 — others can be added later if needed.)
  - Hooks registry: D1 `hooks` table. CRUD via `hooks.register`, `hooks.list`, `hooks.test` MCP tools (the test tool is read-only at runtime — fires the hook but in dry-run mode).
  - Aggregation loop: hooks for an event run in parallel. Permission precedence **`deny > ask > allow`** (verbatim from free-code).
  - Hooks can: emit message, raise blocking error, return permission decision, inject context, modify input.
  - Source layering: user-global (KV) > project (R2) > session (DO) — most-specific scope wins ties; permission precedence overrides scope.

### Task 5.8 — Hook safety controls

- **Inputs:** `/workspace/docs/extracts/free-code.md` § "security controls we adopt verbatim".
- **Subtasks:**
  - **Workspace trust gate:** KV `trust:<workspace_id>` must be `1`. One-time accept dialog on first connect.
  - **SSRF guard for HTTP hooks:** outbound URLs from hooks must be on a domain allowlist; header values only interpolate explicitly-listed env vars.
  - **Source dedup:** same `(matcher, command)` across overlapping scopes is deduplicated.
  - **Async hooks** via Cloudflare Workflows (Workflow per async hook).
  - **Once-hooks:** auto-disable after first fire.
  - **`if`-condition filtering:** hooks declare a permission-rule pattern (e.g. `"Bash(git *)"`) so they only fire for matching tool calls.

### Task 5.9 — Skill distillation cron

- **Subtasks:**
  - New cron `weekly-skill-distillation` (Sunday night).
  - Cluster the last 7 days of `sessions` + `team_spawns` in D1 by embedding similarity. Min cluster size = 3.
  - For each cluster, Workers AI drafts a candidate `SKILL.md` with frontmatter.
  - Stage in `R2://skills-staging/<slug>.md`. Add a row to `skills` table with `created_by = "agent"` and `pending_review = 1`.
  - Telegram digest message: "This week I learned X. I propose this skill: <slug>. Reply ✓ to accept, ✗ to reject."

### Task 5.10 — Skill review surface in canvas

- **Subtasks:**
  - New widget: `skill-review`. Lists pending skills, lets user accept/reject/edit.
  - On accept: move `R2://skills-staging/<slug>.md` → `R2://skills/<slug>.md`, register as MCP resource, set `pending_review = 0`.

### Task 5.11 — Worked-example test

- **Goal:** brief §05 worked example must work end-to-end.
- **Subtasks:**
  - From Telegram in plan mode: "Find the three best espresso machines under $1500 in stock today and draft a comparison post."
  - Confirm the agent enters plan mode, drafts the 5-step plan, auto-appends a verifier (because `fs.write` is `risk: med` for `/drafts`).
  - User replies ✓. Execution runs. 3 researcher subagents run in parallel. 1 verifier runs. Writer drafts. memory.write at end.
  - Two user-defined hooks intercept (e.g. `PostToolUse:fs.write` → secret-scrub; `Stop` → memory-extract-async).
- **Verification:** human checkpoint.

### Task 5.12 — Tests

- Plan mode tool-filter, plan-approval state machine, team.spawn isolation (parent doesn't see child's intermediate calls), hook precedence aggregation, SSRF guard, skill distillation clustering.

### Phase 5 Checkpoint

> ✅ "Multi-step plan with 3 spawned subagents executes from a Telegram approval, intercepted by 2 user-defined hooks. After 2 weeks of real use, agent proposes a real skill that I accept." — brief §09 Phase 5.

---

## Cross-cutting tasks (run during every phase)

### CC.1 — Per-phase Vitest + CI

- Each phase adds tests covering the new surface area.
- CI workflow runs `bun install && bun run test` on every push.
- No phase exits with a failing CI.

### CC.2 — Audit log review

- Verifier subagent at end of each phase reviews `audit` table for the phase's date range. Looks for: tools that bypassed the permission gate, denied calls without a clear reason, abnormal token spend.

### CC.3 — Documentation per phase

- Each phase ends with `/workspace/docs/phase-N.md` summarizing what shipped, what changed, and any deviations from this plan.

### CC.4 — Memory of memory

- After Phase 1 lands, the agent itself records every phase completion as a `memory` row of `kind = "event"`. By Phase 5, the agent should be able to recall its own development history when asked.

---

## Risks & open questions (mirror brief §10)

These are tracked in `/workspace/docs/open-questions.md` and revisited at every phase boundary. The plan does not pretend to resolve them now:

1. Where the canvas actually renders (ChatGPT vs Claude desktop capability gap) — answer in Phase 0 compatibility test.
2. Model-agnostic unattended inference (Anthropic vs DeepSeek vs Workers AI cost/quality) — answer in Phase 4.
3. Memory decay curve — start linear-90-days, revisit after 1 month live.
4. Cloud browser provider (CF Browser Rendering vs Browserbase) — start CF, fall back to Browserbase only for stealth-needed sites.
5. Skills Hub timing — parked until ≥10 user-accepted skills.

---

## Resources the agent team needs

- **Cloudflare account** with Workers Paid + Browser Rendering enabled.
- **Anthropic API key** in `wrangler secret put ANTHROPIC_API_KEY`.
- **OpenAI API key** (optional Pattern B fallback).
- **Telegram bot** via BotFather → `TELEGRAM_BOT_TOKEN`.
- **Slack workspace + bot app** → `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`.
- **Local Mac** with Node 20+, Bun, Wrangler CLI, MCP Inspector, Playwright, dedicated Chromium profile for the bridge.
- **Connected hosts** for testing: Claude desktop, Claude Code, ChatGPT (Apps SDK), Cursor.
- **Read-only `/context/`** with: hermes-agent, mercury-agent, openclaw, free-code, kody, cloudflare-remix-vite-mcp, plus any others the human places there.

---

## End-state success criteria (mirror brief §01)

The plan is "done" when **all seven** of these are true:

1. ✅ Fermi connects to ChatGPT, Claude desktop, and Claude Code with the same memory.
2. ✅ A 30-message Claude Code session ends → summary in memory → retrievable from ChatGPT next morning.
3. ✅ DM on Telegram → response uses the same memory and skills.
4. ✅ A destructive `execute` blocks and asks for explicit approval, visible in any host.
5. ✅ A complex research task: plan mode → 3 researcher subagents in parallel → verifier → execute from Telegram approval → 2 user-defined hooks fire.
6. ✅ After 3 successful sessions of the same kind, the agent proposes a new skill.
7. ✅ A `PreToolUse` hook on `browser.local.*` enforces a per-origin allowlist the model cannot circumvent.

---

*End of plan. Start with Phase −1, Task −1.1. The verifier role is the team's conscience — use it liberally.*
