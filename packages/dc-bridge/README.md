# @fermi/dc-bridge

A **Discord Gateway bridge** for Fermi. It holds a [discord.js](https://discord.js.org)
Gateway WebSocket (v14) and forwards each user message to the Fermi Worker:

- **Inbound** — a Discord message arrives → `POST ${FERMI_URL}/dc/webhook` → the local
  Fermi daemon (`poll.sh`) is poked so it drains the task promptly.

This bridge is **receive-only**: it never sends Discord messages. The Worker sends
all replies itself over the Discord REST API, so there is no outbox loop here
(simpler than the WhatsApp bridge).

It runs as a per-user **LaunchAgent** (`com.fermi.dc-bridge`) with `KeepAlive`, so
launchd restarts it on crash or logout/login.

## How it runs

TypeScript is executed **natively by Node ≥ 22.12** (type-stripping) — there is no
build step. Files are `.ts`, ESM, with `.ts` import specifiers.

## Discord Developer Portal setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**. Name it (e.g. "Fermi").
2. Open the **Bot** tab, click **Reset Token**, and copy the token. This is your
   `DISCORD_BOT_TOKEN` — put it in `~/fermi-daemon/.env` (and as a Worker secret;
   see below). Treat it like a password.
3. Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and enable
   **Message Content Intent**. Without it, `message.content` is empty and the
   bridge has nothing to forward. (Instant for bots in fewer than 100 servers.)
4. Open **OAuth2 → URL Generator**. Under **Scopes** check `bot`. Under **Bot
   Permissions** check **View Channels**, **Send Messages**, and **Read Message
   History** (permissions integer `68608`). Copy the generated URL, open it, and
   invite the bot to your server.

## Prerequisites

- Node **≥ 22.12** (`node --version`).
- The base Fermi daemon installed first — `daemon/install.sh` — which creates
  `~/fermi-daemon/.env` with `FERMI_URL`.
- `DISCORD_BOT_TOKEN` in `~/fermi-daemon/.env` (from the portal steps above).
- The Worker deployed with matching `DISCORD_BRIDGE_SECRET` and `DISCORD_BOT_TOKEN`
  Wrangler secrets (the installer generates the bridge secret and prints the
  `wrangler secret put` commands).

## Install

```sh
cd packages/dc-bridge
./install.sh
```

The installer verifies Node, ensures `DISCORD_BRIDGE_SECRET` exists in
`~/fermi-daemon/.env` (generating one if needed), reminds you to add
`DISCORD_BOT_TOKEN`, copies the package to `~/fermi-daemon/dc-bridge`, runs
`npm install --omit=dev`, and installs and starts the LaunchAgent.

Make sure `DISCORD_BOT_TOKEN` is set in `~/fermi-daemon/.env` before (or restart
after) — the bridge exits on startup if it is missing or invalid.

## Operations

- **Logs:** `~/fermi-daemon/logs/dc-bridge.log` (stdout/stderr captured by launchd).
- **Restart:** `launchctl kickstart -k gui/$UID/com.fermi.dc-bridge`
- **Stop:** `launchctl bootout gui/$UID/com.fermi.dc-bridge`
- **Uninstall:**
  ```sh
  launchctl bootout gui/$UID/com.fermi.dc-bridge
  rm ~/Library/LaunchAgents/com.fermi.dc-bridge.plist
  ```

## Fatal gateway codes

discord.js reconnects on its own for transient disconnects. A few Gateway close
codes are permanent config errors — the bridge logs `FATAL` and exits (rather than
letting launchd hammer a doomed login):

- **4004** — authentication failed: the bot token is wrong. Reset it in the portal
  and update `~/fermi-daemon/.env`.
- **4013** — invalid intents (a coding error in the requested intent bits).
- **4014** — disallowed intents: **Message Content Intent** is not enabled for the
  application in the portal. Enable it (step 3 above).
