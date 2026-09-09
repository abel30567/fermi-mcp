# 8. Pinning the runner

The last scar is the one that was hiding in plain sight the whole time. Every neutrino boots by fetching a script off the internet and running it. For most of the fleet's life, that fetch was `curl <url> | node` — and I looked at it every day without seeing the problem.

## The quiet footgun

A box's EC2 user-data downloaded `box-runner.mjs` from a raw GitHub URL and executed it. Think about what that trusts: GitHub's availability, the branch not having moved, the network path not being tampered, the file being exactly what I think it is. `curl | node` as a boot process means **whatever that URL returns becomes root on a box that then receives a Claude OAuth token, a GitHub token, and a broker handle to my logged-in sessions.** The supply chain was one mutable URL, and I'd been shipping it.

Nothing went wrong. That's not reassurance — it's the shape of supply-chain risk. It costs nothing right up until it costs everything, and "it's been fine" is exactly the sentence that precedes the incident.

## The fix: pin the hash, fail closed

The runner is now pinned. The operator sets a specific commit ref *and* its sha256 into `fleet:config`; boxes fetch that exact ref and **verify the hash before executing a byte**:

```
fleetctl pin-runner   # writes runner_ref + runner_sha256
```

Three properties, all fail-closed:

1. **Launch refuses while unpinned.** No pin, no fleet. You cannot accidentally run the unprotected path; the safe path is the only path.
2. **Hash mismatch aborts.** If the fetched file doesn't match the pin — tampered, truncated, wrong ref — the box runs *nothing* and reports the failure. A wrong runner is a non-event, not a compromise.
3. **The tamper case is a test.** `test/shell/boot-pin-harness.sh` serves a tampered file and asserts the boot fails closed with nothing installed. The guarantee is executable, not aspirational.

The retry from [the 100-agent run](/blog/05-hundred-agents) lives here too: `curl --retry 4 --retry-delay 3 --retry-all-errors`, so a CDN hiccup is a slow boot, not a dead box — availability and integrity in the same few lines.

## The lesson

The boot path is part of the trust model, and it's the part you stop seeing precisely because it's always there. "It's been fine" is not a security property. Anything an agent *executes* deserves the same scrutiny as anything it's *granted* — pin it, hash it, fail closed, and make the safe path the only path so that being careful isn't a thing you have to remember to do.

---

That's the series. The through-line, one more time: **every mechanism in Fermi that looks paranoid is a postmortem.** Proof contracts, queue isolation, the broker, forced attribution, the values line on bot walls, the runner pin — none were designed up front. Each is a scar, and the system is trustworthy in the specific, narrow ways it has been hurt. That's the only kind of trustworthy that's real. If you run this yourself, you'll earn a few scars of your own — and I'd genuinely like to hear about them: [open an issue](https://github.com/abel30567/fermi-mcp/issues).
