# System map

Every piece of compute and every storage service in a full (Tier 5) deployment, and which direction data moves between them. Solid arrows are runtime data paths; dashed are boot/provision-time.

```mermaid
flowchart TB
    subgraph HOSTS["MCP hosts (their compute, their inference bill)"]
      CLAI["Claude.ai / Desktop"]
      CCODE["Claude Code / Cursor"]
    end

    subgraph CHAT["Chat platforms"]
      TG["Telegram"]
      SLK["Slack / Discord"]
      WA["WhatsApp"]
    end

    subgraph CF["Cloudflare — the control plane"]
      direction TB
      W["Worker (index.ts router)"]
      DO["FermiMCP DO<br/>guardrails · tools"]
      FDO["FleetDO"]
      CRON["cron: reaper 5min,<br/>consolidation, brief, distill, reindex"]
      D1[("D1<br/>memory · tasks · fleet ·<br/>sessions(enc) · audit")]
      R2[("R2<br/>skills · files · apps · artifacts")]
      KV[("KV<br/>fleet:config · approvals")]
      VEC[("Vectorize")]
      WAI["Workers AI<br/>embeddings · summaries"]
      CBR["Browser Rendering<br/>(cloud browser lane)"]
    end

    subgraph MAC["Your Mac(s)"]
      POLL["poll.sh + warm-worker<br/>(task drain, harness)"]
      BRIDGE["wa/dc bridges"]
      BEXEC["broker-executor<br/>(holds decrypted cookies)"]
      MMCP["MacOSMCP<br/>25 mac_* tools"]
      TUN["cloudflared tunnel"]
    end

    subgraph AWS["AWS (region-pinned)"]
      EC2["EC2 API"]
      BOX1["neutrino box(es)<br/>box-runner + harness"]
    end

    subgraph EXT["External"]
      ANTH["Anthropic API / Claude sub"]
      GH["GitHub"]
      WEB["The web"]
    end

    CLAI -->|/mcp| W
    CCODE -->|/mcp| W
    TG -->|webhook| W
    SLK -->|webhook| W
    WA <--> BRIDGE
    BRIDGE -->|/wa webhook| W

    W <--> DO
    DO <--> D1
    DO <--> R2
    DO <--> KV
    DO <--> VEC
    DO --> WAI
    DO --> CBR
    CRON --> D1
    CRON --> EC2
    W <--> FDO

    POLL -->|"claim/complete (pull only)"| W
    BEXEC -->|"/admin/broker/* (pull only)"| W
    BEXEC -->|Playwright, residential IP| WEB
    W -->|"mac_* via tunnel"| TUN --> MMCP
    MMCP --> WEB

    W -.->|"RunInstances (aws4fetch)"| EC2
    EC2 -.-> BOX1
    BOX1 -.->|"fetch box-runner @ pinned SHA,<br/>verify sha256"| GH
    BOX1 -->|"/box/* per-box token"| W
    BOX1 -->|OAuth token from /box/inference-auth| ANTH
    BOX1 -->|push as fermi-neutrino| GH
    DO -->|channel inference| ANTH
```

## Who pays for inference, by lane

| Lane | Model runs on | Billed to |
|------|---------------|-----------|
| MCP hosts | the host (Claude.ai, Claude Code…) | your existing subscription |
| Channels (Telegram/Discord/WhatsApp/Slack) | Claude Code on your Mac (daemon drain) | your subscription |
| Daemon tasks | Claude Code on your Mac | your subscription |
| Neutrinos | harness on the box, OAuth token | your subscription (tracked as telemetry `inference_usd`, **not** counted against the fleet budget — the budget is EC2 wall-clock only) |

## Public addresses

Exactly one component listens on the internet: the Worker. The Mac is reachable only through its outbound tunnel (Tier 3+) or not at all (Tier 2). Boxes have public IPs for egress but expose no service; every box interaction is the box calling the Worker.

## Reading order

1. This page, then [Data flows, state by state](/architecture/data-flows) for each lifecycle in sequence-diagram form.
2. [Trust boundaries](/architecture/trust-boundaries) for where credentials live and stop.
3. Component pages for the runtime model of each box above.
