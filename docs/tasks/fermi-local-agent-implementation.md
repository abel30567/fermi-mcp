# Task: Implement fermi-local-agent (macOS MCP Server)

> Tracking issue: [fermi#16](https://github.com/your-org/fermi/issues/16) - Fermi Local Agent: macOS MCP Server for Browser, AppleScript, Shell, and Full OS Control
> Target: new repo `fermi-local-agent`. Estimated effort: ~6.5 engineering days across 7 milestones.

## Context

Fermi (Cloudflare Workers MCP platform) cannot pass bot detection on protected sites: every cloud browser shares a headless/datacenter fingerprint, so Cloudflare Turnstile blocks it on Shopify, gamma.app, and similar. The fix is a small MCP server running on a real Mac - real GPU, real Chrome profile, residential IP - exposed to the Fermi Worker through a Cloudflare Tunnel. Side benefit: full OS automation (AppleScript, shell, files, screen) becomes available as first-class Fermi tools.

First concrete workload: Primal TCG Shopify shipping-label automation, currently blocked by Turnstile.

## Deliverable

A Node.js 20+ (or Bun) MCP server with ~24 tools across 7 categories (full catalog in issue #16), reachable at `https://mac.<domain>` via cloudflared, registered in the Fermi Worker as a native MCP client so tools surface as `mac_*` with no codemode/approval overhead.

## Prerequisites

- A dedicated Mac (always-on; an M-series Mac mini is ideal) with macOS 14+
- Node.js 20+ / Bun, Xcode CLT, Homebrew
- `brew install cliclick` (coordinate clicks) and `cloudflared`
- A domain on Cloudflare for the tunnel hostname
- macOS permissions granted to the runtime: Accessibility, Screen Recording, Automation (System Settings > Privacy & Security)
- Write access to `your-org/fermi` (Worker integration in M5)
- Read issue #16 in full before starting - it is the spec; this doc is the work plan

---

## Milestone 0 - Scaffold (0.5d)

1. Create repo `fermi-local-agent`, TypeScript, `@modelcontextprotocol/sdk`.
2. HTTP server on `localhost:3847` exposing MCP over SSE at `/sse` and streamable HTTP at `/mcp`, plus `GET /health` returning `{ ok, version, uptime }`.
3. Bearer-token middleware on every route except `/health`: token from `.env` (`AGENT_TOKEN`), constant-time compare, 401 otherwise.
4. Structured local audit log (JSONL, `~/.fermi-local-agent/audit.log`): timestamp, tool, params hash, duration, outcome. Every tool call goes through it.
5. Implement one tool end-to-end to prove the loop: `mac_system_info` (hostname, macOS version, CPU, memory, disk, uptime).
6. Verify with MCP Inspector locally.

Exit: Inspector lists `mac_system_info` and calls succeed with the token; 401 without it.

## Milestone 1 - Shell, AppleScript, Files (1d)

1. `mac_shell { command, cwd?, timeout_ms?, env? }` via `/bin/zsh -c`, returning `{ stdout, stderr, exitCode }`. Run as current user, never root.
2. Command blocklist (config file, deny-by-pattern): `rm -rf /`, `sudo`, `shutdown`, `diskutil erase`, `csrutil`, plus anything writing to `/System`. Blocked calls return a typed error and are audit-logged.
3. `mac_applescript { script, timeout_ms? }` via `osascript`; `mac_jxa` via `osascript -l JavaScript`. Kill on timeout (default 30s).
4. File tools: `mac_file_read/write/list/move/delete/info/search` per the issue #16 table. `mac_file_search` wraps `mdfind` (Spotlight). Delete moves to Trash (use AppleScript Finder delete, not `rm`).
5. `allowed_paths` config (default `~/` and `/tmp/`); every file tool resolves symlinks and rejects paths outside the allowlist BEFORE touching disk.

Exit: path-traversal attempts (`../../etc/passwd`, symlink into `/etc`) are rejected; blocklist proven by test.

## Milestone 2 - Screen, Clipboard, System (1d)

1. `mac_screenshot { target?, app?, region? }` via `screencapture` (`-l` for window id, `-R` for region), return base64 PNG. Resize to max 1568px wide before returning to keep MCP payloads sane.
2. `mac_screen_ocr { region? }`: capture then OCR through the Vision framework - a small Swift CLI shim (`VNRecognizeTextRequest`) compiled at install, or JXA bridge. Return `{ text, blocks[] }`.
3. `mac_clipboard_get/set` via `pbpaste`/`pbcopy`; images as base64.
4. `mac_notification` (`osascript display notification`), `mac_open` (the `open` command), `mac_keystroke` (System Events keystroke with modifiers, optional target app), `mac_click` (cliclick), `mac_app_list`, `mac_app_activate`.

Exit: screenshot -> OCR -> clipboard round-trip works; keystroke lands in the targeted app.

## Milestone 3 - Real Browser (1.5d)

1. Add `puppeteer-real-browser` with `turnstile: true`. Sessions launch real Chrome with the persistent profile dir `~/.fermi-local-agent/chrome-profile` (cookies survive restarts - this is the point).
2. Session manager: `mac_browser_launch { label?, headless? }` -> `session_id`; `mac_browser_list`; `mac_browser_close`; idle timeout (default 30 min) with auto-cleanup.
3. `mac_browser_action { session_id, actions[] }` executing an ordered action array: `goto, type, click, waitFor, screenshot, extract, evaluate, getCookies, setCookies, select, hover, scrollTo, wait`.
4. **Parity contract**: action names and shapes MUST mirror the cloud `browser_action` schema in the fermi Worker so flows are portable between cloud and local with only a tool-name swap. Diff the schemas as a test.
5. Headful by default (real fingerprint); `headless: true` available but documented as Turnstile-unsafe.

Exit: a scripted session passes Cloudflare Turnstile on a known-protected page and persists login cookies across a server restart.

## Milestone 4 - Cloudflare Tunnel (0.5d)

1. `cloudflared tunnel create fermi-local-agent`; route DNS `mac.<domain>` -> tunnel; config maps to `http://localhost:3847`.
2. Install as launchd service (`cloudflared service install`) so it survives reboots; verify auto-reconnect by killing the process.
3. Also install the agent itself as a launchd LaunchAgent (KeepAlive=true, RunAtLoad=true) with logs to `~/.fermi-local-agent/agent.log`.
4. No inbound ports opened; confirm `localhost:3847` is not reachable from the LAN.

Exit: `curl https://mac.<domain>/health` works from off-network; reboot test brings both services back unattended.

## Milestone 5 - Fermi Worker Integration (1d)

1. In `your-org/fermi`: register the agent as a native MCP client connection (tunnel URL + bearer token). Token lives as a Fermi secret; NEVER hardcoded. Ensure secret values are scoped and never surfaced in plaintext to connected clients before this token ships.
2. Namespace forwarded tools as `mac_*`; they must appear in Fermi tool listings like any native capability - no approval tokens, no codemode.
3. Graceful degradation: if the tunnel is down, `mac_*` calls return a typed `agent_offline` error within 5s (no hangs).
4. Add the agent to `meta-list-capabilities` output with an `origin: local-agent` marker.

Exit: from a Claude session connected to Fermi, `mac_system_info` round-trips through Worker -> tunnel -> Mac and back.

## Milestone 6 - Hardening + Acceptance (1d)

1. Rate limit per tool category (e.g. shell 30/min) to bound damage from a compromised client.
2. Log rotation for audit log; redact obvious secrets (Bearer..., password=...) from logged params.
3. README: install script, permission grants walkthrough (with screenshots), tunnel setup, threat model summary.
4. Run the acceptance suite below.

## Acceptance Criteria

- [ ] All ~24 tools from the issue #16 catalog implemented and listed via MCP
- [ ] Bearer auth enforced on every route except /health; 401 on bad token
- [ ] Path allowlist + command blocklist proven by negative tests
- [ ] Turnstile-protected page passes in a real-browser session
- [ ] **End-to-end target**: log into Shopify admin (your-shop), navigate to an order, and produce a shipping label artifact without Turnstile blocking
- [ ] Cookies/profile persist across agent restarts
- [ ] Tunnel + agent survive reboot via launchd; health reachable publicly, port closed on LAN
- [ ] mac_* tools callable from Claude through the Fermi Worker with no approval flow
- [ ] agent_offline typed error when tunnel is down
- [ ] Audit log captures every invocation

## Security Requirements (non-negotiable)

- This server is remote root-adjacent control of a personal computer. It must never run without auth, even briefly, even on LAN.
- Shared secret minimum 32 bytes random; rotate by updating Fermi secret + .env together.
- Dedicated macOS user account for the agent is strongly recommended; allowed_paths scoped to that user home.
- fermi#17 (plaintext secret exposure through MCP clients) must be resolved or explicitly risk-accepted before the bearer token is stored in Fermi.
- No tool may escalate privileges; reject any command containing sudo even with blocklist disabled.

## References

- Spec: fermi issue #16 (tool catalog, architecture diagram, project structure)
- Cloud parity source: `browser_action` schema in your-org/fermi (Cloudflare Browser Run integration, issue #15, closed)
- puppeteer-real-browser docs (turnstile flag, profile persistence)
- cloudflared launchd service docs
- MCP SDK: @modelcontextprotocol/sdk (SSE + streamable HTTP transports)