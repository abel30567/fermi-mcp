#!/usr/bin/env bash
set -euo pipefail

# Fermi Standalone Bootstrap
# Provisions Cloudflare resources and generates wrangler.jsonc

WORKER_NAME="${1:-fermi}"
CONFIG="packages/worker/wrangler.jsonc"

echo "Bootstrapping Fermi instance: $WORKER_NAME"

command -v wrangler &>/dev/null || { echo "wrangler not found. npm i -g wrangler"; exit 1; }

echo "Fetching account ID..."
CF_ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1)
[ -z "$CF_ACCOUNT_ID" ] && { echo "Run: wrangler login"; exit 1; }
echo "  Account: $CF_ACCOUNT_ID"

echo "Creating D1 database..."
D1_ID=$(wrangler d1 create "$WORKER_NAME" 2>&1 | grep -oE '[a-f0-9-]{36}')
echo "  D1: $D1_ID"

echo "Creating R2 bucket..."
wrangler r2 bucket create "$WORKER_NAME-storage" 2>/dev/null || true

echo "Creating KV namespaces..."
KV_FERMI=$(wrangler kv namespace create "FERMI_KV" 2>&1 | grep -oE '[a-f0-9]{32}')
KV_OAUTH=$(wrangler kv namespace create "OAUTH_KV" 2>&1 | grep -oE '[a-f0-9]{32}')
echo "  FERMI_KV: $KV_FERMI"
echo "  OAUTH_KV: $KV_OAUTH"

echo "Creating Vectorize index..."
wrangler vectorize create "$WORKER_NAME-capabilities" --dimensions 768 --metric cosine 2>/dev/null || true

echo "Generating $CONFIG..."
sed \
  -e "s|__WORKER_NAME__|$WORKER_NAME|g" \
  -e "s|__CF_ACCOUNT_ID__|$CF_ACCOUNT_ID|g" \
  -e "s|__D1_DATABASE_NAME__|$WORKER_NAME|g" \
  -e "s|__D1_DATABASE_ID__|$D1_ID|g" \
  -e "s|__R2_BUCKET_NAME__|$WORKER_NAME-storage|g" \
  -e "s|__KV_FERMI_ID__|$KV_FERMI|g" \
  -e "s|__KV_OAUTH_ID__|$KV_OAUTH|g" \
  -e "s|__VECTORIZE_INDEX_NAME__|$WORKER_NAME-capabilities|g" \
  packages/worker/wrangler.template.jsonc > "$CONFIG"

echo ""
echo "Done! Next steps:"
echo "  1. wrangler secret put FERMI_OWNER_SECRET --name $WORKER_NAME"
echo "  2. bun run migrate:remote"
echo "  3. cd packages/worker && wrangler deploy"
