# Worked examples

Real shapes of work, with the actual calls. Each ran on the reference deployment; costs are what they cost.

## Fan out a swarm on a repo

Add multivariable-calculus functions to a testbed repo, one function per agent, 100 agents:

```jsonc
// once:
fleetctl pin-runner
// per agent (loop over your function list):
cloud_agent_launch({
  prompt: "Add divergence(f, vars) to mathlib with tests. Commit on a branch, open a PR.",
  proof_contract: "{\"kind\":\"artifact\",\"name\":\"out.diff\",\"min_bytes\":1}",
  repo: "you/testbed", branch: "agent/divergence",
  budget_usd: 0.10, ttl_seconds: 1800, route: "claude"
})
// then: task_wait / cloud_agent_list; review PRs by evidence, merge.
```

Real numbers from the 100-run: 94 clean completions first pass, ~6 min median wall-clock, ≈$1.60 total EC2, zero marginal inference (OAuth sub), every commit authored `fermi-neutrino`. The 6 failures produced 2 fixes that are now defaults (auto-`out.diff`, boot-fetch retry). [Full story.](/blog/05-hundred-agents)

## Drive a logged-in web app from disposable agents

Send 60 differently-phrased test prompts through a web UI you're logged into (we did this against a ChatGPT connector for a work project):

```jsonc
// once, on the Mac: capture the session headfully
node tools/capture-session.mjs --name chatgpt --site https://chatgpt.com
// per agent:
cloud_agent_launch({
  prompt: "Using the leased 'chatgpt' session: send <prompt #17>, wait for the streamed answer, save it as answer.md",
  sessions: ["chatgpt"],
  proof_contract: "{\"kind\":\"artifact\",\"name\":\"answer.md\",\"min_bytes\":200}"
})
```

The boxes never see a cookie; the Mac executor drives one real browser with per-agent tabs. Lesson learned live: set the session's `max_concurrent` to your real fan-out *before* launching, not during. [Degradation postmortem.](/blog/07-bot-walls)

## Chat-ops from any messenger

```text
(Telegram) → "@fermi summarize what changed in fermi-daemon this week and
              draft the release notes into a gist"
```

Channel webhook → task queue → your Mac's harness claims it → replies in-thread. Works from WhatsApp/Discord/Slack identically. Unknown senders hit the pairing flow instead of the queue. Bots can also *launch neutrinos* — a Grok bot enqueueing `cloud_agent_launch` is just another MCP caller with `write:tasks`.

## The morning brief that knows your life

The 08:00 cron summarizes the last 24h of memories into your chosen channel. Zero setup beyond naming the chat: it reads what every host wrote all day. Small, but it's the feature people refuse to give back.

## One-shot: "make me an asset and get it to my phone"

"Generate three ν-glyph icon candidates, commit them to the assets repo, give me raw URLs I can save from my phone." One agent, artifact proof, links in the reply. The boring plumbing — R2 hosting, `/apps/*` gating, artifact upload — is what makes one-line requests land as files in your hand.

## Human-in-the-loop when the web demands a human

Booking flows, checkouts, MFA walls: `browser_session_request_human` pauses the cloud browser with a live-view URL; you finish the sensitive step on your screen; `browser_session_resume` hands it back. The agent does the 40 boring steps; you do the 1 that should be you.
