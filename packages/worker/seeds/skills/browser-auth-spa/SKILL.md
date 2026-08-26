---
name: browser-auth-spa
description: Authenticate single-page apps in Fermi browser sessions by injecting tokens into localStorage AND document.cookie, with secret resolution in evaluate/setCookies
keywords: ["browser", "spa", "auth", "localStorage", "cookie", "cognito", "injection", "turnstile", "bot detection"]
allowed_tools: ["browser_session_launch", "browser_session_action", "browser_navigate", "browser_extract", "secret_resolve"]
---
# SPA browser auth via token injection

Programmatic login without typing credentials, proven on AWS Skill Builder
(issue #19, commits e5eb4463 + 18956a9d).

## Core rule: localStorage AND cookies, simultaneously
SPAs that use Cognito (and similar) check BOTH stores. Setting only
localStorage fails — the app bounces to login on reload. Inject the same token
set into `localStorage` and `document.cookie` in one `evaluate` script, then
reload and wait (~20s) for SPA hydration.

## Procedure
1. `browser_session_launch`, navigate to the app origin (cookies must be set
   on the right origin), accept any consent banner.
2. Run an `evaluate` action whose script contains `{{secret:NAME}}`
   placeholders — Fermi resolves them server-side (and audits the resolution)
   before the script reaches the page. The secret must list `browser_action`
   in its allowed_capabilities and the page host in allowed_hosts.
3. In the script: refresh tokens via the provider's CORS-enabled endpoint
   (e.g. Cognito `InitiateAuth` with `REFRESH_TOKEN_AUTH` works from browser
   JS), then write localStorage keys (LastAuthUser, idToken, accessToken,
   refreshToken, clockDrift) AND matching document.cookie entries.
4. Reload the same URL, wait for hydration, verify with `browser_extract`
   (check you are NOT on the login page before declaring success).
5. `setCookies` actions also resolve `{{secret:...}}` in cookie values when a
   raw cookie header is all you need.

## Known limits — when to escalate
- Google login is blocked by bot detection on headless Chromium. Not viable.
- Cloudflare Turnstile and similar bot checks cannot be solved in the cloud
  browser. Escalate to the Local Agent (fermi issue #16) or ask the owner to
  complete the challenge via `browser_session_request_human`.
- OAuth-callback-only cookies (e.g. aws-token-a-c) usually are NOT required
  for SPA auth — test without them first.
