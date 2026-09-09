# 1. Why I built my own control plane

It started as a chat bridge. I wanted to talk to my agent from Telegram; Telegram needed a webhook; a Cloudflare Worker is the cheapest thing on earth that can hold a webhook. That Worker is now the center of everything, and the path from "webhook holder" to "control plane" explains most of Fermi's shape.

## The amnesia tax

Working across Claude.ai, Claude Desktop, and Claude Code daily meant paying an amnesia tax three times: each host had its own memory of me, its own pasted-in credentials, its own re-explained project context. The models were the same; the *selves* were strangers. MCP had just made tool servers portable across hosts — which meant the fix was obvious once stated: **don't sync the hosts; give them one shared self to mount.** Memory, skills, secrets, tasks — one server, every host a window onto it.

That inversion is the whole architecture. Hosts are disposable; the Worker is the agent.

## Why Cloudflare, honestly

Not sophistication — thrift and laziness, which are architecture virtues:

- A Durable Object is a tiny stateful computer with a SQLite disk that costs nothing while idle. That's an *agent*, structurally.
- D1/R2/KV/Vectorize/cron/Browser Rendering meant every subsystem had a zero-ops home.
- The whole thing deploys with `wrangler deploy` and costs ~$5/month at the floor.

The constraint that shaped everything: **a Worker can't hold a socket open or run a harness.** WhatsApp Web needs a live socket; real coding needs a real machine. So anything long-lived or hardware-bound had to live elsewhere and *pull* — which is how the daemon was born, and why the pull-only posture (the Mac reaches out; nothing reaches in) was the default before it was a security principle.

## What I'd tell past me

1. The task queue should have been first, not fourth. Every lane — channels, daemon, fleet — reduced to "enqueue, claim with a lease, complete with a result." Everything clever sits on that boring table.
2. Write the honest architecture doc *early*. The discipline of "describe what the code actually does, flag what's partial" caught more design errors than any review.
3. The moment two components share a queue, namespace it. (Foreshadowing: [post 3](/blog/03-task-theft).)

Next: what happened when the agents got numerous enough to start lying — [Agents lie: proof contracts](/blog/02-proof-contracts).
