# What is Fermi?

Fermi is a personal AI control plane you run yourself. It has three parts, adopted in order, each optional after the first:

| Part | Runs on | What it is | Repo |
|------|---------|------------|------|
| **The Worker** ("Fermi MCP") | Cloudflare Workers | One MCP server holding your memory, skills, secrets, tasks, schedules, and permissions. Every AI host connects to it. | [fermi-mcp](https://github.com/abel30567/fermi-mcp) |
| **The Daemon** (+ optional MacOSMCP) | Your Mac | A local worker that drains the Worker's task queue with a real coding harness, and (with MacOSMCP) gives the agent a real browser, shell, and residential IP. | [fermi-daemon](https://github.com/abel30567/fermi-daemon) · [MacOSMCP](https://github.com/abel30567/MacOSMCP) |
| **Neutrinos** (the cloud fleet) | AWS EC2, disposable | On-demand agent boxes launched by the Worker: claim one task, prove completion against a machine-checked contract, terminate. | worker `src/lib/fleet-*`, daemon `box-runner.mjs` |

The name game: Fermi is the control plane; the disposable cloud agents are **neutrinos** — near-massless, produced in enormous numbers, gone as soon as they've carried their energy somewhere. Fleet commits land under a dedicated [`fermi-neutrino`](https://github.com/fermi-neutrino) git identity so you can always tell machine work from yours.

## What problem does this solve?

Every AI subscription gives you a brilliant amnesiac in a locked room. The model is excellent; everything around it resets: memory dies with the chat window, credentials get re-pasted into new sessions, browser automation gets blocked by the first bot wall, and there is exactly one of it.

Fermi is the *everything around it*:

- **Continuity** — memory, skills, and conversation history live in your Cloudflare account, shared by every host. Ask Claude Code something on Monday; Claude.ai on your phone knows the answer Tuesday.
- **Capability** — the Mac lane does what datacenter IPs can't: real Chrome with a real fingerprint on a residential connection, AppleScript, the shell, your files.
- **Scale** — when one agent isn't enough, the Worker launches neutrinos. Each costs about $0.02/hour of EC2 time (inference rides your existing Claude subscription via OAuth token).
- **Custody** — cookies, secrets, and tokens never leave infrastructure you own. See [Trust boundaries](/architecture/trust-boundaries).

## Component responsibilities

- **The Worker** owns: state (D1/R2/KV/Vectorize), the MCP tool surface (~60 tools), the permission pipeline (scope/risk/approval/hooks/audit), the task queues, channel webhooks (Telegram/WhatsApp/Discord/Slack), fleet lifecycle, and the session broker. It is the only component with a public address.
- **The Daemon** owns: draining `main`-queue tasks on your Mac with the Claude Code harness, warm-worker latency (a pre-booted harness waiting for work), channel bridges that can't run in a Worker (WhatsApp Web socket), the broker executor (the only process that ever holds decrypted cookies), and session capture.
- **MacOSMCP** owns: the 25 `mac_*` tools — shell, AppleScript/JXA, files, stealth Chrome, OCR, clipboard, keystrokes — served over a Cloudflare Tunnel back to the Worker.
- **A neutrino** owns: exactly one task. It polls the box gateway, runs the harness, uploads artifacts, and must satisfy its proof contract before the Worker accepts `done`.

## Where to go next

- Never touched Fermi: [Quickstart](/guide/quickstart) — Worker only, ~15 minutes.
- Deciding how deep to go: [Setup tiers](/guide/setup-tiers).
- Security-minded (good): [Access you must grant](/guide/access-grants) and [Trust boundaries](/architecture/trust-boundaries).
- Want the war stories: [the blog](/blog/).
