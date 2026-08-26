# Shared Libraries

Core utilities and data stores used across the worker.

## Stores (D1/R2/KV/Vectorize)

- **memory-store.ts** — CRUD for memories with FTS5 indexing
- **skills-store.ts** — R2 read/write for SKILL.md files + Vectorize semantic index
- **usage-store.ts** — Per-tool analytics: call counts, success/denied, timestamps
- **secrets-store.ts** — Encrypted vault: allowed_hosts, allowed_capabilities enforcement
- **session-store.ts** / **session.ts** — Session lifecycle and message history
- **browser-session-store.ts** / **browser-store.ts** — Browser session persistence
- **connectors-store.ts** — External service connector CRUD
- **packages-store.ts** — Installable JS packages for sandbox
- **retrievers-store.ts** — Named D1 query templates
- **oauth-store.ts** — OAuth token/code/client management
- **canvas-store.ts** — Canvas state persistence
- **fs-store.ts** — R2 filesystem with scope checking
- **capability-fts.ts** / **capability.ts** — Capability catalog + FTS indexing

## Utilities

- **tool.ts** — `defineTool()` wrapper: scope, risk level, audit logging, approval gate
- **audit.ts** — D1 audit log: tool name, args hash, duration, success, session_id
- **budget.ts** — KV daily token budget tracking
- **embeddings.ts** — Workers AI embedding generation
- **rrf.ts** — Reciprocal Rank Fusion: merges FTS5 + Vectorize results
- **frontmatter.ts** — SKILL.md YAML frontmatter parser
- **shell-blocklist.ts** — Dangerous command pattern matching
- **crypto.ts** — Encryption helpers for secrets vault
- **mime-types.ts** — File extension to MIME type mapping

## OAuth / Apps

- **oauth-flow.ts** / **oauth-handlers.ts** — OAuth 2.0 authorization server implementation
- **apps-handler.ts** / **apps-login.ts** / **apps-session.ts** — OAuth-gated static app hosting
- **totp.ts** — TOTP 2FA generation and verification
