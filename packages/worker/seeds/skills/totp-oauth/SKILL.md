---
name: totp-oauth
description: Fermi's own OAuth 2.0 + TOTP owner authentication - how clients connect, how the 2FA login works, and how to roll it back
keywords: ["totp", "oauth", "2fa", "auth", "login", "owner", "authenticator", "apps"]
allowed_tools: ["totp_setup", "oauth_list_clients", "oauth_register_client", "oauth_authorize_url", "secret_resolve"]
---
# Fermi OAuth 2.0 + TOTP owner auth

Built in PR #5 (issue #4); provider refactored onto
`@cloudflare/workers-oauth-provider` (issue #7). Protects the MCP endpoints and
private R2-hosted apps.

## Flow
1. MCP client hits `/mcp` or `/sse`; with auth enabled it is redirected into the
   OAuth flow at `/oauth/authorize` (PKCE required, plain PKCE disallowed).
2. The authorize page asks for the owner secret + a 6-digit TOTP code
   (Google Authenticator, seeded from `{{secret:FERMI_TOTP_SECRET}}`).
3. On success the provider issues tokens via `/oauth/token`; client registration
   is at `/oauth/register` (scope: `mcp`).
4. Private apps under `/apps/*` use the same owner+TOTP login at `/apps/_login`;
   the session cookie lasts 24h. `/apps/public/*` skips auth entirely.

## Rollback flag
`FERMI_AUTH_ENABLED` (worker var). `'true'` routes everything through the
OAuthProvider; any other value serves the default handler with no auth. If auth
breaks (e.g. client Zod validation of redirect_uris), set it to `'false'`,
redeploy, and debug offline.

## Gotchas
- TOTP codes are all-numeric — a historical regex bug rejected valid codes
  (fixed in #9); validate with a numeric-aware pattern.
- The owner secret and TOTP seed live in the secrets store; never hardcode them.
- Token lifetimes follow the provider defaults; the apps session cookie (24h) is
  independent of MCP tokens.
