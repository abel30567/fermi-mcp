# 3. The task-theft incident

The symptom made no sense: cloud agents launching fine, booting fine — then their tasks completing as *failures* within seconds, with `claimed_by: null` in the wreckage, before the box had even finished booting.

## The hunt

We suspected the box (a boot bug?), then the queue (a lease bug?), then the proof gate (over-strict?). All innocent. The actual thief was the **warm worker on my own Mac** — the helpful little process from Tier 2 whose job is: "if any tasks are pending, claim and run them."

The fleet had been built on the same task table as everything else (by design — one boring queue, [post 1](/blog/01-control-plane)). A neutrino's work order sat in `agent:<id>` as a pending task. The Mac's drain loop asked the Worker "anything pending?" — and the unscoped pending count said *yes*. The drain claimed the fleet's task, had no idea what to do with a box work-order, and fast-failed it. The box then booted into an empty queue and idled to TTL. Every component functioned exactly as written. The *composition* was the bug.

## Why it took hours

Because nothing was broken. No errors, no crashes — just work evaporating between two correct subsystems. Distributed-systems debugging truism, paid for again: **when two loops share a resource, the bug lives in neither loop.** The tell, in hindsight, was `claimed_by: null` — the channel drain claimed anonymously, while boxes always claim as themselves. The forensics were in the metadata all along.

## The fix: ownership, stated three times

1. The unscoped pending count now **excludes** `agent:%` and `broker:%` queues — the drain's wake-up signal can't even see fleet work (`countPendingTasks`, `lib/task-store.ts`).
2. `task_claim` **refuses** fleet queues outright with a typed error, `fleet_queue_off_limits` — defense against any *other* well-meaning drainer, present or future.
3. `isFleetQueue()` is a named, exported predicate — the ownership rule is code, not comment.

One incident, three fences, because the second occurrence of a composition bug is unforgivable.

## The lesson

Namespaces are not organization, they're *authorization*. A queue name is a claim about who may consume it; if that claim isn't enforced, every consumer you add is a future incident. We now treat "who drains this?" as a schema-level question — answered in the store, not in the politeness of callers.

Next: the credential problem that scale forces — [Cookies never leave home](/blog/04-session-broker).
