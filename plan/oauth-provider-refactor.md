# Issue #7 — Refactor Fermi MCP OAuth onto `@cloudflare/workers-oauth-provider`

## Context

PR #5 shipped a hand-rolled OAuth 2.1 + TOTP server for the Fermi MCP endpoint (custom routes in `index.ts`, D1-backed token storage in migration `0008_oauth_provider`). Claude Code can't authenticate against it — the MCP SDK's client-side Zod schema (`OAuthClientInformationFullSchema`) rejects the registration response shape, and PR #6 / commit `d26cf01` only patched a `redirect_uris` array crash, not the underlying protocol mismatch. Issue #7 calls for replacing the custom server with `@cloudflare/workers-oauth-provider` (already at v0.4.0 in `packages/worker/package.json`), following the kentcdodds/kody reference. The library handles registration, token issuance, PKCE, refresh, revocation, and `/.well-known/oauth-authorization-server` automatically; we only own the `/oauth/authorize` UI (passphrase + TOTP) and the MCP handler.

User-approved decisions (2026-05-03):
- New KV namespace bound as `OAUTH_KV` (FERMI_KV stays for non-OAuth state).
- `FERMI_AUTH_ENABLED` flag is preserved as a runtime kill switch.
- Delete `lib/oauth-provider.ts` and custom routes; **keep** migration `0008` for revert safety.

## Architecture

```
incoming request
   │
   ▼
default export fetch(req, env, ctx)
   │
   ├── FERMI_AUTH_ENABLED !== 'true'  → defaultHandler (open, current behaviour)
   │
   └── FERMI_AUTH_ENABLED === 'true'  → oauthProvider.fetch(req, env, ctx)
                                            │
                                            ├── /oauth/token, /oauth/register, /oauth/revoke,
                                            │   /.well-known/oauth-authorization-server   → library
                                            │
                                            ├── /mcp, /sse  (apiHandlers)
                                            │     ├── valid Bearer → FermiMCP.serve(...)
                                            │     └── missing/bad Bearer → 401 + WWW-Authenticate
                                            │
                                            └── everything else (incl. /oauth/authorize, /oauth/start,
                                                 /oauth/callback, /capabilities, /cron,
                                                 /.well-known/oauth-protected-resource) → defaultHandler
```

`env.OAUTH_PROVIDER` (`OAuthHelpers`) is auto-injected by the library — used inside `/oauth/authorize` to call `parseAuthRequest()` and `completeAuthorization()`.

## Files to change

### NEW — `packages/worker/src/lib/mcp-auth.ts`
Single export `handleProtectedResourceMetadata(request, env)` returning the `/.well-known/oauth-protected-resource` JSON (kody-style):
```json
{ "resource": "<origin>/mcp", "authorization_servers": ["<origin>"], "scopes_supported": ["mcp"] }
```
No token validation here — the library does that for `apiHandlers` matches.

### NEW — `packages/worker/src/lib/oauth-handlers.ts`
- `handleAuthorizeGet(request, env)` — calls `env.OAUTH_PROVIDER.parseAuthRequest(request)`, renders the existing HTML form (passphrase + TOTP), preserves the `oauthReqInfo` as a hidden field (JSON-stringified) per kody pattern.
- `handleAuthorizePost(request, env)` — re-parses `oauthReqInfo`, runs the existing IP rate limiter (FERMI_KV), validates `FERMI_OWNER_SECRET`, validates TOTP via `validateTotp()` from `lib/totp.ts`, then:
  ```ts
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: 'owner',
    metadata: { clientId: oauthReqInfo.clientId },
    scope: oauthReqInfo.scope,
    props: { owner: true },
  });
  return Response.redirect(redirectTo, 302);
  ```
- Lift the existing form HTML and rate-limit logic out of `index.ts` verbatim.

### MAJOR REWRITE — `packages/worker/src/index.ts`
1. Import `OAuthProvider` from `@cloudflare/workers-oauth-provider`.
2. Build a `defaultHandler` object whose `fetch` is the **current** non-OAuth router minus `validateMcpAuth` and minus the custom `/oauth/token`, `/oauth/register`, `/oauth/revoke`, `/.well-known/oauth-authorization-server` branches (the library owns those). It still routes `/oauth/authorize` (GET+POST) → `oauth-handlers.ts`, `/oauth/start` and `/oauth/callback` (outbound OAuth, unrelated) as today, `/.well-known/oauth-protected-resource` → `mcp-auth.ts`, plus `/capabilities`, `/cron`, etc.
3. Build the OAuth provider:
   ```ts
   const apiHandler = FermiMCP.serve('/mcp', { binding: 'MCP_OBJECT' });
   const sseHandler = FermiMCP.serve('/sse', { binding: 'MCP_OBJECT' });
   const oauthProvider = new OAuthProvider({
     apiHandlers: { '/mcp': apiHandler, '/sse': sseHandler },
     defaultHandler,
     authorizeEndpoint: '/oauth/authorize',
     tokenEndpoint: '/oauth/token',
     clientRegistrationEndpoint: '/oauth/register',
     scopesSupported: ['mcp'],
     allowPlainPKCE: false,
   });
   ```
4. Top-level default export gates on the flag:
   ```ts
   export default {
     fetch(req: Request, env: Env, ctx: ExecutionContext) {
       if (env.FERMI_AUTH_ENABLED !== 'true') return defaultHandler.fetch(req, env, ctx);
       return oauthProvider.fetch(req, env, ctx);
     },
   };
   ```
5. **Delete** `validateMcpAuth`, `validateAccessToken` calls, and all references to `lib/oauth-provider.ts`.

### DELETE — `packages/worker/src/lib/oauth-provider.ts`
All exports (`registerClient`, `getClient`, `createAuthCode`, `exchangeCode`, `validateAccessToken`, `refreshAccessToken`, `revokeToken`, `getServerMetadata`) are superseded by the library. **Do not touch** `oauth-flow.ts` / `oauth-store.ts` / `mcp/tools/oauth.ts` — those are the *outbound* OAuth client subsystem (Fermi calling GitHub/Google), unrelated to this issue.

### `packages/worker/wrangler.jsonc`
Add a new KV namespace binding:
```jsonc
{ "binding": "OAUTH_KV", "id": "<new-id-from-wrangler-kv-namespace-create>" }
```
Keep existing `FERMI_KV` binding untouched.

### `packages/worker/worker-configuration.d.ts`
Add `OAUTH_KV: KVNamespace` and `OAUTH_PROVIDER: OAuthHelpers` (import type from `@cloudflare/workers-oauth-provider`) to the `Env` interface. Re-run `wrangler types` after the wrangler.jsonc change.

### `packages/worker/src/mcp/index.ts` (FermiMCP)
Define `Props = { owner: true }` (or extend existing Props type) so `ctx.props` is typed when the apiHandler runs.

### KEEP AS-IS
- `lib/totp.ts` — reused by new `oauth-handlers.ts`.
- `lib/oauth-flow.ts`, `lib/oauth-store.ts`, `mcp/tools/oauth.ts`, `mcp/tools/totp.ts` — outbound OAuth, separate concern.
- `migrations/0008_oauth_provider.sql` — left in place for revert; tables go unused.

## Functions/utilities being reused (no rewrite)
- `validateTotp()` at `packages/worker/src/lib/totp.ts` — TOTP verification.
- IP rate-limit logic currently in `index.ts` `/oauth/authorize` POST handler — move verbatim into `oauth-handlers.ts`.
- `FermiMCP.serve()` at `packages/worker/src/mcp/index.ts` — used as `apiHandler`.
- Existing `/oauth/start` + `/oauth/callback` handlers (outbound OAuth via `oauth-flow.ts`) — unmoved.

## Verification

1. **Local typecheck**: `cd packages/worker && bun run typecheck`.
2. **Lint**: `bun run biome check .` — must be clean (CI runs auto-fix per recent commits).
3. **Bind a dev KV**: `CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) wrangler kv namespace create OAUTH_KV` and update `wrangler.jsonc` with the returned id (and a `--preview` namespace if needed for `wrangler dev`).
4. **Local dev run**: `wrangler dev` with `FERMI_AUTH_ENABLED=false` first, hit `/mcp` with no Bearer — should still respond (flag bypass works).
5. **Auth-on test**: set `FERMI_AUTH_ENABLED=true`, then:
   - `curl https://<dev>/.well-known/oauth-authorization-server` → expect library-generated metadata with `/oauth/token`, `/oauth/register`, scopes `["mcp"]`.
   - `curl -X POST https://<dev>/oauth/register -d '{"client_name":"test","redirect_uris":["http://localhost/cb"]}'` → expect 201 with `client_id`, `client_secret`, `redirect_uris` array.
   - Browser flow: visit `/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&scope=mcp`, submit owner secret + TOTP, verify redirect to `redirect_uri?code=…`.
   - Token exchange: `curl -X POST /oauth/token -d 'grant_type=authorization_code&code=…&code_verifier=…&client_id=…'` → access_token + refresh_token.
   - `curl -H 'Authorization: Bearer <access>' https://<dev>/mcp` → MCP responds; without Bearer → 401.
6. **End-to-end with Claude Code**: configure Claude Code to use the deployed Fermi `/mcp` URL; the SDK Zod failure from issue #7 must no longer reproduce.
7. **Rollback drill**: flip `FERMI_AUTH_ENABLED=false` via `wrangler secret put` — `/mcp` immediately becomes open. Confirms the kill switch.

## Out of scope
- Removing migration `0008` or the unused D1 tables (deferred; ticket-worthy follow-up after a soak window).
- Changes to outbound OAuth (`oauth-flow.ts` / `oauth-store.ts` / `mcp/tools/oauth.ts`).
- Multi-user support — Fermi is single-owner; `props` stays `{ owner: true }`.
