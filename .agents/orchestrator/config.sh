# Sourced by every orchestrator script (Python scripts read it through conf.py).
#   orch.env   project settings, committed (repo, base branch, gates, ticket key format)
#   local.env  personal settings, gitignored (worker command, models, account details)
# Defaults below; orch.env overrides them, local.env overrides both.
ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$ORCH_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||')"
[ -n "$REPO" ] || { echo "config.sh: $ORCH_DIR is not inside a git repository" >&2; return 1 2>/dev/null || exit 1; }
REPO_NAME="$(basename "$REPO")"

# --- project defaults (override in orch.env) ---
GH_REPO=""                                  # owner/name; empty = derived from the origin remote
BASE="main"                                 # integration branch every PR targets
BRANCH_PREFIX="feat"                        # builder branches: <prefix>/<KEY>-<slug>
KEY_RE='[A-Z][A-Z0-9]*-[0-9]+'              # ticket key format (ERE). PR titles start with [KEY]
GATES="echo 'GATES is not set in orch.env' >&2; exit 1"
PROTECTED_BRANCHES="main|master|develop|development|staging|production"
RESERVED_PORTS=""                           # e.g. "3000|5432": ports only the orchestrator may use
PORT_BASE=8161                              # each worker gets its own port from here upward
MAX_CODE_FILES=15                           # PRs touching more code files than this are risky
CODE_EXT="ts|tsx|js|jsx|mjs|cjs|mts|py|go|rb|java|kt|cs|rs|php|swift|css|scss|vue|svelte"
MERGE_METHOD="merge"                        # merge | squash | rebase (merge keeps stacked PRs sane)
DISK_MIN_GB=6                               # refuse launches below this much free disk
DISK_CLEAN_GB=10                            # run cleanup-idle.sh below this much free disk
BOARD_TITLE="Dev board"
JIRA_URL=""                                 # optional, e.g. https://yourcompany.atlassian.net
JIRA_PROJECT=""
JIRA_STATUSES="To Do|Ready for Dev|In Progress|Blocked"
JIRA_POINTS_FIELD=""                        # e.g. customfield_10016

# --- personal defaults (override in local.env) ---
WORKER_KIND="claude"                        # claude | custom (see adapters/)
WORKER_CMD="claude -p --permission-mode bypassPermissions"
BUILDER_MODEL="opus"
VERIFIER_MODEL="sonnet"
WORKER_CONFIG_DIR=""                        # isolated CLAUDE_CONFIG_DIR for workers
COAUTHOR="Co-Authored-By: Claude <noreply@anthropic.com>"
HEALTH_URL=""                               # optional URL heartbeat pings (e.g. a local model proxy)

[ -f "$ORCH_DIR/orch.env" ] && . "$ORCH_DIR/orch.env"
[ -f "$ORCH_DIR/local.env" ] && . "$ORCH_DIR/local.env"

if [ -z "$GH_REPO" ]; then
  GH_REPO="$(git -C "$REPO" remote get-url origin 2>/dev/null \
    | sed -E 's#^(git@[^:]+:|ssh://git@[^/]+/|https?://[^/]+/)##; s#\.git$##')"
fi
WTROOT="${WTROOT:-$(dirname "$REPO")/$REPO_NAME-wt}"   # worktrees live NEXT to the repo, not in it
STATE="${STATE:-$HOME/.agent-orch/$REPO_NAME}"          # logs, run JSON, pids, FREEZE; never committed
R="$GH_REPO"

mkdir -p "$STATE"/{logs,runs,state,inputs} "$WTROOT"

guards() {
  [ -f "$STATE/FREEZE" ] && { echo "REFUSED: FREEZE in effect ($STATE/FREEZE); run: orch unfreeze"; exit 4; }
  local free; free=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1048576)}')
  [ "$free" -lt "$DISK_CLEAN_GB" ] && "$ORCH_DIR/cleanup-idle.sh" >/dev/null 2>&1
  free=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1048576)}')
  [ "$free" -lt "$DISK_MIN_GB" ] && { echo "REFUSED: only ${free} GB free (need $DISK_MIN_GB)"; exit 3; }
  return 0
}

# Next free worker port (one per live worktree).
next_port() {
  local p=$PORT_BASE
  while lsof -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 || grep -qx "$p" "$STATE"/state/*.port 2>/dev/null; do p=$((p+1)); done
  echo $p
}
