---
name: shopify-admin
description: Shopify Admin API access for Primal TCG - client_credentials token mint (24h expiry) and X-Shopify-Access-Token request pattern
keywords: ["shopify", "admin", "api", "orders", "products", "inventory", "primal", "ecommerce"]
allowed_tools: ["execute", "fetch_url", "secret_resolve", "fs_read", "fs_write"]
---
# Shopify Admin API (Primal TCG)

Shop: `your-shop.myshopify.com` (storefront shop.example.com), Basic plan, USD.

## Auth — mint a fresh token each session (24h expiry)
1. Resolve `{{secret:SHOPIFY_CLIENT_ID}}` and `{{secret:SHOPIFY_CLIENT_SECRET}}`
   (both scoped to the shop hosts).
2. `POST https://your-shop.myshopify.com/admin/oauth/access_token` with JSON
   body `{ client_id, client_secret, grant_type: "client_credentials" }`.
3. Send the token on every call as header `X-Shopify-Access-Token: {token}`.
   A cached copy may exist at R2 `secrets/shopify_token.json`, but assume it is
   expired and re-mint.

## API
Base: `https://your-shop.myshopify.com/admin/api/2024-01/`
Scopes: read/write orders, products, inventory, customers, draft_orders, files, analytics.
- Shop info: `GET /shop.json`
- Orders: `GET /orders.json`
- Products: `GET /products.json`
- Customers: `GET /customers.json`
- Inventory: `GET /inventory_levels.json`

## Constraints
- Label/fulfillment automation in the Shopify admin UI hits Cloudflare
  Turnstile in the cloud browser — do it via the Admin API where possible, or
  escalate to the Local Agent / human handoff (see browser-auth-spa skill).
- Marketplace (marketplace.example.com) is a separate React SPA with Cognito
  auth — different credentials (SHOP_EMAIL/SHOP_PASSWORD), not this API.
