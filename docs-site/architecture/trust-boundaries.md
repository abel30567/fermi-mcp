# Trust boundaries

Where credentials live, where they stop, and what each boundary is worth. Numbered like defense layers; each names its enforcement in code.

## Layer 1 — Transport auth into the Worker

`FERMI_AUTH_ENABLED=true` wraps `/mcp`/`/sse` in OAuth (owner secret + optional TOTP at consent). Channel webhooks verify platform secrets. `/admin/*` demands the bearer token; `/box/*` demands a valid per-box token. *Enforcement: `src/index.ts`, `authBox` in `box-gateway.ts`.*

## Layer 2 — The tool guardrail pipeline

Plan-mode mutation block → approval gate for `risk: high` (single-use token, 300s) → deny-hooks → audit. *Enforcement: `lib/tool.ts`.* Honest note: approval redemption checks token existence, not argument equality.

## Layer 3 — Secret custody

Encrypted at rest; listing never returns plaintext; egress only through the gateway toward `allowed_hosts`; `secret_resolve` is opt-in per secret, rate-limited, audited. *Enforcement: `lib/secrets-store.ts`, `sandbox/` gateway.*

## Layer 4 — Box identity

A neutrino holds `<box_id>.<secret>` (hash at rest), scoped to `/box/*`. It cannot launch siblings, read admin state, or collect another box's results. The admin bearer token is **never** placed on a box. *Enforcement: `authBox`, box-scoped `browser-rpc/wait`; tests in `test/box-gateway.test.ts`, `test/session-broker.test.ts`.*

## Layer 5 — Session custody (the broker)

Cookies decrypt only on the Mac executor. Boxes get handles; ops are launch-bound, origin-bound, validity-rechecked, and `evaluate`-free. Revocation severs in-flight use at the next op. *Enforcement: `channels/broker.ts`; leak-witness tests.*

## Layer 6 — Supply chain

Boxes execute only a runner whose sha256 matches the operator-set pin; launch refuses unpinned; fetch failures and mismatches fail closed with telemetry. *Enforcement: `lib/runner-pin.ts` + tamper harness `test/shell/boot-pin-harness.sh`.*

## Layer 7 — Proof-of-work honesty

`/box/complete(done)` re-verifies the proof contract server-side; 422 on failure; the task never flips terminal on an unproven claim. Machine commits are attributed to `fermi-neutrino`, so a human diff of *who did what* is one `git log` away. *Enforcement: `lib/proof-contract.ts` in `box-gateway.ts`.*

## Layer 8 — Blast-radius economics

`max_concurrent`, monthly budget (soft), per-launch TTL (hard, reaper-enforced with termination confirmed), instance-type pinning. Worst case is bounded by TTL × rate × concurrency, not by hope. *Enforcement: `lib/fleet-config.ts`, `cron/fleet-reaper.ts`.*

## What we deliberately do not defend

::: warning Read this list before Tier 3+
- **A malicious Worker owner is out of scope.** You run the control plane; these layers protect you from compromised *edges* (a box, a stolen box token, a leaked session), not from yourself.
- **Prompt injection through content** (a web page a box reads, a channel message) is mitigated by scoping (origin binding, launch binding, allowlists) — not eliminated. Assume an injected box does its worst *within its scope* and size the scope accordingly.
- **The budget is advisory between polls.** TTL is the real backstop.
- **Bot walls are respected, not defeated.** Where a site demands proof of humanity, a human provides it once on their own hardware and the broker reuses that session. No CAPTCHA solving, no fingerprint spoofing, no attestation bypass. This is a values line, and it's also what keeps the whole design legible: every automated action is attributable to your own devices and identities.
:::
