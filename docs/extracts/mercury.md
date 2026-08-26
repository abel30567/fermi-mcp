# Mercury Agent -- Pattern Extract

Source: `context/mercury-agent/` (v1.1.4, TypeScript, MIT)

---

## 1. Tool Wrapper (PermissionsManifest)

The Mercury permission system gates every tool call through a
`PermissionManager` that checks a YAML-persisted `PermissionsManifest`.
The manifest defines three capability domains -- filesystem, shell,
and git -- each with granular scope and tier controls. All checks are
async and return `{ allowed, reason? }` tuples, keeping tool
implementations free of permission logic.

### Key files

| File | Role |
|------|------|
| `context/mercury-agent/src/capabilities/permissions.ts` | `PermissionManager` class, `PermissionsManifest` type, scope resolution, pattern matching, ask-handler integration |

### PermissionsManifest shape

```typescript
interface PermissionsManifest {
  capabilities: {
    filesystem: FsPermissions;   // scopes with read/write booleans
    shell: ShellPermissions;     // blocked/autoApproved/needsApproval lists
    git: GitPermissions;         // autoApproveRead + approveWrite flags
  };
}
```

### Filesystem scopes (`FsPermissions`)

- `enabled`: master toggle
- `scopes`: array of `{ path, read, write }` -- each defines a directory tree the agent may access
- Default scope: `{ path: '.', read: true, write: true }` (cwd only)
- Resolution: `resolve(path)` then prefix-match against scope paths using `path.sep`
- **Temp scopes**: session-only grants stored in memory (not persisted), created when user answers "yes" to an access prompt

### Shell tiers (`ShellPermissions`)

Three ordered tiers evaluated in priority:

1. **`blocked`**: Hard-denied patterns -- checked first, never overridable (e.g., `sudo *`, `rm -rf /`, fork bombs)
2. **`autoApproved`**: Safe read-only commands run without prompting (e.g., `ls *`, `git status *`, `cat *`)
3. **`needsApproval`**: Destructive/external commands that trigger the ask-handler (e.g., `git push *`, `docker *`, `rm -rf *`)

- `cwdOnly: true` (default): Commands referencing paths outside cwd trigger an `checkFsAccess` check
- Unrecognized commands (not matching any tier) also trigger the ask-handler

### Git permissions

- `autoApproveRead: true` -- read operations (status, diff, log) pass without prompting
- `approveWrite: true` -- write operations (push, commit) need approval

### CF mapping

The `PermissionsManifest` maps to a D1 `permissions` table per user/agent, with columns for each capability domain serialized as JSON. The scope resolution logic runs in a Worker handler before dispatching tool calls. For the MCP layer, each tool's `execute` function calls a permission check helper that reads the user's manifest from D1 and returns allow/deny synchronously (no interactive ask-handler in server context).

---

## 2. Approval Flow

The approval flow uses an `askHandler` callback pattern that supports
three user responses: "yes" (one-time allow), "always" (persist to
manifest), and implicit deny (anything else). This gives users
progressive trust escalation without requiring upfront configuration.

### Key files

| File | Role |
|------|------|
| `context/mercury-agent/src/capabilities/permissions.ts` | `onAsk()` registration, `checkShellCommand()` and `requestScopeExternal()` ask-handler callsites |

### Pattern

```
PermissionManager.onAsk(handler: (prompt: string) => Promise<string>)
```

- The handler receives a human-readable prompt (e.g., `"Run command: npm publish"` or `"Mercury needs write access to: /etc/config"`)
- Returns one of:
  - `"yes"` -- allow this specific invocation; for shell, just proceeds; for filesystem, creates a temp scope (session-only)
  - `"always"` -- persist the approval: for shell, adds `<baseCmd> *` to `autoApproved` and saves `permissions.yaml`; for filesystem, adds a permanent scope
  - Anything else -- deny

### Elevation for skills

- `elevateForSkill(allowedTools)`: temporarily grants unrestricted access for `run_command`, `fs_read`, or `fs_write` during skill execution
- `clearElevation()`: revokes temporary elevation after skill completes
- Elevated mode bypasses both pattern matching and ask-handler

### Channel-type gating

- `currentChannelType === 'internal'` skips the ask-handler entirely (internal calls are trusted)
- CLI and Telegram channels go through the full approval flow

### CF mapping

In the Cloudflare MCP context there is no interactive ask-handler (the client is Claude Desktop, not a human). Instead, the approval flow becomes a pre-flight check: the Worker reads the user's persisted manifest from D1, and either allows or denies. "Always" approvals are written back to D1 via a separate `/permissions/grant` endpoint. For Telegram/Discord channels, a Durable Object can hold pending approval state and wait for the user's reply message.

---

## 3. Shell Blocklist

The shell blocklist defines command patterns that are hard-denied
regardless of user approval or skill elevation. Patterns use simple
glob syntax (`*` = any characters, `?` = single character) and are
checked case-insensitively via regex conversion.

### Key files

| File | Role |
|------|------|
| `context/mercury-agent/src/capabilities/shell/blocklist.ts` | Three exported arrays: `BLOCKED_COMMANDS`, `AUTO_APPROVED_COMMANDS`, `NEEDS_APPROVAL_COMMANDS` |
| `context/mercury-agent/src/capabilities/permissions.ts` | `matchPattern()` -- converts glob to regex, falls back to prefix match |

### Blocked commands (27 patterns)

Categories:
- **Privilege escalation**: `sudo *`
- **Destructive filesystem**: `rm -rf /`, `rm -rf ~`, `rm -rf /*`, `mkfs *`, `dd if=*`, `> /dev/sda`, `mv /* /dev/null`
- **Permission abuse**: `chmod 777 /`, `chown * /`
- **System control**: `shutdown *`, `reboot *`, `halt *`, `init 0`, `init 6`, `kill -9 1`
- **Fork bomb**: `:(){ :|:& };:`
- **Windows destructive**: `del /s /q C:\*`, `rmdir /s /q C:\*`, `format *`, `icacls * C:\* /grant`, `net user *`, `netsh *`, `reg delete *`, `cmd /c rd /s /q *`

### Glob matching

```typescript
matchPattern(command: string, pattern: string): boolean {
  // Convert: * -> .*, ? -> .
  // Case-insensitive regex test
  // Fallback: prefix match if regex construction fails
}
```

Patterns are matched against the full trimmed command string. The evaluation order is: blocked (deny) -> autoApproved (allow) -> needsApproval (ask) -> unmatched (ask).

### CF mapping

The blocklist maps to a D1 `shell_policies` table or a static config object baked into the Worker. Pattern matching runs in the Worker before executing any shell-like tool. Since the Fermi MCP server won't execute actual shell commands (tools are Cloudflare-native), the blocklist becomes a validation layer for any "execute" or "run" tool parameters, preventing prompt-injected destructive commands from reaching downstream Workers.

---

## 4. Folder-Scope (checkFsAccess)

The `checkFsAccess` method enforces path-based access control for all
filesystem operations. It resolves paths to absolute form, checks
against persistent and temporary scopes, and falls back to the
ask-handler for unscoped paths.

### Key files

| File | Role |
|------|------|
| `context/mercury-agent/src/capabilities/permissions.ts` | `checkFsAccess()`, `findScope()`, `findTempScope()`, `requestScopeExternal()`, `addScope()`, `addTempScope()` |

### Resolution flow

1. Check skill elevation (`fs_read`/`fs_write` in `elevatedCommands`) -- if elevated, allow immediately
2. Check `filesystem.enabled` -- if disabled, deny
3. `resolve(path)` to absolute path
4. `findScope(resolved)` -- iterate persistent scopes, prefix-match with `path.sep` boundary
5. `findTempScope(resolved)` -- iterate session-only scopes, same prefix-match
6. If no scope matches and ask-handler available: `requestScopeExternal(path, mode)`
7. Otherwise deny with reason string

### Path resolution details

- Scopes use `resolve(scope.path.replace(/^~/, homedir()))` for tilde expansion
- Match condition: `resolvedPath === scopeResolved || resolvedPath.startsWith(scopeResolved + sep)`
- This ensures `/home/user/project` matches scope `/home/user/project` but not `/home/user/project-other`

### cwdOnly enforcement

When `shell.cwdOnly` is true (default), `checkShellCommand` calls `hasPathBeyondCwd()` which regex-scans the command string for:
- Absolute Unix paths (`/...`)
- Home-relative paths (`~/...`)
- Parent traversals (`../...`)
- Windows absolute paths (`C:\...`)
- UNC paths (`\\...`)

If found and the resolved path is not under `process.cwd()`, it delegates to `checkFsAccess(path, 'write')`.

### CF mapping

In the Workers environment, filesystem scopes become R2 prefix scopes. Each user's manifest defines which R2 key prefixes they can read/write. The `checkFsAccess` logic runs as a middleware in the Worker request pipeline, checking the target R2 key against the user's scope list before allowing the operation. Path resolution simplifies to R2 key normalization (no tilde, no symlinks).

---

## 5. Budget (TokenBudget)

The `TokenBudget` class enforces daily token spending limits with
per-request logging, auto-reset at midnight, and override capabilities.
It persists usage data to a JSON file and restores it on startup,
ensuring budget continuity across process restarts.

### Key files

| File | Role |
|------|------|
| `context/mercury-agent/src/utils/tokens.ts` | `TokenBudget` class, `TokenTracker` interface, `TokenLogEntry` interface |
| `context/mercury-agent/src/capabilities/system/budget-status.ts` | `createBudgetStatusTool()` -- exposes budget as an AI tool |

### TokenBudget class

```typescript
class TokenBudget {
  dailyUsed: number;      // Running total for today
  dailyBudget: number;    // Configured limit (from MercuryConfig.tokens.dailyBudget)
  lastResetDate: string;  // ISO date string (YYYY-MM-DD)
  requestLog: TokenLogEntry[];  // Last 200 entries (rolling window)
}
```

### Core methods

| Method | Purpose |
|--------|---------|
| `canAfford(estimated)` | Pre-flight check: `dailyUsed + estimated <= dailyBudget` |
| `isOverBudget()` | Gate check: `dailyUsed >= dailyBudget` (respects `forceNext` override) |
| `recordUsage(entry)` | Log a completed request: accumulates `totalTokens`, appends to `requestLog`, persists |
| `forceAllowNext()` | One-shot override: next `isOverBudget()` returns false regardless |
| `resetUsage()` | Manual reset: zeros `dailyUsed` and clears log |
| `setBudget(n)` | Update budget and persist to both `token-usage.json` and `config.yaml` |
| `getRemaining()` | `max(0, dailyBudget - dailyUsed)` |
| `getUsagePercentage()` | `(dailyUsed / dailyBudget) * 100` |

### TokenLogEntry shape

```typescript
interface TokenLogEntry {
  timestamp: number;     // Date.now()
  provider: string;      // e.g., "anthropic", "openai"
  model: string;         // e.g., "claude-sonnet-4-20250514"
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  channelType: string;   // "cli", "telegram", etc.
}
```

### Persistence

- File: `~/.mercury/token-usage.json`
- Persists after every `recordUsage()`, `resetUsage()`, `setBudget()`, and midnight reset
- On restore: only loads if `lastResetDate === today` (otherwise resets)
- Request log capped at 200 entries (`.slice(-200)` on persist)
- Uses `safeNumber()` for defensive NaN handling throughout

### Budget status tool

`createBudgetStatusTool(tokenBudget)` wraps `getStatusText()` as an AI-callable tool with no parameters. Returns a human-readable string: `"Token budget: 12,345 / 100,000 used (12%), 87,655 remaining"`.

### CF mapping

The `TokenBudget` maps to D1 rows in a `token_usage` table keyed by `(user_id, date)`. Each request logs a row to a `token_log` table (with automatic partition/cleanup by date). The `isOverBudget()` check becomes a D1 query at the start of each MCP request: `SELECT SUM(total_tokens) FROM token_log WHERE user_id = ? AND date = ?`. The `dailyBudget` lives in the user's config row. The budget-status tool becomes an MCP tool that queries the same D1 tables and returns the formatted string.
