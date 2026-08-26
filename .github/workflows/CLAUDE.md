# CI/CD Workflows

- **ci.yml** — Runs on PR: typecheck, lint (Biome), format check
- **deploy.yml** — Deploys to Cloudflare Workers on push to master

## Deployment

Deployment uses `wrangler deploy` with the config at `packages/worker/wrangler.jsonc`.
Secrets are managed via `wrangler secret put`, never committed.
Migrations are applied with `bun run migrate:remote` before deploy.
