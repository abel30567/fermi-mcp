# Access you must grant

Every tier of Fermi is a trust decision. This page enumerates exactly what each component holds, where it sits, and what its blast radius is if compromised. No prose reassurances — read the table, decide per row.

## The grants, by tier

| Grant | Held by | Stored where | Needed for | Blast radius if leaked |
|-------|---------|--------------|------------|------------------------|
| Cloudflare account | you | wrangler auth on your machine | Tier 1 deploy | your CF account |
| `FERMI_BEARER_TOKEN` | Worker + daemon + broker executor | Worker secret; Mac `.env` | all `/admin/*` endpoints | **full control plane**: launch fleet, read session state, drain queues |
| `FERMI_SECRETS_KEY` | Worker | Worker secret | encrypting your stored secrets | offline decryption of the secrets table (needs D1 access too) |
| `FERMI_OWNER_SECRET` (+ TOTP) | Worker | Worker secret | OAuth consent gate | attacker can authorize new MCP clients |
| `ANTHROPIC_API_KEY` | Worker | Worker secret | channel inference only | API spend |
| `MACOS_MCP_TOKEN` | Worker + MacOSMCP | Worker secret; Mac config | Tier 3 `mac_*` tools | remote shell on your Mac (approval-gated at the tool layer) |
| AWS keys (EC2 scope) | Worker | Fermi secrets store, host-allowlisted to `*.amazonaws.com` | Tier 4 launch/terminate | EC2 spend + instances in one region |
| `CLAUDE_CODE_OAUTH_TOKEN` | Worker → each box | Fermi secrets store; injected into box env at provision | box inference on your subscription | your Claude subscription usage |
| `GITHUB_TOKEN` | Worker → boxes needing repo work | Fermi secrets store | agent pushes/PRs | your repos, to the token's scope |
| Web session cookies | **Mac broker executor only** | D1 encrypted at rest; decrypted only on the Mac | session-brokered browsing | the captured site session — and only until you `web_session_invalidate` |

## Design rules that bound each grant

1. **Per-box tokens, not the admin token, on fleet boxes.** A neutrino authenticates as `<box_id>.<secret>`; the secret is hashed at rest and scoped to the `/box/*` gateway. A stolen box token can claim that box's task and post artifacts — it cannot call `/admin/fleet/launch` or read another box's results (`wait` is box-scoped; tested in `test/session-broker.test.ts`).
2. **Secrets are allowlisted, then injected.** A stored secret carries `allowed_hosts` and `allowed_capabilities`. The sandbox and browser lanes see <code v-pre>{{secret:NAME}}</code> placeholders; the gateway expands them only toward allowlisted hosts. `secret_resolve` (plaintext to the model) must be explicitly enabled per secret and is rate-limited and audited.
3. **Cookies never ride to boxes.** Fleet agents get a *broker handle*, never `storageState`. Every browser op round-trips the Worker, which re-checks session validity — `web_session_invalidate` cuts off in-flight agents at their next op. Leak witness tests assert the canary cookie never crosses. See [The session broker](/components/session-broker).
4. **The boot path is pinned.** Boxes fetch `box-runner.mjs` at a pinned commit SHA and verify its sha256 before executing; mismatch fails closed and the box reports rather than runs. Launch refuses when no pin is set.
5. **High-risk tools are approval-gated** (mint-token-then-redeem, single use, 300s TTL), everything is audited to D1, and plan mode blocks mutation wholesale.

## Threat-model honesty

::: warning What the rules above do NOT guarantee
- The budget cap is **soft**: accrual is checked between polls, not enforced by AWS. A runaway box costs money until the TTL reaper or you kill it.
- The approval gate keys on token *presence*, not argument re-verification (args are hashed for audit, not re-compared).
- MacOSMCP behind a tunnel is a remote-control surface for anyone holding both your Worker auth and a connected host. Host discipline is part of the perimeter.
- Channel allowlists gate who can *enqueue* work; they do not sandbox what a queued task may ask for. Prompt-injection through channel content remains your risk to manage.
:::

## The minimum-grant configurations

- **Paranoid useful:** Tier 1 + Tier 2 without MacOSMCP. Nothing can push into your Mac; the Mac only pulls.
- **Reference deployment:** all tiers, with: fleet region pinned, `t3.small`, `max_concurrent` 5, budget $50/mo, runner pinned, sessions named per-launch, broker executor on one Mac only.
