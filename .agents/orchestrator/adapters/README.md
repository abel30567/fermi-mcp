# Worker adapters (WORKER_KIND=custom)

Claude Code is the default worker (`WORKER_KIND=claude`) because it is the only one the guard hook
plugs into. Any other headless agent CLI works through a small adapter script:

- `launch.sh` runs `$WORKER_CMD <prompt-file>` inside the worker's worktree (that is the cwd).
- These environment variables are set: `ORCH_ROLE`, `ORCH_KEY`, `ORCH_PR`, `ORCH_BASE`, `ORCH_MODEL`, `ORCH_PORT`.
- stdout goes to `$STATE/runs/<role>-<id>.json`, stderr to `$STATE/logs/<role>-<id>.log`.
- The agent must be able to run shell commands, including `git` and `gh`, without asking.

The guard hook does **not** run for custom workers, so GitHub branch protection on your base branch
is your backstop (see docs/4-customizing.md). The merge gate still applies, because it reads markers
from GitHub and does not care which agent wrote them.

`codex.sh` is an example. Check the flags against your installed CLI version (`codex exec --help`).
To use it, set this in local.env:

    WORKER_KIND="custom"
    WORKER_CMD="/absolute/path/to/.agents/orchestrator/adapters/codex.sh"
