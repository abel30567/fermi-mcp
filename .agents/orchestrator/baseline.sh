#!/usr/bin/env bash
# baseline.sh — run GATES on a clean origin/BASE and record the result in $STATE/baseline.txt.
# Workers compare their own gate runs against this file: a failure that is already here is "baseline",
# anything new is theirs. Re-run after BASE moves a lot, or when a known failure gets fixed.
set -uo pipefail
. "$(dirname "$0")/config.sh"
cd "$REPO" && git fetch -q origin "$BASE" || exit 1
WT="$WTROOT/BASELINE"; LOG="$STATE/logs/baseline.log"
[ -d "$WT" ] && git worktree remove --force "$WT"
git worktree add -q --detach "$WT" "origin/$BASE" || exit 1
SHA=$(git -C "$WT" rev-parse --short HEAD)
echo "running gates on origin/$BASE @ $SHA (log: $LOG) ..."
START=$(date +%s)
( cd "$WT" && bash -c "$GATES" ) >"$LOG" 2>&1; RC=$?
SECS=$(( $(date +%s) - START ))
{
  echo "# baseline: origin/$BASE @ $SHA, $(date -u +%FT%TZ), gates exit=$RC, ${SECS}s"
  echo "# GATES: $GATES"
  if [ $RC -eq 0 ]; then
    echo "# all gates green: ANY failure in a worker's run is a finding."
  else
    echo "# gates FAILED on a clean base. Known failures (edit this list by hand if needed):"
    grep -iE '(^|[^a-z])(fail|failed|error|✗|✖)([^a-z]|$)' "$LOG" | grep -viE '0 (failed|errors?)' | head -60 | sed 's/^/  /'
  fi
} > "$STATE/baseline.txt"
git worktree remove --force "$WT"
cat "$STATE/baseline.txt"
exit 0
