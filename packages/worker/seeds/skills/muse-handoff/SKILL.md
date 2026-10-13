---
name: muse-handoff
description: Hand a task from a Claude Code agent to Muse (Meta's personal agent) via the Fermi muse queue and wait for the result
keywords: ["muse", "meta muse", "meta", "handoff", "delegate", "task queue"]
allowed_tools: ["task_enqueue", "task_wait", "task_list", "fs_read"]
---
# Muse handoff (sender side)

Muse is Meta's personal agent, running on its own cloud computer with its own
inference, connectors (Zapier, custom API connectors) and a browser sub-agent.
It reads the `muse` queue directly through its Fermi MCP connection. Hand it
the WHOLE ask.

## 1. Enqueue one task per ask
```
task_enqueue({
  channel: "cloud", queue: "muse", chat_id: "muse",
  sender: "cc:<host>/<session>",
  payload: JSON.stringify({ v: 1, ask, context, repo, expected_output, deadline_min: 30 })
})
```
- Queue is `muse`, never `main` (the Mac drain workers claim `main`).
- Do NOT pre-split a job into many muse tasks. Give full context and one clear
  `expected_output`. Separate unrelated asks may be separate tasks.
- `repo` is optional (`owner/name`). Raise `deadline_min` for big jobs.
- Good fits: work in the owner's Meta-connected apps or Muse's connectors,
  web research, browsing sites with no API.

## 2. Wait
Loop `task_wait({ id, timeout_seconds: 120 })` until `done`/`failed` or
`deadline_min` passes. `timeout` only means "not yet": call again.

## 3. Read the result
If the result starts with `fs:`, the full output is a file: `fs_read({ path })`
with the rest of the string (e.g. `fs:handoff/<id>.md` → `handoff/<id>.md`).

## 4. On deadline
Report "Muse hasn't finished <id>" to your user and stop. Do not re-enqueue;
`task_list({ queue: "muse" })` shows whether it was claimed.

## Rules
- No secrets in payloads; reference a Fermi secret by name if needed.
- Muse drafts anything outward-facing (email, posts) for the owner's approval
  instead of sending it.
