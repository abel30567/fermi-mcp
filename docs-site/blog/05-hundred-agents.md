# 5. 100 agents, one afternoon

The question was simple enough to be dangerous: *can we launch a hundred?* One agent per multivariable-calculus function, each writing code and tests into a testbed repo, all at once. The answer was yes — but the six that failed taught more than the ninety-four that worked.

## What went right (and why it's boring)

Ninety-four boxes booted, claimed their function, wrote it with tests, pushed a branch, opened a PR, satisfied their proof contract, and terminated. Median wall-clock ~6 minutes. Total EC2 cost about **$1.60**. Marginal inference cost: zero — every box authenticated to my Claude subscription with an OAuth token, so a hundred agents cost the same inference as one.

That it was boring is the point. Proof contracts meant I reviewed *evidence* — 94 diffs, 94 green test runs — not 94 cheerful summaries. The broker meant none of the boxes touched a credential. The queue meant I typed a loop, not a platform.

## The six failures, ranked by how much they taught

**Four boxes: the forgotten diff.** The proof contract demanded `out.diff`, an agent did the work but never generated the artifact, and got a correct, useless 422. The fix wasn't stricter enforcement — it was removing the footgun: `box-runner.mjs` now **auto-generates `out.diff`** from the repo state before completion. The agent shouldn't fail a proof for forgetting to package evidence it clearly produced. *Make the honest path the default path.*

**Two boxes: never booted.** No report, no artifact, no crash — just silence to TTL. This one was nasty because the box was the suspect and the box was innocent. A hundred boxes booting in the same few seconds all `curl`ed the runner from the same CDN edge, and the edge **throttled the burst**. Two lost the race and died before they had a runner to report with. Fix: the boot fetch now retries (`curl --retry 4 --retry-delay 3 --retry-all-errors`). Burst scale breaks things that unit scale never reveals.

## The instrumentation that made it debuggable

The reason "never booted" was solvable at all: by the 100-run, `box-runner.mjs` reported at every step — lease, spawn, fatal-crash handlers all phoning `/box/report`. A box that dies now says *where*. The two silent failures were silent precisely because they died *before* the reporting was armed (during the fetch), which is exactly what pointed at the fetch. **Telemetry that covers every stage turns a silent failure into an arrow.**

## The budget non-lesson

`budget_usd` did its job, but it's worth stating what its job *is*: a soft cap checked between polls, not a circuit breaker. At 100× concurrency a soft cap can overshoot before the next poll notices. The real backstop is TTL — every box dies at its deadline whether or not the budget math kept up. Size the TTL for worst-case cost; treat the budget as a nudge.

## The lesson

Scale is a different environment, not more of the same one. Every failure here was invisible at N=3 and inevitable at N=100: CDN burst-throttling, forgotten-artifact rates, the gap between "budget" and "guarantee." You cannot reason your way to these; you have to run the hundred. Which is the argument for making a hundred cheap enough to run casually — the fleet pays for itself the first afternoon it surfaces a bug your test suite never could.

Next: why all those commits were, briefly, from the wrong person — [Committing as root](/blog/06-committing-as-root).
