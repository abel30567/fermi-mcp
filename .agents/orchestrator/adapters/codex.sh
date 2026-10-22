#!/usr/bin/env bash
# Example adapter: run one orchestrator worker with the OpenAI Codex CLI. Check flags with `codex exec --help`.
# $1 = prompt file; cwd = the worker's worktree; ORCH_MODEL = BUILDER_MODEL / VERIFIER_MODEL from local.env.
set -euo pipefail
exec codex exec --full-auto ${ORCH_MODEL:+-m "$ORCH_MODEL"} "$(cat "$1")"
