# Replicate kody's `execute` and `search` patterns in fermi (full parity)

## Context

Fermi today exposes 23 MCP tools but its two most powerful surfaces are stubs: `execute` returns `[mock] Would execute: ...` and `search` returns hardcoded mock results. Adding a secret like `GITHUB_TOKEN` doesn't actually buy GitHub access, because no code path reads it.

Kody (`kentcdodds/kody`) — fermi's architectural reference — has the missing piece: an ESM-module sandbox where the agent writes code, calls registered capabilities via `codemode.<name>(...)`, and uses `fetch()` with `{{secret:NAME}}` placeholders that get expanded **only at the network boundary, only for pre-approved hosts**. `search` is the matching discovery surface — agents find capability names with `query`, then fetch a capability's schema with `entity: "{name}:capability"`.

**User-approved decisions (do not re-litigate):**
1. **Sandbox**: `DynamicWorkerExecutor` from `@cloudflare/codemode@0.3.4` (npm-public, verified). Kody parity, true isolate.
2. **Scope**: full kody parity, staged so each phase is independently shippable.
3. **Secrets**: D1 + AES-GCM encryption with per-secret `allowed_hosts` / `allowed_capabilities` columns.

**Outcome milestone:** end of Phase 4, the agent can run inside `execute`:
```js
const r = await fetch('https://api.github.com/user/repos', {
  headers: { Authorization: 'Bearer {{secret:GITHUB_TOKEN}}' }
})
return await r.json()
```
…and the GitHub repos come back. This is the demo the user explicitly asked about.

---

## Phase 0 — Pre-flight (~half day)

Three external dependencies must be confirmed before code lands:

- **`worker_loaders` binding** is closed-beta on Cloudflare. The fermi account (`example.workers.dev`) needs access. Confirm via `wrangler dev` with a stub binding — if it errors, request access first.
- **Vectorize** requires Workers Paid plan. If fermi is Free, defer Phase 6 and use D1 BLOB cosine similarity over the existing `memory.embedding` column.
- **Add `FERMI_SECRETS_KEY`** Worker secret (32 bytes hex): `wrangler secret put FERMI_SECRETS_KEY --config packages/worker/wrangler.jsonc`. Used as KDF input for AES-GCM.

If any of these fail, surface to user before Phase 1.

---

## Phase 1 — Secrets store + admin tools (~1.5 days)

Establish the substrate. Nothing reads secrets yet, but the user can store one.

**New files:**
- `packages/worker/src/lib/crypto.ts` — `encryptSecret(plaintext, env)` / `decryptSecret(record, env)`, AES-GCM via `crypto.subtle`, key derived from `FERMI_SECRETS_KEY` with HKDF-SHA256.
- `packages/worker/src/lib/secrets-store.ts` — `getSecret`, `listSecrets` (metadata only — never returns plaintext), `putSecret`, `deleteSecret`, `addAllowedHost`.
- `packages/worker/src/mcp/tools/secrets.ts` — MCP tools: `secret_set`, `secret_list`, `secret_delete`, `secret_approve_host`. All `risk:'high'` except `secret_list` (`risk:'low'`).

**New migration** `packages/worker/migrations/0004_secrets.sql`:
```sql
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('user','app','session')),
  session_id TEXT NOT NULL DEFAULT '',
  encrypted_value BLOB NOT NULL,
  iv BLOB NOT NULL,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  allowed_capabilities TEXT NOT NULL DEFAULT '[]',
  allowed_packages TEXT NOT NULL DEFAULT '[]',
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, scope, session_id)
);
CREATE INDEX IF NOT EXISTS secrets_scope ON secrets(scope);
```

**Modify:**
- `packages/worker/src/mcp/register-tools.ts` — call `registerSecretTools(agent)`.
- `packages/worker/worker-configuration.d.ts` — add `FERMI_SECRETS_KEY: string`.

**Verification:**
```bash
wrangler dev
# JSON-RPC tools/call secret_set name=GITHUB_TOKEN value=ghp_xxx scope=app allowed_hosts=["api.github.com"]
# Returns pending_approval token; resubmit with approval_token to commit.
wrangler d1 execute fermi --command "SELECT name, scope, allowed_hosts FROM secrets"
# Confirms encrypted row exists; secret_list returns metadata only.
```

---

## Phase 2 — Capability registry (~2 days)

Capabilities are agent-callable from inside `execute`, distinct from MCP tools but sharing the same permission spine.

**Refactor first:** extract the wrapper body of `defineTool` in `packages/worker/src/lib/tool.ts` into a private `runWithGuardrails(def, args, env, agentState)` helper. `defineTool`'s public API doesn't change. The new helper is the kernel reused by `defineCapability`.

**New files:**
- `packages/worker/src/lib/capability.ts` — `defineCapability(def)`, `getCapabilityRegistry()`, `getCapability(name)`, `invokeCapability(name, args, env, agentState)`. Capability shape: `{name, domain, description, inputSchema (zod), outputSchema?, handler, scope, risk, readOnly?, idempotent?, destructive?, keywords?, tags?}`. Handles `x-kody-secret: true` annotation on schema fields by scanning args for `{{secret:NAME}}` and resolving via `getSecret()` with `allowed_capabilities` enforcement.
- `packages/worker/src/capabilities/index.ts` — barrel `registerAllCapabilities()`.
- `packages/worker/src/capabilities/{memory,fs,fetch}.ts` — initial three: `memory_recall`, `memory_write`, `fs_read`, `fs_list`, `fetch_url`. Handlers delegate to shared store helpers in `lib/`.

**Refactor existing tool handlers** so the side-effect logic lives in `lib/memory-store.ts` / `lib/fs-store.ts`, callable by both `defineTool` and `defineCapability`. No MCP behavior change.

**Modify:** `packages/worker/src/mcp/index.ts` — call `registerAllCapabilities()` once on init.

**Plan-mode handling:** capabilities can only be invoked from inside `execute`, which is `mutates:true`. So plan mode blocks `execute` entirely → capabilities are implicitly unreachable. No second gate needed.

**Verification:** debug-only `/capabilities` route (gated by `FERMI_BEARER_TOKEN`) returns the registry as JSON. Curl confirms 5 capabilities present with schemas.

---

## Phase 3 — Sandbox runtime: DynamicWorkerExecutor (~3 days)

Replace `execute.ts` mock. Agent code runs in an isolated sub-Worker.

**Wrangler/deps:**
- `package.json`: add `@cloudflare/codemode@^0.3.4`, `acorn@^8.12.0`, `acorn-walk@^8.3.0`.
- `wrangler.jsonc`: `"worker_loaders": [{ "binding": "LOADER" }]`.
- `worker-configuration.d.ts`: add `LOADER: WorkerLoader` (hand-typed if `@cloudflare/workers-types` doesn't yet ship the closed-beta interface).

**New files:**
- `packages/worker/src/sandbox/parse.ts` — `hasTopLevelModuleSyntax(source)` via acorn.
- `packages/worker/src/sandbox/bundle.ts` — resolves `import {...} from 'fermi:runtime'` to a virtual module reading `globalThis.__fermiRuntime`. (Renaming `kody:` → `fermi:` for branding.)
- `packages/worker/src/sandbox/runtime-shim.ts` — generates the JS string injected into the loaded Worker exposing `codemode`, `params`, `storage` (storage stubbed in this phase).
- `packages/worker/src/sandbox/executor.ts` — `runUserCode({source, params, env, agentState})`. Calls `LOADER.get(...)` to materialize the Worker. Capability calls inside the sandbox become `fetch('fermi-rpc://capability/<name>', ...)` to a parent-side dispatcher that calls `invokeCapability(...)`.
- `packages/worker/src/sandbox/rpc.ts` — JSON-RPC framing for cross-Worker capability dispatch.

**Modify:** `packages/worker/src/mcp/tools/execute.ts` — replace mock body with `runUserCode(...)`. Keep `isBlocked` shell pre-check as a defense-in-depth guard. Stays `risk:'high'`, `mutates:true`.

**Verification:**
```bash
# tools/call execute code='const r = await codemode.memory_recall({query:"fermi",limit:3}); return r;'
# pending_approval → approve → returns real D1 rows.
# audit table: execute=ok plus a memory_recall=ok row from the capability invocation.
```

End of Phase 3: sandbox runs and capabilities work, but raw `fetch()` to `api.github.com` with `{{secret:...}}` still hits the literal placeholder string (401). Phase 4 closes that.

---

## Phase 4 — Fetch gateway: secret expansion + host allowlist (~2 days) — **GitHub demo lights up**

All sandbox `fetch()` calls go through an EntryPoint that expands `{{secret:NAME[|scope=...]}}` and enforces `allowed_hosts` per-secret.

**New files:**
- `packages/worker/src/sandbox/fetch-gateway.ts` — exported EntryPoint class. For each request:
  1. Scan URL + every header value + (text) body for `/\{\{secret:([a-zA-Z0-9._-]+)(?:\|scope=(session|app|user))?\}\}/g`.
  2. For each match: `getSecret(name, scope, sessionId, env)`, check `new URL(req.url).host` ∈ `record.allowed_hosts`. Miss → throw `{error:'host_not_approved', secret, host, approval_url}`.
  3. Substitute, then `fetch(req)`.
  4. Audit-log the gateway pass (sample if volume becomes a problem; see Risks).

**Modify:**
- `packages/worker/src/index.ts` — export `CodemodeFetchGateway`; add `POST /secrets/approve` route consuming the approval token.
- `packages/worker/src/sandbox/executor.ts` — pass `outboundService: env.SELF` (or named binding) to the loader so all sandbox `fetch` traffic flows through the gateway.

**Verification — the GitHub end-to-end demo:**
```bash
# 1. Token already stored from Phase 1.
# 2. tools/call execute code='
#      const r = await fetch("https://api.github.com/user/repos?per_page=3", {
#        headers: { Authorization: "Bearer {{secret:GITHUB_TOKEN}}" }
#      })
#      return await r.json()
#    '
# Returns the user's actual GitHub repos.
# 3. Negative test: fetch to api.openai.com with same token →
#    { error:'host_not_approved', host:'api.openai.com', approval_url:'...' }
```

This is the milestone the user called out.

---

## Phase 5 — `search` revamp: entity-detail + lexical RRF (~2 days)

Replace the mock `search.ts`. Two modes: `entity: "{id}:{type}"` for exact lookup, `query` for ranked unified search. Vectorize deferred to Phase 6.

**Schema:**
```ts
{
  entity: z.string().optional(),
  query: z.string().optional(),
  types: z.array(z.enum(['capability','package','value','connector','secret','memory'])).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  memoryContext: z.object({
    task: z.string().optional(),
    query: z.string().optional(),
    entities: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional()
  }).optional()
}
```

**New files:**
- `packages/worker/src/lib/capability-fts.ts` — in-memory token-trigram index over capability `{name, description, keywords}`, built once at registry init (registry is in-process; FTS5 over a table would be overkill).
- `packages/worker/src/lib/rrf.ts` — `reciprocalRankFusion(rankedLists, k=60)`.
- `packages/worker/src/lib/memory-context.ts` — `loadRelevantMemoriesForTool(memoryContext, env)`, called when `memoryContext` provided. Uses existing `memory` table.
- `packages/worker/src/mcp/tools/meta.ts` — new `meta_list_capabilities` MCP tool (`risk:'low'`) returning the raw registry.

**Modify:** `packages/worker/src/mcp/tools/search.ts` — full rewrite. Entity-detail mode dispatches to capability registry / `secrets` table / `memory` rows. Ranked mode runs parallel candidate builders (capability name match, capability FTS, `memory` LIKE, `messages_fts` MATCH (existing), secret-name match) → RRF combine. Output: `{matches[], offline:false, warnings[], guidance[], telemetry:{durationMs, candidateCounts}, memories?[]}`.

**Verification:**
- `search query="github"` returns `fetch_url` capability + memory hits.
- `search entity="memory_recall:capability"` returns full input schema, scope, risk.
- `search query="" types=["capability"]` falls back to enumeration.

---

## Phase 6 — Vectorize integration (~2 days)

Semantic ranking for capability search and memory recall.

**Wrangler:** `"vectorize": [{ "binding": "FERMI_VECTORIZE", "index_name": "fermi-capabilities" }]`. One-time: `wrangler vectorize create fermi-capabilities --dimensions=384 --metric=cosine` (BGE-base, matches existing `memory.embedding` dim).

**New files:**
- `packages/worker/src/lib/embeddings.ts` — `embedText(text, env)` via `AI.run('@cf/baai/bge-base-en-v1.5')` with deterministic FNV1a fallback when `AI` errors.
- `packages/worker/src/cron/capability-reindex.ts` — cron handler that re-embeds capability descriptions and upserts to Vectorize, idempotent via stable IDs.

**Modify:**
- `wrangler.jsonc` — add cron `"0 */6 * * *"` for capability reindex.
- `packages/worker/src/index.ts` — wire the cron into `scheduled()`.
- `packages/worker/src/mcp/tools/search.ts` — add Vectorize candidate builder; mix into RRF; set `offline:true` on AI errors.

**Verification:** `wrangler dev --test-scheduled` triggers reindex; `search query="store a fact about my user"` ranks `memory_write` highly without keyword overlap.

---

## Phase 7 — Storage binding (DO-backed durable state for `execute`) (~1.5 days)

Sandboxed code persists state via `storage.get/put/list/delete/sql`.

**New files:**
- `packages/worker/src/do/sandbox-storage.ts` — `SandboxStorageDO extends DurableObject`, sqlite-backed (matches existing `FermiMCP` / `LiveCanvasDO` `new_sqlite_classes` pattern).

**Modify:**
- `packages/worker/src/sandbox/runtime-shim.ts` — expose real `storage.*` proxy via `fermi-rpc://storage/...` to the parent dispatcher.
- `wrangler.jsonc` — add DO binding `SANDBOX_STORAGE` with class migration tag bumped.
- `packages/worker/src/index.ts` — export `SandboxStorageDO`.

**Verification:** `execute code='await storage.put("counter", (await storage.get("counter") ?? 0) + 1); return await storage.get("counter");'` returns 1, 2, 3 across runs in same session.

---

## Phase 8 — Wrap remaining 18 tools as capabilities (~1 day)

For `memory_update`, `memory_delete`, `fs_write`, `browser_*`, `canvas_*`, `open_generated_ui`, `session_search`, `session_set_mode`, `plan_*`, `team_spawn`, `hooks_*`, `secret_*`: refactor handler bodies into shared `lib/*-store.ts` / `orchestration/*.ts` modules. Both `defineTool` and `defineCapability` reference the same function. No code duplication.

**New files:** `packages/worker/src/capabilities/{browser,canvas,session,plan,hooks,team,secrets-cap}.ts`.

**Verification:** `meta_list_capabilities` returns 23+ capabilities. Run `execute` script chaining 3 capabilities; audit log shows all with proper risk levels.

---

## Phase 9 — Parity catch-up (~3–5 days, splittable)

Each is a separate sub-PR.

- **9a Packages** — `packages` D1 table; sandboxed `await import('package:slug')` via bundler.
- **9b Connectors** — `(capability + secret + base_url)` triples; surfaces in `search` as a separate entity.
- **9c Retrievers** — named query builders auto-registered as capabilities.
- **9d OAuth helpers** — per-capability OAuth bootstrap (worker route + state token in KV).

---

## Files to reuse (don't reinvent)

| Path | Why |
|---|---|
| `packages/worker/src/lib/tool.ts` | Extract `runWithGuardrails`; capabilities reuse the same permission/audit/hook plumbing |
| `packages/worker/src/orchestration/hooks.ts` | `executeHooks('tool:before' \| 'tool:after', ...)` — capabilities fire these too |
| `packages/worker/migrations/0001_init.sql` `audit` table | Capability invocations write rows here, same shape as tool calls |
| `packages/worker/src/mcp/tools/session-search.ts` | Existing FTS5 query pattern — reuse for `search`'s messages_fts candidate builder |
| `packages/worker/src/mcp/tools/memory.ts` | Source for `lib/memory-store.ts` extraction; existing `embedding` BLOB column matches Vectorize dim (384) |
| KV approval-token gate in `defineTool` | Capability calls of `risk:'high'` reuse this — no new approval surface |

---

## Risks / open questions

1. **`worker_loaders` closed-beta** — confirm fermi account access in Phase 0; without it, Phases 3–4 stall. Fallback: `Function()`-based eval (insecure, dev-only) flagged as `risk: critical` in audit.
2. **`@cloudflare/codemode` ergonomics** — npm-published but the `LOADER`-binding API surface may shift. Pin `0.3.4`.
3. **Vectorize plan tier** — Workers Paid required. Phase 6 gracefully degrades to D1 cosine sim if absent.
4. **Recursion bound** — `team_spawn` re-enters MCP; `execute → team_spawn → subagent → execute` is possible. Cap depth=2 in `agent.state.executeDepth`.
5. **High-risk capability calls inside `execute`** — they'll return the existing `pending_approval` JSON to sandbox code. Recommend failing fast inside the gateway with a `requires_approval` error rather than letting the sandbox see token internals.
6. **Audit volume** — every fetch from sandbox writes a row. A `fetch_gateway` row sample/batch policy may be needed.
7. **`fermi:runtime` rename** (vs. `kody:runtime`) — locks out direct import of kody-authored skills. Worth the branding clarity but document.
8. **`FERMI_SECRETS_KEY` rotation** — single symmetric key; rotation requires re-encrypt. Schema includes `key_version` so rotation is non-breaking later.

---

## Total estimate

~17–20 working days for Phases 0–8. Phase 9 adds 3–5 more. **GitHub-token demo lights up at end of Phase 4 — roughly day 9–10.**

---

## End-to-end verification (post-Phase 4)

```bash
# 1. Deploy
bun --cwd packages/worker run deploy

# 2. Provision
wrangler secret put FERMI_SECRETS_KEY --config packages/worker/wrangler.jsonc  # 32-byte hex
wrangler d1 migrations apply fermi --remote

# 3. Via MCP (Claude Code already has fermi connected per earlier setup):
#    mcp__fermi__secret_set name=GITHUB_TOKEN value=ghp_xxx scope=app allowed_hosts=["api.github.com"]
#    → returns pending_approval token
#    mcp__fermi__secret_set ... approval_token=<token>
#    → committed

# 4. Run the demo:
#    mcp__fermi__execute code='
#      const r = await fetch("https://api.github.com/user", {
#        headers: { Authorization: "Bearer {{secret:GITHUB_TOKEN}}" }
#      })
#      return await r.json()
#    '
#    → pending_approval token
#    mcp__fermi__execute ... approval_token=<token>
#    → returns the GitHub user JSON

# 5. Inspect audit:
wrangler d1 execute fermi --command "SELECT tool, outcome, risk, created_at FROM audit ORDER BY created_at DESC LIMIT 10"
# Expect: execute=ok, fetch_gateway=ok rows back-to-back.
```
