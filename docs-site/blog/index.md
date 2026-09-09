# The journey

Fermi wasn't designed; it accreted around failures. This series is the honest record — each post is one problem that drew blood, the wrong turns taken in order, and the mechanism that exists in the codebase today because of it. Read in order for the arc, or jump to the scar you're about to earn yourself.

| # | Post | The scar | The mechanism it left |
|---|------|----------|----------------------|
| 1 | [Why I built my own control plane](/blog/01-control-plane) | every host a stranger, every session an intro | the Worker: one MCP server, shared state |
| 2 | [Agents lie: proof contracts](/blog/02-proof-contracts) | "RESULT: PROOF_OK" on work never done | machine-checked contracts, 422 on unproven `done` |
| 3 | [The task-theft incident](/blog/03-task-theft) | my own Mac stealing my fleet's homework | fleet-queue isolation from the channel drain |
| 4 | [Cookies never leave home](/blog/04-session-broker) | 100 VMs each wanting my logins | the session broker |
| 5 | [100 agents, one afternoon](/blog/05-hundred-agents) | burst-scale reality: CDN throttles, forgotten diffs | boot-fetch retry, auto-`out.diff`, crash telemetry |
| 6 | [Committing as root](/blog/06-committing-as-root) | machine commits wearing the wrong name | the `fermi-neutrino` identity, env-forced authorship |
| 7 | [Bot walls and where we draw the line](/blog/07-bot-walls) | Turnstile, skeleton screens, press-and-hold | persistent profiles, page-alive-on-failure, and a values line |
| 8 | [Pinning the runner](/blog/08-runner-pin) | curl-pipe-node as a boot process | SHA-pinned, fail-closed runner fetch |

The meta-lesson, if you want it up front: **every mechanism in Fermi that looks paranoid is a postmortem.** The system trusts less than it did a month ago and works better because of it.
