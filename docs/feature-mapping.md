# Fermi — Master Feature Mapping

> Maps every feature from Architecture Brief section 06 to its extract doc, target implementation file, and delivery phase.

| # | Feature | Source | Extract Doc | Target File | Phase |
|---|---------|--------|-------------|-------------|-------|
| 1 | Agent-curated memory + nudges | Hermes | `extracts/hermes.md` §Memory | `packages/worker/src/tools/memory.ts` | 1 |
| 2 | FTS5 cross-session search | Hermes | `extracts/hermes.md` §Memory | `packages/worker/src/tools/session-search.ts` | 1 |
| 3 | Autonomous skill creation | Hermes | `extracts/hermes.md` §Skills | `packages/worker/src/cron/skill-distillation.ts` | 5 |
| 4 | Dialectic user model | Hermes | `extracts/hermes.md` §User Model | `packages/worker/src/cron/user-model.ts` | 5+ |
| 5 | Tool permission spine | Mercury | `extracts/mercury.md` §Tool Wrapper | `packages/worker/src/lib/tool.ts` | 2 |
| 6 | Folder-scoped read/write | Mercury | `extracts/mercury.md` §Folder-Scope | `packages/worker/src/tools/fs.ts` | 2 |
| 7 | Daily token budget + auto-concise | Mercury | `extracts/mercury.md` §Budget | `packages/worker/src/lib/budget.ts` | 2 |
| 8 | Soul/persona files | Mercury | `extracts/mercury.md` §Tool Wrapper | `packages/worker/src/resources/persona.ts` | 2 |
| 9 | Live Canvas (A2UI-style) | OpenClaw | `extracts/openclaw.md` §Live Canvas + `extracts/cloudflare-stack.md` §Widget Pipeline | `packages/worker/src/do/live-canvas.ts` | 3 |
| 10 | Cron + scheduled deliveries | OpenClaw | `extracts/openclaw.md` §Cron/Scheduled | `packages/worker/src/cron/deliveries.ts` | 4 |
| 11 | Multi-channel inbox (TG+Slack) | OpenClaw | `extracts/openclaw.md` §Telegram + §DM-Pairing | `packages/worker/src/channels/` | 4 |
| 12 | Browser surface — cloud lane | Cloudflare | `extracts/cloudflare-stack.md` §Wrangler Config | `packages/worker/src/tools/browser-cloud.ts` | 3.5 |
| 13 | Browser surface — local lane (headed) | Custom | `extracts/cloudflare-stack.md` §Worker Entry | `packages/bridge/` | 3.5 |
| 14 | Plan mode — Enter/Exit gate | free-code | `extracts/free-code.md` §Plan Mode | `packages/worker/src/orchestration/plan-mode.ts` | 5 |
| 15 | Agent team — single delegation tool | free-code | `extracts/free-code.md` §Agent Team | `packages/worker/src/orchestration/team-spawn.ts` | 5 |
| 16 | Hooks system | free-code | `extracts/free-code.md` §Hooks | `packages/worker/src/orchestration/hooks.ts` | 5 |

## Phase Delivery Summary

| Phase | Features | Weeks |
|-------|----------|-------|
| 0 | Foundation (Worker, MCP, D1 schema) | 1-2 |
| 1 | #1 Memory, #2 FTS5 search | 3-5 |
| 2 | #5 Permissions, #6 Folder-scope, #7 Budget, #8 Persona | 6-7 |
| 3 | #9 Live Canvas | 8-10 |
| 3.5 | #12 Browser cloud, #13 Browser local | 11 |
| 4 | #10 Cron deliveries, #11 Channels | 12-13 |
| 5 | #3 Skills, #14 Plan mode, #15 Agent team, #16 Hooks | 14-17 |
| 5+ | #4 User model (post-v1) | TBD |

## Storage Mapping

| Feature | D1 Table | R2 Path | KV Key |
|---------|----------|---------|--------|
| Memory | `memory` | — | — |
| Sessions | `sessions`, `messages`, `messages_fts` | — | — |
| Skills | `skills` | `/skills/<slug>.md` | — |
| Persona | — | `/persona/soul.md`, `/persona/taste.md` | — |
| Plans | `plans` | `/plans/<plan_id>.json` | — |
| Team spawns | `team_spawns` | — | `team:max_concurrent`, `team:max_depth` |
| Audit | `audit` | — | `budget:YYYY-MM-DD` |
| Hooks | `hooks` | — | `trust:<workspace_id>` |
| Permissions | — | — | `permission:fs.write:scope`, `permission:browser.local:approved_origins` |
| Channels | — | — | `channel:tg:allowlist`, `channel:slack:allowlist` |
| Bridge | — | — | `bridge:online`, `bridge:last_seen_ms` |
| Canvas | — | `/canvas/<canvas_id>.json` | — |
| Roles | — | `/roles/<role>.md` | — |
