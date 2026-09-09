# @fermi/wa-bridge

A WhatsApp **linked-device bridge** for Fermi. It runs a [Baileys](https://github.com/WhiskeySockets/Baileys)
socket against a dedicated WhatsApp number (OpenClaw-style: your phone stays the
primary device, this Mac is a linked device) and shuttles messages between
WhatsApp and the Fermi Worker:

- **Inbound** — a WhatsApp DM arrives → `POST ${FERMI_URL}/wa/webhook` → the local
  Fermi daemon (`poll.sh`) is poked so it drains the task promptly.
- **Outbound** — the bridge polls `GET ${FERMI_URL}/wa/outbox`, sends each message
  over WhatsApp, then `POST ${FERMI_URL}/wa/outbox/ack`.

It runs as a per-user **LaunchAgent** (`com.fermi.wa-bridge`) with `KeepAlive`, so
launchd restarts it on crash or logout/login.

> This is an **unofficial** WhatsApp client. Read the warm-up and ban-risk notes
> below before pointing it at a number you care about.

## How it runs

TypeScript is executed **natively by Node ≥ 22.18** (type-stripping) — there is no
build step. Files are `.ts`, ESM, with `.ts` import specifiers.

## Prerequisites

- Node **≥ 22.18** (`node --version`).
- The base Fermi daemon installed first — `daemon/install.sh` — which creates
  `~/fermi-daemon/.env` with `FERMI_URL` and `FERMI_BEARER_TOKEN`.
- A **dedicated** WhatsApp number on a phone you control (used as the primary
  device; this bridge links to it).
- The Worker deployed with a `WA_WEBHOOK_SECRET` Wrangler secret matching the one
  in `~/fermi-daemon/.env` (the installer generates one and prints the
  `wrangler secret put` command if it is missing).

## Install

```sh
cd packages/wa-bridge
./install.sh
```

The installer verifies Node, ensures `WA_WEBHOOK_SECRET` exists in
`~/fermi-daemon/.env` (generating one if needed), copies the package to
`~/fermi-daemon/wa-bridge`, runs `npm install --omit=dev`, and installs the
LaunchAgent. If the device is already paired it starts immediately; otherwise it
prints the pairing steps below and does **not** start yet.

## Pairing walkthrough

Pairing links this Mac to your WhatsApp number using a **phone-number pairing
code** (not a QR scan).

```sh
cd ~/fermi-daemon/wa-bridge
npm run pair -- 15551234567        # E.164 digits, no '+', no spaces
```

A large pairing code prints in the terminal. On the phone that owns the number:

1. Open **WhatsApp → Settings → Linked Devices → Link a device**.
2. Tap **Link with phone number instead**.
3. Enter the code shown in the terminal.

When you see `connected as …`, pairing succeeded and credentials are saved to
`~/fermi-daemon/wa-auth`. Press **Ctrl-C**, then start the agent:

```sh
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.fermi.wa-bridge.plist
```

(If a QR code is more convenient, it is also rendered in the terminal during
pairing as a fallback.)

## Operations

- **Logs:** `~/fermi-daemon/logs/wa-bridge.log` (stdout/stderr captured by launchd).
- **Restart:** `launchctl kickstart -k gui/$UID/com.fermi.wa-bridge`
- **Stop:** `launchctl bootout gui/$UID/com.fermi.wa-bridge`
- **Uninstall:**
  ```sh
  launchctl bootout gui/$UID/com.fermi.wa-bridge
  rm ~/Library/LaunchAgents/com.fermi.wa-bridge.plist
  ```

### Re-pair / recovery

If WhatsApp logs the device out (removed from Linked Devices, or logged out
remotely), the bridge writes a `LOGGED_OUT` marker into `~/fermi-daemon/wa-auth`
and exits; on restart it refuses to run and logs recovery steps. To re-pair:

```sh
launchctl bootout gui/$UID/com.fermi.wa-bridge
rm -rf ~/fermi-daemon/wa-auth          # removes creds AND the LOGGED_OUT marker
cd ~/fermi-daemon/wa-bridge && npm run pair -- <E164-digits>
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.fermi.wa-bridge.plist
```

## Groups

The bot works in any group it is added to. Every group message is forwarded to
the Worker with `chat_id` set to the full group jid (`<id>@g.us`) and `sender`
set to the participant's bare phone number; only **allowlisted senders** actually
trigger the bot (the allowlist is managed Worker-side). Replies go back to the
group, not to the sender's DM.

Group senders often appear under WhatsApp's privacy addressing (`@lid`); the
bridge resolves them to a phone number via the message's `participantAlt`. A
sender that cannot be resolved to a phone number is skipped with a log line.

## Warm-up & ban risk

Unofficial WhatsApp clients get banned when they behave like bots. Warm the
number up gradually:

- **Ramp slowly:** start around **~20 messages/day** and increase over **~7 days**.
- **Reply-only:** only respond to people who message you first. **No cold
  outreach**, no bulk sends, no unsolicited first-contact messages.
- The bridge already paces sends (a randomized 2–5 s delay before each chunk, and
  long messages are split into ≤ 4000-char chunks) to look less bot-like.

Treat a fresh number as expendable until it has aged.

## Caveats

- **Possible double-send:** ack is per-message and happens *after* the send. If the
  process crashes between sending a message and acking it, that one message can be
  re-sent on the next cycle. Recipients may occasionally see a duplicate.
- **Broadcast/newsletter ignored:** `status@broadcast` and `@newsletter` messages
  are dropped on inbound. DMs and groups are both handled (see **Groups** above).
