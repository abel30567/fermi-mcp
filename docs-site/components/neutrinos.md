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

Every long-lived credential lives in one place, the Worker. Hosts and the operator reach the Worker with their own grants, the Worker spends the AWS key on three EC2 calls, and each box gets a single-use token that unlocks only what its own task needs.

<Diagram id="neutrinoAccess" />

The same thing over time: which credential is presented at each step of a launch.

<Diagram id="neutrinoAccessFlow" />

| Credential | Lives in | Presented by → to | Used for | Scope it |
|------------|----------|-------------------|----------|----------|
| AWS access key pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) | Fermi secrets | Worker → EC2 API (SigV4, `aws4fetch`) | `RunInstances` at launch; `TerminateInstances` from teardown and the reaper; `DescribeInstances` to confirm a box is gone and to sweep orphaned `fermi-fleet` instances | dedicated IAM user, [policy below](#least-privilege-iam-policy). Boxes never see it |
| Per-box token `<box_id>.<secret>` | box user-data only; Worker keeps the sha256 in D1 | box → `/box/*` | poll, heartbeat, artifact, inference-auth, session-lease, browser-rpc, `/box/mcp`, complete, report | one box, one agent; marking the box destroyed revokes it |
| `CLAUDE_CODE_OAUTH_TOKEN` (or `_<ACCOUNT>`), `CPA_AUTH_CODEX` / `CPA_AUTH_XAI` / `CPA_API_KEY` | Fermi secrets | Worker → box via `/box/inference-auth`, then box → provider | inference for the box's route only, called directly (never through your Mac). **Inference is not billed to the budget**, EC2 wall-clock is | only the launch's route is handed out; codex/grok boxes may write back only their own refreshed bundle |
| `GITHUB_TOKEN` | Fermi secrets | Worker → box via `/box/inference-auth`, then box → GitHub | clone, push, open the PR | only handed to boxes whose task names a `repo`; fine-grained token, only the repos agents work |
| Host OAuth grant with `write:fleet` | the host | host → `/mcp` | `cloud_agent_launch` / `followup` / `stop` / `destroy` | read-only grants can list and get, not launch |
| Admin bearer (`FERMI_BEARER_TOKEN`) | Worker env, operator's machine | `fleetctl` → `/admin/fleet/*` | `fleet:config` and the runner pin | operator only |
| `fleet:config` in KV | KV | read by the Worker | region, instance type, `allowed_instance_types`, `max_concurrent`, `monthly_budget_usd`, `runner_ref`+`runner_files` (path → sha256; legacy `runner_sha256` still honoured), TTLs | `GET`/`POST /admin/fleet/config` (bearer) for the operator fields; `pin-runner` for the pin (`{ref}` or `{ref, files: {path: sha256}}`) |

The runner fetch at boot uses no credential at all: files come from `raw.githubusercontent.com` at the pinned SHA and are sha256-checked before the box token is even written to disk.

### Least-privilege IAM policy

The Worker makes exactly three EC2 calls (`packages/worker/src/lib/aws-ec2.ts`), and none of them pass a key pair, an instance profile, a subnet or a security group. So the key needs no `iam:PassRole`, no key-pair, SSM, S3 or IAM actions, and boxes have no AWS credentials of their own. Instances land in the region's default VPC with its default security group.

Create a dedicated IAM user (programmatic access only, no console) with this policy. Replace `REGION` (your `fleet:config` region, default `us-east-1`), `ACCOUNT_ID` and `AMI_ID` (the `image_ref` of your `cloud_env_snapshot`), and keep the instance-type list in step with `allowed_instance_types`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LaunchOnlyTaggedAllowedSizes",
      "Effect": "Allow",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:REGION:ACCOUNT_ID:instance/*",
      "Condition": {
        "StringEquals": {
          "aws:RequestTag/fermi-fleet": "true",
          "ec2:InstanceType": ["t3.small", "t3.medium", "t3.large"]
        }
      }
    },
    {
      "Sid": "LaunchOnlyTheBakedImage",
      "Effect": "Allow",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:REGION::image/AMI_ID"
    },
    {
      "Sid": "LaunchSupportingResources",
      "Effect": "Allow",
      "Action": "ec2:RunInstances",
      "Resource": [
        "arn:aws:ec2:REGION:ACCOUNT_ID:volume/*",
        "arn:aws:ec2:REGION:ACCOUNT_ID:network-interface/*",
        "arn:aws:ec2:REGION:ACCOUNT_ID:subnet/*",
        "arn:aws:ec2:REGION:ACCOUNT_ID:security-group/*"
      ]
    },
    {
      "Sid": "TagOnlyAtLaunch",
      "Effect": "Allow",
      "Action": "ec2:CreateTags",
      "Resource": "arn:aws:ec2:REGION:ACCOUNT_ID:instance/*",
      "Condition": { "StringEquals": { "ec2:CreateAction": "RunInstances" } }
    },
    {
      "Sid": "TerminateOnlyFleetInstances",
      "Effect": "Allow",
      "Action": "ec2:TerminateInstances",
      "Resource": "arn:aws:ec2:REGION:ACCOUNT_ID:instance/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/fermi-fleet": "true" } }
    },
    {
      "Sid": "DescribeInFleetRegion",
      "Effect": "Allow",
      "Action": "ec2:DescribeInstances",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "REGION" } }
    }
  ]
}
```

| Statement | Called from | What it prevents |
|-----------|-------------|------------------|
| `LaunchOnlyTaggedAllowedSizes` | `runInstance` at launch | launching anything untagged, or a size outside your list, even with a leaked key |
| `LaunchOnlyTheBakedImage` | `runInstance` | booting any AMI but yours. Update it when you register a new `cloud_env_snapshot` (or swap it for an `ec2:Owner` = `ACCOUNT_ID` condition on `image/*` if you rotate images often) |
| `LaunchSupportingResources` | `runInstance` | EC2 authorises the root volume, ENI, subnet and security group of every launch; these are scoped to your account and region |
| `TagOnlyAtLaunch` | the `TagSpecification` on `RunInstances` | retagging existing instances `fermi-fleet=true` to make them terminable |
| `TerminateOnlyFleetInstances` | `dispatchTeardown`, the reaper, the orphan sweep | terminating anything in the account that Fermi did not launch |
| `DescribeInFleetRegion` | `isInstanceTerminated`, `listFleetInstances` | `DescribeInstances` has no resource-level scoping, so it is pinned to the fleet region instead |

Two optional extras. If your account encrypts EBS by default with a customer-managed KMS key, the user also needs `kms:CreateGrant`, `kms:GenerateDataKeyWithoutPlaintext` and `kms:Decrypt` on that key (the AWS-managed `aws/ebs` key needs nothing). And an EC2 vCPU service quota in the region is a hard backstop under `max_concurrent` and `monthly_budget_usd`.

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
