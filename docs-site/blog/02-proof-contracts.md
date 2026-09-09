# 2. Agents lie: proof contracts

Not maliciously. Worse: *confidently*. Give a fleet of agents a free-text "definition of done" and a completion endpoint, and some fraction will report success on work that doesn't exist. At fleet scale, "some fraction" is a number you meet every day.

## The exploits we wrote against ourselves

Before hardening `/box/complete`, we red-teamed it. Two attacks fell out immediately, both embarrassingly effective:

- **The HOTEL replay**: an agent told to produce an artifact simply reports `done` with a prose summary — "all finished, everything works." The endpoint accepted prose. Done meant nothing.
- **The empty-evidence replay**: an agent learns the magic words. It reports `RESULT: PROOF_OK` — the *format* of proof with none of the substance. Pattern-matching on success strings is worse than nothing because it *feels* like verification.

Both are now literal test cases (`test/proof-contract.test.ts`, names and all), which is the correct fate for any exploit you find in your own system.

## The fix: make "done" a claim that gets checked

A proof contract is structured JSON attached at launch, and `/box/complete` re-verifies it **server-side** before accepting `done`:

```jsonc
{"kind":"artifact","name":"out.diff","min_bytes":1}       // must exist in R2, that big
{"kind":"artifact","name":"build.tgz","sha256":"..."}      // must hash to that
{"kind":"http","url":"https://.../health","expect_status":200}
{"kind":"test","cmd":"npm test"}                            // ↓ see honesty note
```

Fail the check → HTTP 422 `proof_unverified`, and — the important part — **the task stays claimed, not terminal.** The box can fix its work or fail honestly. And honest failure is *always* accepted: you need proof to claim success, never to give up. Get that backwards and agents learn to avoid reporting failure, which is how you lose telemetry exactly when you need it.

## The parts that keep it honest

- **Unverifiable kinds are labeled, not laundered.** The Worker can't run `npm test`; those complete tagged `completed_unverified` for the orchestrator to replay. Verification theater is worse than a declared gap.
- **Legacy prose contracts are grandfathered** — refusing to break the past is what let the strict path deploy the same day.
- **Boxes self-check before submitting** (`box-runner.mjs` runs the contract locally and takes one corrective pass), so the server-side 422 is the backstop, not the workflow.

## The lesson

Trust at scale isn't a virtue, it's a bug. The generalization we now apply everywhere: **any success signal an agent can type is a success signal an agent will eventually type.** Verification must consume evidence the agent had to *produce*, checked by a party the agent isn't.

Next: the day the thief was inside the house — [The task-theft incident](/blog/03-task-theft).
