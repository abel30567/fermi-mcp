# Harness dependence

An honest accounting of how much of Fermi currently assumes one specific agent harness — and what it would take to loosen that.

## Where the harness sits

Fermi's *control plane* (the Worker) is harness-agnostic: it speaks MCP, and MCP is the whole point — any host that speaks it gets the same tools. The *execution lanes* are a different story:

| Lane | What actually runs | Coupling |
|------|--------------------|----------|
| MCP hosts | whatever host you connect | none — pure MCP |
| Channels | Worker-native inference loop (`runAgentTurn`) against the Anthropic API | Anthropic API, not a harness |
| **Daemon** | `claude -p` — the Claude Code CLI in print mode, with `--allowedTools` | **hard** |
| **Neutrinos** | `box-runner.mjs` spawns a harness by `route`: `claude` (Claude Code CLI), `codex` (Codex CLI), `grok` (Grok CLI) | **moderate** — three routes exist, but the runner's assumptions (flags, output framing, OAuth token env var, settings files) are Claude-Code-shaped, and `claude` is the only route with heavy mileage |

What "Claude-Code-shaped" means concretely: the runner and daemon rely on `-p/--print` single-shot semantics, `--allowedTools` server-level grants, `--append-system-prompt`, settings-source selection, and the harness's own MCP client to reach Fermi's tools from inside a task. Swap the harness and you must replace each of those affordances, not just the binary name.

## Why this is worth fixing

A harness is a bundle of: an agent loop, a tool-permission model, an MCP client, context management, and output framing. Betting the execution tier on one vendor's bundle means vendor outages, pricing shifts, or model routing changes hit your *infrastructure*, not just your chat. The fleet already hints at the answer — `route: codex | grok` boxes run today on the same box gateway, proof contracts, and broker, because **the contract with a box is HTTP + artifacts, not harness internals.**

The roadmap, in order of leverage:

1. **Extract a harness adapter interface** in `box-runner.mjs` (spawn args, tool-grant mapping, completion detection, credential env) so adding a route is a file, not a fork.
2. **Same adapter for the daemon lanes** — today `poll.sh` hardcodes the Claude CLI.
3. **A "bare" route**: any OpenAI-compatible endpoint + a minimal loop that only uses Fermi's own tools over MCP. Slower than a tuned harness, but it makes the floor vendor-neutral.

## The ChatGPT gap

Current state, tested: **Fermi does not work as a ChatGPT connector/plugin.** ChatGPT's connector surface (chatgpt.com/plugins → "+" → New Plugin) expects its own connector schema and auth flow (OAuth default; "None" allowed), and its MCP support does not accept Fermi's streamable-HTTP MCP endpoint as-is. We *have* driven the ChatGPT plugin UI end-to-end with fleet agents (creating third-party connectors like an MCP-backed retail connector, and fanning 60 agents across one) — so the limitation is well-characterized, not speculative:

- ChatGPT wants a connector manifest + its own tool-listing semantics, not a raw `/mcp` transport.
- Auth: it will do OAuth against your endpoint, but the consent flow differs from the `workers-oauth-provider` handshake Claude hosts use.
- Practical path: a thin **ChatGPT-connector façade** on the Worker — a route that translates ChatGPT's connector calls into the internal tool surface, with its own OAuth client registration. The OAuth machinery (`oauth_register_client`, `/oauth/*`) already exists; the missing piece is the translation layer and schema.

Until that façade exists, the honest compatibility table is:

| Host | Status |
|------|--------|
| Claude.ai / Desktop / Code | first-class |
| Cursor / VS Code MCP | works (MCP standard) |
| ChatGPT | **not supported** as a connector today; the fleet can *drive* ChatGPT's UI via the broker, which is a different thing |
| Anything speaking MCP streamable-HTTP | should work; report issues |
