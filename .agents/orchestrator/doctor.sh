#!/usr/bin/env bash
# doctor.sh — check everything the orchestrator needs, and say how to fix what is missing.
. "$(dirname "$0")/config.sh" || exit 1
ok=0; warn=0; bad=0
pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; ok=$((ok+1)); }
note() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; warn=$((warn+1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; bad=$((bad+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo "tools"
for t in git python3 node lsof; do have $t && pass "$t $(command -v $t)" || fail "$t not found on PATH"; done
have gh && pass "gh $(gh --version | head -1 | awk '{print $3}')" || fail "gh not found: install from https://cli.github.com, then: gh auth login"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null && pass "python3 >= 3.9" || fail "python3 is older than 3.9"
W=${WORKER_CMD%% *}; have "$W" && pass "worker command '$W' ($WORKER_KIND)" || fail "worker command '$W' not found (set WORKER_CMD in local.env)"

echo "github"
LOGIN=$(gh api user --jq .login 2>/dev/null || true)
[ -n "$LOGIN" ] && pass "gh is logged in as $LOGIN" || fail "gh is not logged in: run gh auth login"
[[ "$GH_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && pass "repository $GH_REPO" \
  || fail "GH_REPO '$GH_REPO' is not owner/name: set GH_REPO in orch.env or point origin at GitHub"
if gh repo view "$GH_REPO" --json name >/dev/null 2>&1; then pass "can read $GH_REPO"; else fail "cannot read $GH_REPO with this gh login"; fi
git -C "$REPO" ls-remote --exit-code --heads origin "$BASE" >/dev/null 2>&1 && pass "base branch origin/$BASE exists" || fail "origin/$BASE not found (set BASE in orch.env)"
P=$(gh api "repos/$GH_REPO/branches/$BASE/protection" 2>&1)
if grep -q '"required_pull_request_reviews"\|"required_status_checks"' <<<"$P"; then pass "$BASE is branch-protected"
else note "$BASE has no branch protection (or you cannot see it). Recommended: docs/4-customizing.md#branch-protection"; fi
LABELS=$(gh label list -R "$GH_REPO" --limit 500 --json name --jq '.[].name' 2>/dev/null)
missing=$(for l in tracked follow-up status:ready status:blocked merge:hold env:staging; do grep -qx "$l" <<<"$LABELS" || echo -n "$l "; done)
[ -z "$missing" ] && pass "board labels exist" || note "missing labels: $missing(run: orch labels)"
gh gist list --limit 1 >/dev/null 2>&1 && pass "token can use gists (board)" || note "token cannot list gists; orch board --apply will fail"

echo "config"
[ -f "$ORCH_DIR/orch.env" ] && pass "orch.env present" || fail "orch.env missing: cp orch.env.example orch.env"
[ -f "$ORCH_DIR/local.env" ] && pass "local.env present" || note "local.env missing (defaults used): cp local.env.example local.env"
grep -qx '.*local.env' "$REPO/.gitignore" 2>/dev/null && pass "local.env is gitignored" || note "add local.env to .gitignore"
grep -q "GATES is not set" <<<"$GATES" && fail "GATES not set in orch.env" || pass "GATES: $GATES"
[ -f "$STATE/baseline.txt" ] && pass "baseline: $(head -1 "$STATE/baseline.txt" | cut -c3-)" || note "no baseline yet: run orch baseline"
[ -f "$REPO/CLAUDE.md" ] || [ -f "$REPO/AGENTS.md" ] && pass "repo has CLAUDE.md / AGENTS.md" || note "no CLAUDE.md / AGENTS.md: paste templates/AGENT-RULES.md into one"
[ "$WORKER_KIND" = claude ] && pass "worker guard hook will load (Claude Code)" || note "WORKER_KIND=custom: the guard hook does not run; branch protection is your backstop"

echo "host"
free=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1048576)}')
[ "$free" -ge "$DISK_CLEAN_GB" ] && pass "disk free ${free} GB" || note "disk free ${free} GB (launches refused below $DISK_MIN_GB)"
[ -f "$STATE/FREEZE" ] && note "FREEZE is on (orch unfreeze)" || pass "not frozen"
echo "state $STATE   worktrees $WTROOT"
echo "result: $ok ok, $warn warnings, $bad failures"
[ $bad -eq 0 ]
