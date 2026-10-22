# conf.py — the Python view of config.sh (one source of truth: bash sources orch.env + local.env,
# Python asks bash for the resolved values).
import re, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
_VARS = ("REPO REPO_NAME GH_REPO BASE KEY_RE STATE WTROOT MAX_CODE_FILES CODE_EXT MERGE_METHOD BOARD_TITLE "
         "JIRA_URL JIRA_PROJECT JIRA_STATUSES JIRA_POINTS_FIELD HEALTH_URL ORCH_DIR").split()
_SCRIPT = '. "$1" >/dev/null 2>&1 || exit 1; for v in ' + " ".join(_VARS) + '; do printf "%s=%s\\0" "$v" "${!v}"; done'
_p = subprocess.run(["bash", "-c", _SCRIPT, "_", str(HERE / "config.sh")], capture_output=True, text=True)
if _p.returncode:
    raise SystemExit("conf.py: could not load config.sh (is the orchestrator inside a git repo?)")
C = dict(kv.split("=", 1) for kv in _p.stdout.split("\0") if "=" in kv)

REPO, R, BASE = C["REPO"], C["GH_REPO"], C["BASE"]
KEY_RE = C["KEY_RE"]
TITLE_RE = re.compile(rf"^\[({KEY_RE})\]")       # PR / issue titles start with [KEY]
STATE = Path(C["STATE"])
WTROOT = Path(C["WTROOT"])
ORCH_DIR = Path(C["ORCH_DIR"])
MAX_CODE_FILES = int(C["MAX_CODE_FILES"] or 15)
CODE_EXT = C["CODE_EXT"]
MERGE_METHOD = C["MERGE_METHOD"] or "merge"
BOARD_TITLE = C["BOARD_TITLE"] or "Dev board"
JIRA_URL = C["JIRA_URL"].rstrip("/")
JIRA_PROJECT, JIRA_POINTS_FIELD = C["JIRA_PROJECT"], C["JIRA_POINTS_FIELD"]
JIRA_STATUSES = [s for s in C["JIRA_STATUSES"].split("|") if s]
HEALTH_URL = C["HEALTH_URL"]
TRACKED_LABELS = ("tracked", "follow-up")        # issues that appear on the board


def first_line(comment):
    """Only a comment's first line is a marker."""
    return comment["body"].lstrip().split("\n", 1)[0].strip()
