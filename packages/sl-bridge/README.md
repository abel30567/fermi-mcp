# @fermi/sl-bridge

A **Slack Socket Mode bridge** for Fermi. It holds an `@slack/socket-mode`
WebSocket and forwards each user message to the Fermi Worker:

- **Inbound** — a Slack message arrives → `POST ${FERMI_URL}/sl/webhook` → the local
  Fermi daemon (`poll.sh`) is poked so it drains the task promptly.

This bridge is **receive-only**: it never sends Slack messages. The Worker sends
all replies itself over `chat.postMessage`, so there is no outbox loop here
(same shape as the Discord bridge).

It runs as a per-user **LaunchAgent** (`com.fermi.sl-bridge`) with `KeepAlive`, so
launchd restarts it on crash or logout/login.

## How it runs

TypeScript is executed **natively by Node ≥ 22.12** (type-stripping) — there is no
build step. Files are `.ts`, ESM, with `.ts` import specifiers.

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create an app.
2. **OAuth & Permissions** → Bot Token Scopes: `chat:write`, `channels:history`,
   `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`,
   `im:write`, `mpim:history`, `mpim:read`, `users:read`. Install the app to the
   workspace and copy the **Bot User OAuth Token** (`xoxb-`). This is
   `SLACK_BOT_TOKEN` — put it in `~/fermi-daemon/.env` and as a Worker secret.
3. **Socket Mode** → enable it.
4. **Basic Information** → **App-Level Tokens** → Generate Token with the
   `connections:write` scope. Copy the `xapp-` token. This is `SLACK_APP_TOKEN`
   (daemon `.env` only — the Worker does not need it).
5. **Event Subscriptions** → enable events and subscribe the bot to
   `message.channels`, `message.groups`, `message.im`, `message.mpim`.
   Socket Mode means you do **not** set a Request URL.
6. Invite the bot into every channel that should be eager
   (`/invite @Fermi`). DMs work without an invite.

The **workspace is the trust boundary**. Approve it with
`allowlist_add` channel `sl`, `sender_id` = the workspace `team_id`
(starts with `T`). Any member of an approved workspace can use the bot in
channels the bot has been invited to. DMs use the standard pairing flow.
Unapproved workspaces get silence.

## Prerequisites

- Node **≥ 22.12** (`node --version`).
- The base Fermi daemon installed first — `daemon/install.sh` — which creates
  `~/fermi-daemon/.env` with `FERMI_URL`.
- `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `~/fermi-daemon/.env`.
- The Worker deployed with matching `SLACK_BRIDGE_SECRET` and `SLACK_BOT_TOKEN`
  Wrangler secrets (the installer generates the bridge secret and prints the
  `wrangler secret put` commands).

## Install

```sh
cd packages/sl-bridge
./install.sh
```

The installer verifies Node, ensures `SLACK_BRIDGE_SECRET` exists in
`~/fermi-daemon/.env` (generating one if needed), reminds you to add the Slack
tokens, copies the package to `~/fermi-daemon/sl-bridge`, runs
`npm install --omit=dev`, and installs and starts the LaunchAgent.

The bridge exits on startup if a required token is missing or `auth.test` fails.

## Operations

- **Logs:** `~/fermi-daemon/logs/sl-bridge.log` (stdout/stderr captured by launchd).
- **Restart:** `launchctl kickstart -k gui/$UID/com.fermi.sl-bridge`
- **Stop:** `launchctl bootout gui/$UID/com.fermi.sl-bridge`
- **Uninstall:**
  ```sh
  launchctl bootout gui/$UID/com.fermi.sl-bridge
  rm ~/Library/LaunchAgents/com.fermi.sl-bridge.plist
  ```
