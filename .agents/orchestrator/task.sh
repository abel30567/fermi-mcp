#!/usr/bin/env bash
# task.sh — create a tracked GitHub issue for a task, so it shows on the board and can be launched.
#   task.sh "summary" [body.md]          no external tracker: creates the issue, then titles it [ISSUE-<n>] summary
#   task.sh <KEY> "summary" [body.md]    you already have a ticket key (e.g. PROJ-12): titles it [PROJ-12] summary
# Without body.md the issue gets issue-template.md (Context / Scope / Acceptance criteria / Verification).
set -euo pipefail
. "$(dirname "$0")/config.sh"
KEYRX="^${KEY_RE}\$"
if [ $# -ge 2 ] && [[ "$1" =~ $KEYRX ]]; then KEY=$1; shift; else KEY=""; fi
SUMMARY=${1:?usage: task.sh [KEY] "summary" [body.md]}; BODY=${2:-$ORCH_DIR/issue-template.md}
gh label create tracked -R "$GH_REPO" --color 0052CC --description "On the orchestrator board" >/dev/null 2>&1 || true
TITLE="[${KEY:-ISSUE-0}] $SUMMARY"
URL=$(gh issue create -R "$GH_REPO" --title "$TITLE" --label tracked --body-file "$BODY")
N=${URL##*/}
if [ -z "$KEY" ]; then
  KEY="ISSUE-$N"; gh issue edit "$N" -R "$GH_REPO" --title "[$KEY] $SUMMARY" >/dev/null
fi
echo "$KEY  #$N  $URL"
echo "next: fill in the acceptance criteria, add label status:ready, then: orch launch builder $KEY <slug> \"\$(cat TASK.md)\""
