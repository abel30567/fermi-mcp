# .agents/orchestrator: tooling reference

`orch help` lists every command. The pattern is described in the kit's docs (`docs/2-the-pattern.md`);
the rules for agents are in your repo's CLAUDE.md / AGENTS.md (from `templates/AGENT-RULES.md`).

| File | Purpose |
|---|---|
| `orch` | Single entry point. Dispatches to the scripts below. |
| `config.sh`, `conf.py` | Load defaults, then `orch.env` (project, committed), then `local.env` (personal, gitignored). |
| `launch.sh` | Creates the worktree, renders `prompts/<role>.md`, starts one detached worker. |
| `detach.py` | Starts a worker in a new session so it survives the launching shell. |
| `merge-gate.py` | Merges at most one PR per run, and only when every rule holds. |
| `risk.py` | Decides whether a PR needs a blast-radius review (`risk-patterns.txt`). |
| `heartbeat.py` | `orch status`: workers, each PR's markers and next step, disk. |
| `board.py` | Kanban derived from markers: secret gist (`gist`) or GitHub Project (`setup` / `sync`). |
| `baseline.sh` | Runs GATES on a clean base and records `baseline.txt`. |
| `task.sh` | Creates a tracked issue (`ISSUE-<n>` key, or your own key). |
| `doctor.sh` | Checks tools, login, config, labels, branch protection. |
| `cleanup-idle.sh` | Removes finished worktrees whose work is pushed. |
| `usage.py` | Token and minute ledger from worker results. |
| `hooks/worker-guard.mjs` | PreToolUse hook that blocks forbidden worker commands (tests alongside). |
| `tracker/jira-sync.py` | Optional one-way Jira → GitHub issue mirror. |
| `adapters/` | Run non-Claude agent CLIs as workers. |

Run state lives in `~/.agent-orch/<repo>/` and is never committed:
- `runs/`: worker JSON results and rendered prompts.
- `logs/`: worker logs.
- `state/`: pids and ports.
- `inputs/<KEY>/`: files you hand to workers.
- `baseline.txt`, `launches.tsv` and `FREEZE`.

Worktrees live in `../<repo>-wt/` (`<KEY>`, `V<PR>`, `BR<PR>`).
