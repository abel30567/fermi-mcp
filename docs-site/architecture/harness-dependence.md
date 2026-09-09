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

Current state, tested: **ChatGPT plugins work with Fermi MCP.** Add the Worker's MCP endpoint as a plugin (chatgpt.com/plugins → "+" → New Plugin → name + server URL; auth OAuth or None) and ChatGPT lists and calls the tool surface — memory, skills, search, tasks, and the rest of the read/write tools behave normally.

What does *not* carry over is the part of Fermi that assumes a cooperative approval loop:

- **`execute` can't be triggered from ChatGPT.** It's `risk: high`, so the guardrail pipeline answers the first call with `pending_approval` plus a single-use token and expects the host to re-issue the call with that token. Claude hosts play this two-step; ChatGPT doesn't — it treats the pending response as the answer and moves on, so the sandbox (and any other approval-gated tool) is effectively unreachable.
- **Per-request key minting fights ChatGPT's usage model generally.** The mint-token-then-redeem pattern assumes the host will hold state across a denied call and retry deliberately. ChatGPT's connector model wants tools that succeed or fail in one shot.

Practical paths, in order of effort:

1. **Scope-limited client**: register a dedicated OAuth client for ChatGPT and treat it as a read/write-low surface — everything below `risk: high` already just works.
2. **A ChatGPT-mode approval bridge**: let the approval token be redeemed out-of-band (approve from any Claude host or a channel message) so ChatGPT's *next* identical call finds the gate open, instead of expecting ChatGPT itself to carry the token.

The honest compatibility table:

| Host | Status |
|------|--------|
| Claude.ai / Desktop / Code | first-class, including approval-gated tools |
| Cursor / VS Code MCP | works (MCP standard) |
| ChatGPT | **works as a plugin** for the normal tool surface; `execute` and other `risk: high` approval-gated tools unusable from it today |
| Anything speaking MCP streamable-HTTP | should work; report issues |
