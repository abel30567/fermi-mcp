# D1 Migrations

SQL migrations applied sequentially to the D1 database. Each file is idempotent.

| Migration | Purpose |
|-----------|--------|
| 0001_init.sql | Core tables: memories, sessions, messages, audit_log |
| 0002_seed.sql | FTS5 virtual tables for full-text search |
| 0003_fts_triggers.sql | Auto-sync triggers between base tables and FTS indexes |
| 0004_secrets.sql | Encrypted secrets vault with allowed_hosts/capabilities |
| 0005_packages.sql | User-installable JS packages for sandbox |
| 0006_connectors.sql | External service connector definitions |
| 0007_retrievers.sql | Named D1 query templates |
| 0008_oauth_provider.sql | OAuth 2.0 provider: clients, tokens, codes |
| 0009_browser_sessions.sql | Persistent browser session metadata |
| 0010_skills_layer.sql | Skills catalog: slug, description, metadata |
| 0011_usage_analytics.sql | Per-tool usage tracking: calls, success/denied counts |

## Adding a migration

Create `NNNN_description.sql`. Apply locally with `bun run migrate:local`, then remotely with `bun run migrate:remote`.
