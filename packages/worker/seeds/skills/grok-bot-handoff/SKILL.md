---
name: grok-bot-handoff
description: Hand a task from a Claude Code agent to Grok Bot (the owner's Chief of Staff) via the Fermi grok-bot queue and wait for the result
keywords: ["grok", "grok bot", "chief of staff", "handoff", "delegate", "task queue"]
allowed_tools: ["task_enqueue", "task_wait", "task_list", "fs_read"]
---
# Grok Bot handoff (sender side)

Grok Bot reads the `grok-bot` queue directly and runs each task on its own
inference, splitting it across its own sub-agents. Hand it the WHOLE ask.

## 1. Enqueue one task per ask
```
task_enqueue({
  channel: "cloud", queue: "grok-bot", chat_id: "grok-bot",
  sender: "cc:<host>/<session>",
  payload: JSON.stringify({ v: 1, ask, context, repo, expected_output, deadline_min: 30 })
})
```
- Queue is `grok-bot`, never `main` (the Mac drain workers claim `main`).
- Do NOT pre-split a job into many grok-bot tasks. Grok Bot decomposes and
  parallelizes better than a sender can; give it full context and one clear
  `expected_output`. Separate unrelated asks may be separate tasks.
- `repo` is optional (`owner/name`). Raise `deadline_min` for big jobs.

## 2. Wait
Loop `task_wait({ id, timeout_seconds: 120 })` until `done`/`failed` or
`deadline_min` passes. `timeout` only means "not yet": call again.

## 3. Read the result
If the result starts with `fs:`, the full output is a file: `fs_read({ path })`
with the rest of the string (e.g. `fs:handoff/<id>.md` → `handoff/<id>.md`).

## 4. On deadline
Report "Grok Bot hasn't finished <id>" to your user and stop. Do not
re-enqueue; `task_list({ queue: "grok-bot" })` shows whether it was claimed.

## Rules
- No secrets in payloads; reference a Fermi secret by name if needed.
- Grok Bot drafts anything outward-facing (email, posts) for the owner's
  approval instead of sending it.
