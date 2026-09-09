# Quickstart — the Worker alone

Goal: a working Fermi MCP server in your Cloudflare account, connected to one AI host, in about 15 minutes. Nothing here touches your Mac or AWS.

Pick the row that matches your goal:

| You want | Do |
|----------|----|
| Shared memory/skills across Claude hosts | This page, then connect each host |
| The agent to also have hands on a Mac | This page, then [The Daemon](/components/daemon) |
| Disposable cloud agents | This page, then [Neutrinos](/components/neutrinos) |
| To understand it before running it | [System map](/architecture/system-map) |

## Prerequisites

- A Cloudflare account on the **Workers Paid** plan ($5/mo — D1, R2, KV, Vectorize stay near free tier at single-user volume)
- [Bun](https://bun.sh) and Node 22+
- `wrangler` logged in: `bunx wrangler login`

## Install and deploy

```bash
git clone https://github.com/abel30567/fermi-mcp
cd fermi-mcp
bun install

# Provisions D1, R2, KV, Vectorize on your account and writes
# packages/worker/wrangler.jsonc from the template. Idempotent.
./bootstrap.sh

# Schema, then ship it
cd packages/worker
bun run migrate:remote
bunx wrangler deploy
```

Set the secrets the Worker needs (each is optional until the feature that uses it):

```bash
bunx wrangler secret put FERMI_BEARER_TOKEN    # admin endpoints; generate something long
bunx wrangler secret put FERMI_SECRETS_KEY     # encrypts your stored secrets at rest
bunx wrangler secret put FERMI_OWNER_SECRET    # OAuth consent screen password
bunx wrangler secret put ANTHROPIC_API_KEY     # only for channels (Telegram/Slack) inference
```

Then turn the auth gate on for any deployment that isn't localhost:

```bash
bunx wrangler secret put FERMI_AUTH_ENABLED    # value: true
```

::: warning Open mode is really open
With `FERMI_AUTH_ENABLED` unset, `/mcp` has **no transport auth**. That is a local-dev convenience, not a deployment mode. A deployed Worker in open mode is a public agent with your memory in it.
:::

## Connect a host

- **Claude.ai / Claude Desktop** — add a custom connector pointing at `https://<your-worker>.workers.dev/mcp`; complete the OAuth consent (owner secret + TOTP if configured). Walkthrough with screenshots: [docs/connect-claude-desktop.md](https://github.com/abel30567/fermi-mcp/blob/master/docs/connect-claude-desktop.md).
- **Claude Code** — `claude mcp add fermi --transport http https://<your-worker>.workers.dev/mcp`.
- **Cursor / VS Code** — same URL in the MCP settings pane.

## What success looks like

- [ ] `curl https://<your-worker>.workers.dev/health` returns 200
- [ ] Your host lists ~60 `mcp__fermi` tools
- [ ] `memory_write` in one host, `memory_recall` finds it in another
- [ ] `skill_search` returns the five seed skills (`POST /admin/seed-skills` with your bearer token if empty)

## If setup does not work

| Symptom | Cause | Fix |
|---------|-------|-----|
| `bootstrap.sh` fails creating resources | wrangler not logged in / free plan | `bunx wrangler login`; upgrade to Workers Paid |
| Host connects but sees 0 tools | Hit `/sse` with a streamable-HTTP client or vice versa | Use `/mcp` for modern hosts; `/sse` is legacy |
| OAuth consent loops | `FERMI_OWNER_SECRET` unset while `FERMI_AUTH_ENABLED=true` | Set the secret, redeploy |
| Typecheck fails on a fresh clone | You regenerated the lockfile | Keep the committed `bun.lock`; two MCP-SDK majors otherwise coexist and clash |

Next: [Setup tiers](/guide/setup-tiers) to decide how much more of the system you want.
