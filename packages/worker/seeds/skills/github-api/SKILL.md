---
name: github-api
description: Call the GitHub REST API from Fermi (issues, PRs, file commits, binary commits via Git Data API) with correct auth and UTF-8 handling
keywords: ["github", "api", "rest", "git", "commit", "issue", "pull request", "blob", "binary"]
allowed_tools: ["execute", "fetch_url", "secret_resolve", "fs_write", "fs_read"]
---
# GitHub API workflow

## Auth
Always call through `execute` (codemode.fetch_url) or `fetch_url` with:
- Header `Authorization: Bearer {{secret:GITHUB_TOKEN}}` (never inline a raw token; the secret is scoped to api.github.com)
- Header `User-Agent: Fermi-Agent` (GitHub rejects requests without one)
- API base: `https://api.github.com`

## Common recipes
- Create issue: `POST /repos/{owner}/{repo}/issues` `{ title, body, labels }`
- Create PR: `POST /repos/{owner}/{repo}/pulls` `{ title, head, base, body }`
- Read file: `GET /repos/{owner}/{repo}/contents/{path}` (body is base64)
- Write file: `PUT /repos/{owner}/{repo}/contents/{path}` `{ message, content: <base64>, sha?, branch? }`

## CRITICAL: UTF-8 encoding (corruption hazard)
`atob`/`btoa` alone and `Buffer.from(...)` in the Worker sandbox corrupt multi-byte
UTF-8 (em-dashes, arrows, smart quotes) — each read-modify-write round trip adds
mojibake. Always use the symmetric pair:
- READ: `decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))))`
- WRITE: `btoa(unescape(encodeURIComponent(content)))`
Or the byte-exact TextDecoder/TextEncoder loop for binary-safe handling.
Also: `→`-style escapes only resolve inside JS string literals — when
generating JSX/text via templates, insert real unicode characters.

## Large binary commits — blob-rename technique (preferred)
The model cannot reliably transcribe >3K chars of base64. When a large file must
be committed:
1. Have the USER push the file to the repo under any filename.
2. `GET /repos/{o}/{r}/contents/{tmp}` to get the blob SHA.
3. `POST /repos/{o}/{r}/git/trees` with `base_tree` = HEAD tree, adding the blob
   at the desired path (and `sha: null` entries to delete the temp file).
4. `POST /repos/{o}/{r}/git/commits` with that tree + parent HEAD.
5. `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` to the new commit.
Zero file bytes pass through model context — only SHA pointers.

## Fallback: R2 chunk relay (file not yet on GitHub)
Split base64 into ~1000-char chunks, write each via `fs_write` to
`assets/<name>/<i>`, then one `execute` reads all chunks, concatenates, verifies
magic bytes + length, and PUTs to GitHub with the auth header above.

## Verification
After any push that triggers a deploy (e.g. Vercel), poll the deployments API
for state `success` before checking the live site — reading too early shows the
previous build.
