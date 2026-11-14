# Neutrinos: the cloud fleet

**Status:** Tier 4. Code: worker `src/lib/fleet-*`, `src/channels/box-gateway.ts`, `src/do/fleet-do.ts`, `src/cron/fleet-reaper.ts`; boot script `box-runner.mjs` in fermi-daemon. Verified at 100 concurrent agents.

A **neutrino** is a disposable EC2 box born for one task: it boots, claims its task from the Worker, runs a coding harness, uploads evidence, satisfies a machine-checked proof contract, and terminates. You never SSH into one. You never keep one.

## Lifecycle

<Diagram id="neutrinoLifecycle" />

## How a launch flows through the system

1. **Any MCP host** (or the daemon, or another agent) calls `cloud_agent_launch` with:

```jsonc
{
  "prompt": "Add a gradient() function to testbed with tests",
  "proof_contract": "{\"kind\":\"artifact\",\"name\":\"out.diff\",\"min_bytes\":1}",
  "route": "claude",          // or "codex" | "grok"
  "budget_usd": 0.25,          // soft cap, EC2 wall-clock only
  "ttl_seconds": 3600,
  "skills": ["github-api"],    // Fermi skills preloaded into the box context
  "sessions": ["gmail"],       // web sessions the box may lease — named or nothing
  "repo": "you/testbed", "branch": "agent/gradient"
}
```

2. The Worker enqueues the task on a private queue `agent:<id>`, checks `max_concurrent` and the monthly budget, and calls EC2 `RunInstances` (signed with your AWS keys from the secrets store, via `aws4fetch` — no SDK). User-data contains only the **pinned fetch**: download every pinned file (`box-runner.mjs` plus any shared modules in the manifest) at a specific commit SHA into the same relative layout under `/opt/fermi`, verify each sha256 against the pin, refuse to run if any file is missing or mismatched.
3. The box authenticates every call with its **per-box token** `<box_id>.<secret>` (hashed at rest) against the `/box/*` gateway: `poll` → claim the task, `heartbeat`, `artifact` (upload evidence to R2), `inference-auth` (fetch the Claude OAuth token), `session-lease` (broker handle, never cookies), `complete`, `report` (crash telemetry — every fatal path phones home).
4. The runner sets the git identity to `fermi-neutrino` — machine commits are visibly machine commits — runs the chosen harness, auto-generates `out.diff` if the agent forgot, and self-checks the proof contract locally *before* submitting, running one corrective pass if it would fail.
5. `/box/complete` re-checks the proof contract **server-side** (`lib/proof-contract.ts`). `done` without satisfiable proof → HTTP 422, task stays claimed, the box may fix its work or fail honestly. Honest failure is always accepted.
6. The reaper cron (every 5 min) terminates TTL-expired boxes and only marks them `destroyed` after EC2 confirms.

## Proof contracts

Free-text "definition of done" invites confident lying (["Agents lie"](/blog/02-proof-contracts)). Contracts are structured JSON, checked mechanically:

| kind | Checked by worker | Example |
|------|-------------------|---------|
| `artifact` | existence, `min_bytes`, `sha256` in R2 | `{"kind":"artifact","name":"out.diff","min_bytes":1}` |
| `http` | `expect_status`, `body_matches` | health endpoint returns 200 |
| `test` | unverifiable worker-side → completes tagged `completed_unverified` for orchestrator replay | `{"kind":"test","cmd":"npm test"}` |
| `dom` | same as `test` | selector/text match on a page |

Legacy free-text contracts are grandfathered; new launches should always pass structured JSON.

## What access this tier needs (and nothing more)

| Grant | Why | Scope it |
|-------|-----|----------|
| AWS access key pair | `RunInstances`/`TerminateInstances`/`DescribeInstances` | IAM policy limited to those actions, one region, your fleet security group |
| `CLAUDE_CODE_OAUTH_TOKEN` in Fermi secrets | boxes inference on your existing Claude subscription — **inference is not billed to the budget**, EC2 wall-clock is | it's your sub; rotate from your Anthropic account |
| `GITHUB_TOKEN` in Fermi secrets | clone/push/PR | fine-grained token, only the repos agents work |
| `fleet:config` in KV | region, instance type, `allowed_instance_types`, `max_concurrent`, `monthly_budget_usd`, `runner_ref`+`runner_files` (path → sha256; legacy `runner_sha256` still honoured), `harness` (hbar pin, `null` by default), TTLs | `GET`/`POST /admin/fleet/config` (bearer) for the operator fields; `pin-runner` for the pin (`{ref}` or `{ref, files: {path: sha256}}`); `pin-harness` for `harness` |

Cost intuition: a `t3.small` is $0.0208/hr. The 100-agent run (~6 minutes median per box) cost about **$1.60 of EC2** and zero marginal inference.

Sizing: `t3.small` (2 GiB) is fine for Python-only verifiers and small fixes. Node/TypeScript builders — `tsc` on large repos, type-aware ESLint, jest/vitest, `cdk synth` — OOM-kill the harness there; launch those with `instance_type: "t3.medium"` (4 GiB). The type must be in `allowed_instance_types`, is stored on the agent, and prices its accrual.

## Operating it

```bash
fleetctl pin-runner        # after ANY box-runner.mjs change — launch refuses unpinned
cloud_agent_launch ...     # from any host
cloud_agent_list / get     # status, exit_reason, accrued cost, inference telemetry
cloud_agent_followup       # send a follow-up prompt to a live box (agent_stalled if its runner died)
cloud_agent_stop / destroy # manual kill switch
```

### Harness pin: hbar on route `claude`

Boxes on route `claude` run **hbar** when a harness is pinned and fall back to the image's Claude Code otherwise. The runner starts `CLAUDE_BIN` from `/etc/fermi/box.env` (default `claude`), so the switch lives entirely in user-data. Codex and Grok boxes are unaffected; with no pin (or no `mcp_base_url`, which the box needs to reach the server) the user-data is unchanged.

```bash
# 1. Upload the Linux x64 tarball (holds `cli` and `vendor/`) to FERMI_BUCKET as harness/<name>.
#    Streamed, never buffered; stored only if the body hashes to the header.
SHA=$(sha256sum hbar-linux-x64.tar.gz | cut -d' ' -f1)
curl -fsS -X PUT -H "Authorization: Bearer $FERMI_BEARER_TOKEN" -H "x-content-sha256: $SHA" \
  --data-binary @hbar-linux-x64.tar.gz "$FERMI_URL/admin/fleet/harness?name=hbar-linux-x64.tar.gz"
# → {"ok":true,"name":"hbar-linux-x64.tar.gz","size":…,"sha256":"…"}

# 2. Pin it. Refused unless the object exists and its stored sha256 equals `sha256`.
curl -fsS -H "Authorization: Bearer $FERMI_BEARER_TOKEN" -H 'content-type: application/json' \
  -d "{\"name\":\"hbar-linux-x64.tar.gz\",\"sha256\":\"$SHA\",\"version\":\"2.1.0\"}" \
  "$FERMI_URL/admin/fleet/pin-harness"

# 3. Clear it: new boxes run Claude Code again.
curl -fsS -H "Authorization: Bearer $FERMI_BEARER_TOKEN" -H 'content-type: application/json' \
  -d '{"clear":true}' "$FERMI_URL/admin/fleet/pin-harness"
```

Names match `[a-z0-9][a-z0-9._-]{0,80}\.tar\.gz`; `version` (`[A-Za-z0-9._+-]{1,40}`) is a display string. `harness` is not settable through `POST /admin/fleet/config`; `GET /admin/fleet/config` shows it. Bodies up to ~95 MB work.

What a box does, after writing `box.env` and before starting the runner: download `GET /box/harness` with its box token (180 s limit), check the sha256 written into its user-data, unpack into `/opt/hbar/<first 12 hex of sha256>/` (readable and executable by every user), run `cli --version` (30 s limit), and only if that exits 0 append `CLAUDE_BIN=/opt/hbar/<…>/cli` to `box.env`. Any failed step removes what was unpacked, appends nothing, and the boot goes on with Claude Code. The harness install never fails the boot, unlike the runner pin.

Which harness a box ran: the box posts one `/box/report` note, visible in `GET /admin/fleet/status?id=<agent>` events (`cloud_agent_get`). It changes no liveness field.

| Note | Meaning |
|------|---------|
| `harness: hbar <version>` | hbar installed and named in `CLAUDE_BIN` |
| `harness: claude (hbar <version> not installed: <step>)` | fell back to Claude Code; `<step>` is `download`, `sha256`, `unpack` or `start` (`cli --version` failed) |

No note means the report itself failed; the box still booted. Tested by `bash packages/worker/test/shell/boot-harness-install.sh`.

Liveness is on the agent record, not in the event log: `last_heartbeat_at` (runner check-in), `last_working_event_at` (last harness progress note), `restart_count`, `instance_type`. The reaper fails an agent `runner_stalled` and terminates its box when heartbeats go stale, and the box gateway fails it `runner_restarted` when a pre-resume runner announces a fresh boot over held work — in both cases the work task fails too, so `task_wait` returns instead of hanging until TTL.

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `launch refuses: runner not pinned` | intended | `fleetctl pin-runner` |
| Box never boots, no report | CDN throttled the runner fetch under burst | fixed: runner fetch retries 4× ; check `/box/report` telemetry |
| `422 proof_unverified` loops | contract genuinely unsatisfiable | fix the contract, or let the box fail honestly |
| Fleet tasks claimed by your Mac | ancient worker | update — fleet queues are drain-isolated |
| Cost above budget | soft cap raced between polls | budgets bound *expected* spend; TTL bounds worst case |
| `working: turns=N` then `runner up`, then silence | runner OOM-killed mid-task and restarted (2 GiB box, Node tooling) | runner ≥ f9befad resumes the held task; worker fails older runners as `runner_restarted`; relaunch on `t3.medium` |
| Agent `running`, box heartbeat stale | runner process died for good | reaper fails it `runner_stalled` within `heartbeat_stale_ms` (10 min) and tears the box down |
