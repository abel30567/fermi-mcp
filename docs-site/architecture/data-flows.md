# Data flows, state by state

Each lifecycle in the system, as the data actually moves. Conventions: every diagram names its enforcement points; anything crossing a trust boundary says what crosses. If a flow isn't here, it doesn't exist.

[[toc]]

## 1. MCP tool call (any host)

```mermaid
sequenceDiagram
    participant H as Host
    participant W as Worker router
    participant DO as FermiMCP DO
    participant D1 as D1
    H->>W: POST /mcp (OAuth session)
    W->>DO: route to the agent DO
    DO->>DO: plan-mode check → approval gate (risk:high) → deny-hooks
    DO->>D1: execute handler against stores
    DO->>D1: audit row (tool, args_hash, outcome, ms, bytes)
    DO-->>H: result
```

State machine for a `risk: high` call: `no token → pending_approval (token minted, KV TTL 300s) → host retries with token → token deleted (single use) → executed`.

## 2. Channel message → reply

```mermaid
sequenceDiagram
    participant U as User on Telegram / Discord / Slack
    participant W as Worker
    participant D1 as D1 tasks
    participant M as Mac warm-worker / poll.sh
    U->>W: /tg/webhook or /dc/webhook or /sl/webhook
    W->>W: allowlist check (sender enumerable, pairing flow for unknowns)
    W->>D1: enqueue(queue: main)
    M->>W: pending? → claim (lease)
    M->>M: Claude Code harness runs, uses Fermi MCP tools
    M->>W: channel_send + task_complete
    W->>U: reply via channel REST
```

## 3. Neutrino: launch → proof → terminate

```mermaid
sequenceDiagram
    participant O as Orchestrator (any host)
    participant W as Worker
    participant E as EC2
    participant B as Box
    participant R2 as R2
    O->>W: cloud_agent_launch{prompt, proof_contract, sessions[], budget, ttl}
    W->>W: max_concurrent? budget? runner pinned? — refuse otherwise
    W->>E: RunInstances (user-data: fetch runner @SHA, verify sha256)
    E-->>B: boot
    B->>W: /box/poll (token box_id.secret) → claims agent:<id> task
    loop work
        B->>W: /box/heartbeat (telemetry, accrued cost)
        B->>R2: /box/artifact (evidence upload via Worker)
    end
    B->>B: local proof self-check → corrective pass if failing
    B->>W: /box/complete{status: done}
    W->>W: checkProofContract(artifacts, http probes)
    alt proof passes
        W-->>B: 200 — agent done, box flips offline
    else proof fails
        W-->>B: 422 proof_unverified — task stays claimed
    end
    Note over W,E: reaper (cron */5): TTL expired → Terminate → confirm → destroyed
    O->>W: task_wait / cloud_agent_get → result
```

## 4. Brokered browser op (box ↔ your logged-in session)

See [the session broker](/components/session-broker) for the full sequence. Compressed:

```mermaid
flowchart LR
    B["box: browser-rpc<br/>(handle only)"] -->|"op on broker:ops"| W["Worker:<br/>named-in-launch? live? on-origin? allowed op?"]
    W --> M["Mac executor:<br/>decrypts state, drives Playwright"]
    M -->|"text/screenshot only"| W --> B
```

Four 403s guard the door: `session_not_in_launch`, `session_invalid`, `origin_not_allowed`, `op_not_yours`.

## 5. Session capture → invalidation

```mermaid
stateDiagram-v2
    [*] --> captured: human logs in headfully on the Mac,<br/>storageState → /admin/session/capture
    captured --> leased: box launch names it, session-lease grants handle
    leased --> active: ops flowing (validity re-checked per op)
    active --> leased: box completes, lease released
    captured --> revoked: web_session_invalidate
    active --> revoked: same call — in-flight boxes cut at next op
    revoked --> [*]
```

## 6. Secret injection

```mermaid
flowchart LR
    S["secrets store<br/>(encrypted, FERMI_SECRETS_KEY)"] --> G{gateway}
    C["sandbox / browser op with secret placeholder"] --> G
    G -->|"host ∈ allowed_hosts"| X["outbound request,<br/>plaintext never seen by model"]
    G -->|else| DENY["refused"]
    S -->|"secret_resolve — only if capability allowlisted,<br/>10/min, audited"| MODEL["model context"]
```

## 7. Runner pin (supply chain)

```mermaid
sequenceDiagram
    participant Op as Operator
    participant W as Worker
    participant B as Booting box
    participant GH as raw.githubusercontent.com
    Op->>W: fleetctl pin-runner (ref + sha256 → fleet:config)
    Note over W: launch REFUSES while unpinned
    B->>GH: fetch box-runner.mjs @pinned ref (curl --retry 4)
    B->>B: sha256 verify
    alt match
        B->>B: install, run
    else mismatch
        B->>W: /box/report (fail closed, nothing executed)
    end
```

## 8. Memory → skill crystallization

```mermaid
flowchart LR
    M["memory_write"] -->|manual promote| SK["skill_set<br/>(origin_memory_id)"]
    SESS["session summaries"] -->|"Sun 02:00 distillation"| DRAFT["one draft skill<br/>(human reviews)"]
    SK --> LOAD["skill_load: deterministic SKILL.md,<br/>1.25× search boost, usage counted"]
    DRAFT --> LOAD
```

## Invariants (the whole system)

- Only the Worker is publicly addressable; Macs pull or sit behind an authenticated tunnel; boxes only dial home.
- Cookies decrypt in exactly one process (the Mac executor). Boxes see handles and op results.
- A box's token opens `/box/*` for that box only — never `/admin/*`, never another box's ops.
- `done` is a claim until the proof contract verifies; honest failure is always accepted.
- Nothing boots on a box that doesn't hash to the pinned sha256.
- Fleet queues (`agent:*`, `broker:*`) are invisible to the channel drain.
- Every tool call, approval, and secret resolution leaves an audit row.
