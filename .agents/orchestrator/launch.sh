#!/usr/bin/env bash
# launch.sh ROLE ...  — prepare a worktree, render the role prompt, start ONE detached headless worker.
#   launch.sh builder  <KEY> <slug> "TASK"    new branch <prefix>/<KEY>-<slug> off origin/<BASE>
#   launch.sh verifier <PR> "EXTRA"           detached worktree V<PR>
#   launch.sh fixer    <PR> "EXTRA"           the PR's branch, worktree <KEY>
#   launch.sh br       <PR> "FOCUS"           blast-radius review, worktree BR<PR>
# Prints the worker PID. Result: $STATE/runs/<role>-<id>.json, log: $STATE/logs/<role>-<id>.log
set -euo pipefail
. "$(dirname "$0")/config.sh"
guards
ROLE=${1:?usage: launch.sh builder|verifier|fixer|br ...}; shift
cd "$REPO"; git fetch -q origin "$BASE"
KEYRX="^${KEY_RE}\$"; TITLERX="^\[${KEY_RE}\]"

pr_field() { gh pr view "$1" -R "$GH_REPO" --json "$2" --jq ".$2"; }
case "$ROLE" in
  builder)
    KEY=${1:?KEY}; SLUG=${2:?slug}; TASK=${3:?task}; PR=""
    [[ "$KEY" =~ $KEYRX ]] || { echo "REFUSED: key '$KEY' does not match KEY_RE '$KEY_RE'"; exit 2; }
    [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "REFUSED: slug '$SLUG' must be lowercase-kebab"; exit 2; }
    BRANCH="$BRANCH_PREFIX/$KEY-$SLUG"; ID=$KEY; WT="$WTROOT/$KEY"; MODEL=$BUILDER_MODEL
    if [ -d "$WT" ]; then  # relaunch: reuse the worktree only if it is already on this ticket's branch
      [ "$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$BRANCH" ] || { echo "REFUSED: $WT exists on another branch"; exit 2; }
    else
      git worktree add -q -b "$BRANCH" "$WT" "origin/$BASE" 2>/dev/null || git worktree add -q "$WT" "$BRANCH"
    fi
    # the tracking issue: ISSUE-<n> keys are the issue number; otherwise an open issue titled [KEY] ...
    if [[ "$KEY" =~ ^ISSUE-([0-9]+)$ ]]; then ISSUE=${BASH_REMATCH[1]}
    else ISSUE=$(gh issue list -R "$GH_REPO" --state open --limit 500 --json number,title \
                   --jq "map(select(.title | startswith(\"[$KEY]\")))[0].number // empty" 2>/dev/null || true); fi
    ;;
  verifier|br|fixer)
    PR=${1:?PR number}; TASK=${2:-none}; ISSUE=""
    TITLE=$(pr_field "$PR" title); KEY=$(grep -oE "$TITLERX" <<<"$TITLE" | tr -d '[]' || true)
    [ -n "$KEY" ] || { echo "REFUSED: PR #$PR title '$TITLE' does not start with [KEY]"; exit 2; }
    BRANCH=$(pr_field "$PR" headRefName)
    if [ "$ROLE" = fixer ]; then
      ID=$KEY; WT="$WTROOT/$KEY"; MODEL=$BUILDER_MODEL
      git fetch -q origin "$BRANCH"
      # free the branch if an idle worktree still has it checked out
      HOLD=$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '/^worktree /{w=$2} $0=="branch "b{print w}')
      LOCAL=$BRANCH
      if [ -n "$HOLD" ] && [ "$HOLD" != "$WT" ]; then
        if [ -z "$(lsof -t +D "$HOLD" 2>/dev/null | head -1)" ]; then
          git worktree remove --force "$HOLD"
        else
          # a live process holds the branch: never kill it; work on a local alias that tracks the PR branch
          LOCAL="orch/$BRANCH"; echo "note: $BRANCH held by live $HOLD; fixer uses local alias $LOCAL"
        fi
      fi
      [ -d "$WT" ] || git worktree add -q -B "$LOCAL" "$WT" "origin/$BRANCH"
      git -C "$WT" checkout -q -B "$LOCAL" "origin/$BRANCH"
      git -C "$WT" branch -q --set-upstream-to="origin/$BRANCH" "$LOCAL"
      PUSH_NOTE="Your local branch is $LOCAL; push with: git push origin HEAD:$BRANCH"
    else
      P=$([ "$ROLE" = br ] && echo BR || echo V); ID="$P$PR"; WT="$WTROOT/$ID"; MODEL=$VERIFIER_MODEL
      [ -d "$WT" ] && git worktree remove --force "$WT"
      git worktree add -q --detach "$WT" "origin/$BASE"
    fi
    ;;
  *) echo "usage: launch.sh builder|verifier|fixer|br ..."; exit 2;;
esac

[ -f "$STATE/state/$ID.pid" ] && kill -0 "$(cat "$STATE/state/$ID.pid")" 2>/dev/null && { echo "REFUSED: $ID already has a live worker"; exit 2; }
PUSH_NOTE=${PUSH_NOTE:-}
PORT=$(next_port); echo "$PORT" > "$STATE/state/$ID.port"
RISK=""; [ "$ROLE" = br ] && RISK=$(python3 -I "$ORCH_DIR/risk.py" "$PR" --reasons)
PROTECTED="$BASE|$PROTECTED_BRANCHES"
RULES=$(sed '/^<!--/,/-->$/d' "$ORCH_DIR/project-rules.md" 2>/dev/null || true)
PROMPT=$(ORCH=$ORCH_DIR KEY=$KEY PR=$PR R=$GH_REPO WT=$WT BRANCH=$BRANCH BASE=$BASE PORT=$PORT STATE=$STATE \
  ISSUE=$ISSUE COAUTHOR=$COAUTHOR RISK=$RISK GATES=$GATES PROTECTED="${PROTECTED//|/, }" PROJECT_RULES="$RULES" \
  RESERVED="${RESERVED_PORTS//|/, }" TASK="$TASK${PUSH_NOTE:+
$PUSH_NOTE}" \
  python3 -I -c 'import os,re,sys; t=open(sys.argv[1]).read(); print(re.sub(r"\{\{(\w+)\}\}", lambda m: os.environ.get(m.group(1), ""), t))' "$ORCH_DIR/prompts/$ROLE.md")

OUT="$STATE/runs/$ROLE-$ID.json"; LOG="$STATE/logs/$ROLE-$ID.log"
printf '%s\n' "$PROMPT" > "$STATE/runs/$ROLE-$ID.prompt.md"
ENVV=(ORCH_ROLE="$ROLE" ORCH_KEY="$KEY" ORCH_PR="$PR" ORCH_BASE="$BASE" ORCH_MODEL="$MODEL" ORCH_PORT="$PORT"
      ORCH_PROTECTED="$PROTECTED" ORCH_RESERVED_PORTS="$RESERVED_PORTS" ORCH_GUARD_EXTRA="$ORCH_DIR/guard-extra.txt")
read -ra CMD <<<"$WORKER_CMD"
cd "$WT"
if [ "$WORKER_KIND" = claude ]; then
  # worker settings use an absolute hook path, because the worker's branch may predate this tooling
  SETTINGS="$STATE/worker-settings.json"
  printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node %s/hooks/worker-guard.mjs"}]}]}}\n' "$ORCH_DIR" > "$SETTINGS"
  [ -n "$WORKER_CONFIG_DIR" ] && { mkdir -p "$WORKER_CONFIG_DIR"; ENVV+=(CLAUDE_CONFIG_DIR="$WORKER_CONFIG_DIR"); }
  PID=$(python3 -I "$ORCH_DIR/detach.py" "$LOG" "$OUT" env "${ENVV[@]}" nice -n 10 "${CMD[@]}" "$PROMPT" \
    --model "$MODEL" --output-format json --settings "$SETTINGS")
else
  PID=$(python3 -I "$ORCH_DIR/detach.py" "$LOG" "$OUT" env "${ENVV[@]}" nice -n 10 "${CMD[@]}" "$STATE/runs/$ROLE-$ID.prompt.md")
fi
echo "$PID" > "$STATE/state/$ID.pid"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$ROLE" "$ID" "${PR:-}" "$MODEL" "$PID" >> "$STATE/launches.tsv"
echo "$ROLE $ID pid=$PID port=$PORT wt=$WT${ISSUE:+ issue=#$ISSUE}"
