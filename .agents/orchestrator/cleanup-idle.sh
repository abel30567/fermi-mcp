#!/usr/bin/env bash
# Remove orchestrator worktrees whose worker is gone and whose work is safe on the remote:
#   V*/BR*/BASELINE (reviewers, detached) always; builder/fixer worktrees only if clean and HEAD is pushed.
. "$(dirname "$0")/config.sh"
for d in "$WTROOT"/*; do
  [ -d "$d" ] || continue; id=$(basename "$d")
  pidf="$STATE/state/$id.pid"
  [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null && { echo "keep (live worker): $id"; continue; }
  # ignore macOS Spotlight indexers (mdworker/mds); they are not ours and come and go
  live=$(for p in $(lsof -t +D "$d" 2>/dev/null | sort -u); do ps -o comm= -p "$p" | grep -vqE 'mdworker|mds' && echo "$p"; done | head -1)
  [ -n "$live" ] && { echo "keep (process inside): $id"; continue; }
  case "$id" in
    V[0-9]*|BR[0-9]*|BASELINE) ;;
    *) [ -z "$(git -C "$d" status --porcelain 2>/dev/null)" ] && [ -n "$(git -C "$d" branch -r --contains HEAD 2>/dev/null)" ] \
         || { echo "keep (unpushed or dirty): $id"; continue; } ;;
  esac
  git -C "$REPO" worktree remove --force "$d" && rm -f "$STATE/state/$id".{pid,port} && echo "removed: $id"
done
git -C "$REPO" worktree prune
