# OpenClaw Pattern Extract

> Source: `context/openclaw/` -- self-hosted AI assistant platform (Node 22+, TypeScript ESM), MIT-licensed. Notes derived from the MIT-licensed OpenClaw project.

---

## 1. Live Canvas

### CanvasDocument Kinds

Defined in `src/gateway/canvas-documents.ts:8`:

```
"html_bundle" | "url_embed" | "document" | "image" | "video_asset"
```

### Entrypoint Types

`CanvasDocumentEntrypoint` (same file, line 16) is a discriminated union:

| type | value | behaviour |
|------|-------|-----------|
| `html` | raw HTML string | Written as `index.html` into document dir |
| `path` | local file path | File copied into document dir; images/videos get HTML wrapper |
| `url` | remote URL | External redirect (PDFs get an `<object>` wrapper) |

### Persistence Model

- Each canvas document gets a unique id (`cv_<uuid>`).
- Storage root: `<stateDir>/canvas/documents/<docId>/`.
- Assets are copied in via `copyAssets()`; a `manifest.json` is written alongside containing id, kind, title, entryUrl, localEntrypoint, externalUrl, assets array, surface, and timestamps.
- The manifest is the source of truth for reconstruction.
- Surface placement: `"assistant_message" | "tool_card" | "sidebar"`.

### Canvas Host Server

`src/canvas-host/server.ts` runs a local HTTP + WebSocket server (`ws` library + `chokidar` file watcher):
- Serves static files from the canvas root dir.
- Injects live-reload script for hot development.
- URL resolution: `/_canvas/documents/<docId>/<entrypoint>`.
- Host URL resolution in `src/infra/canvas-host-url.ts` handles proxy/HTTPS scenarios (Tailscale Serve, etc.).

### CF Mapping

| OpenClaw | Fermi (CF) |
|----------|------------|
| Local filesystem storage | **Durable Object** per document + **R2** for asset snapshots |
| Node HTTP + WebSocket server | Worker route serving from R2; DO for live-reload WebSocket |
| `manifest.json` on disk | DO state or R2 metadata object |

---

## 2. Cron / Scheduled

### CronService Architecture

`src/cron/service.ts` exposes a `CronService` class implementing `CronServiceContract` with CRUD + run + wake operations. The service is instantiated by the gateway in `src/gateway/server-cron.ts` via `buildGatewayCronService()`.

### Schedule Types

`src/cron/types.ts:6` defines `CronSchedule` as a discriminated union:

| kind | fields | description |
|------|--------|-------------|
| `at` | `at: string` | One-shot at a specific time |
| `every` | `everyMs: number, anchorMs?` | Recurring interval |
| `cron` | `expr: string, tz?, staggerMs?` | Standard cron expression with optional timezone and stagger |

### Session Target & Wake

- `CronSessionTarget`: `"main" | "isolated" | "current" | session:${string}`
- `CronWakeMode`: `"next-heartbeat" | "now"`
- Isolated jobs use `runCronIsolatedAgentTurn()` for sandboxed execution.

### Payload Types

`CronPayload` is either:
- `{ kind: "systemEvent", text }` -- fire-and-forget system event
- `{ kind: "agentTurn", message, model?, thinking?, timeoutSeconds?, ... }` -- full agent turn with model, fallbacks, tool allow-lists

### Delivery Routing

`CronDelivery` (types.ts:24) controls where results go:
- `mode`: `"none" | "announce" | "webhook"`
- `channel`: any `ChannelId` (telegram, slack, discord, etc.)
- `to`, `threadId`, `accountId` for targeting
- `failureDestination` for separate error notification routing
- Notifications dispatched via `dispatchGatewayCronFinishedNotifications()` and `sendGatewayCronFailureAlert()` in `server-cron-notifications.ts`.

### Run Logging

- Run logs stored at `resolveCronRunLogPath()` with pruning via `resolveCronRunLogPruneOptions()`.
- Each run records: status (`ok | error | skipped`), delivery status, duration, usage/telemetry, error classification.

### CF Mapping

| OpenClaw | Fermi (CF) |
|----------|------------|
| `CronService` class + filesystem store | **Cron Triggers** for schedule evaluation + **D1** for job definitions and run logs |
| `runCronIsolatedAgentTurn()` | Workflow step with isolated context |
| Heartbeat-based wake | Cron Trigger fires Worker; Worker dispatches to agent session |
| Filesystem run log + pruning | D1 `cron_runs` table with TTL-based cleanup |

---

## 3. Telegram

### Extension Structure

Located at `extensions/telegram/` with ~180+ source files. Key modules:
- `webhook.ts` -- webhook transport
- `bot.ts` / `bot.runtime.ts` -- grammy Bot setup
- `draft-stream.ts` -- edit-in-place streaming
- `draft-chunking.ts` -- chunk size resolution
- `outbound-adapter.ts` -- message delivery with 4000-char chunking
- `dm-access.ts` -- DM authorization
- `format.ts` -- Markdown-to-Telegram-HTML conversion

### Webhook Handling

`startTelegramWebhook()` in `webhook.ts:250`:
1. Creates a grammy bot instance via `createTelegramBot()`.
2. Spins up a local HTTP server (default port 8787, path `/telegram-webhook`).
3. Validates `x-telegram-bot-api-secret-token` header via constant-time comparison.
4. Applies rate limiting via `createFixedWindowRateLimiter()`.
5. Reads JSON body with size/timeout limits (1MB max, 30s timeout).
6. Returns 200 immediately, then processes update asynchronously.
7. Registers webhook URL with Telegram API via `bot.api.setWebhook()` with exponential backoff retry.
8. Health endpoint at `/healthz`.

### 4000-Char Chunking

`TELEGRAM_TEXT_CHUNK_LIMIT = 4000` defined in `outbound-adapter.ts:27`. The outbound adapter uses `markdownToTelegramHtmlChunks()` from `format.ts` to split long responses into Telegram-safe HTML chunks, each under the 4000-character limit (below Telegram's 4096 hard limit to allow for formatting overhead).

### Draft Streaming / Edit-in-Place

`draft-stream.ts` implements progressive message display:
- `TELEGRAM_STREAM_MAX_CHARS = 4096` hard ceiling per message.
- Uses Telegram's `sendMessageDraft` API when available for true draft previews.
- Falls back to `sendMessage` + `editMessageText` pattern for standard streaming.
- Draft IDs allocated via monotonic counter with wrapping at `2_147_483_647`.
- Chunking parameters resolved in `draft-chunking.ts`: default min 200 chars, max 800 chars, with configurable break preference (`paragraph | newline | sentence`).
- `TelegramDraftStream` interface: `update(text)`, `flush()`, `messageId()`, `visibleSinceMs()`, `previewMode()`.

### CF Mapping

| OpenClaw | Fermi (CF) |
|----------|------------|
| Local HTTP server for webhook | **Worker route** `/tg/webhook` |
| grammy bot instance | Worker-compatible grammy or raw Telegram API calls |
| Rate limiter (in-memory) | KV or DO-based rate limiter |
| `sendMessageDraft` / edit-in-place | Same Telegram API from Worker context |

---

## 4. DM-Pairing

### DM Policy Modes

DM access is governed by `DmPolicy`, a union across all channel extensions:

```
"disabled" | "pairing" | "allowlist" | "open"
```

| mode | behaviour |
|------|-----------|
| `disabled` | All DMs rejected silently |
| `open` | DMs accepted if sender matches allowlist (wildcard = accept all) |
| `allowlist` | DMs accepted only for explicitly listed sender IDs/usernames |
| `pairing` | Unknown senders receive a one-time pairing challenge; approved senders added to allowlist |

### Pairing Flow

Implemented in `src/plugin-sdk/channel-pairing.ts` via `createChannelPairingChallengeIssuer()`:

1. Unknown sender messages the bot in DM.
2. Channel-specific access check runs (e.g., `enforceTelegramDmAccess()` in `extensions/telegram/src/dm-access.ts`).
3. If `dmPolicy === "pairing"`, `issuePairingChallenge()` is called.
4. A one-time pairing request is upserted via `upsertChannelPairingRequest()` with sender metadata (id, username, name).
5. Bot replies with the challenge (includes sender's platform user ID for verification).
6. Operator approves pairing in the control UI, adding the sender to the allowlist.
7. Subsequent messages from that sender pass the allowlist check.

### Allowlist Management

- Allowlist stored via `readChannelAllowFromStore()` / `readChannelAllowFromStoreSync()` from `src/pairing/pairing-store.ts`.
- Per-channel, per-account allowlists.
- Matching supports: exact user ID, username, wildcard (`*`).
- Slack variant in `extensions/slack/src/monitor/dm-auth.ts` uses `resolveSlackAllowListMatch()` with optional name-based matching.

### CF Mapping

| OpenClaw | Fermi (CF) |
|----------|------------|
| Filesystem-backed allowlist store | **KV** namespace per channel for allowlists |
| `upsertChannelPairingRequest()` | D1 `pairing_requests` table |
| Per-account scoped access | KV key structure: `{channel}:{accountId}:{senderId}` |
| Control UI approval flow | Worker API endpoint + D1 state update |
