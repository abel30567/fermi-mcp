# risk.py PR [--reasons|--gate] — classify a PR as risky (needs an independent [BLAST-RADIUS] review).
#   default    JSON {pr, risky, reasons, sha, branch}
#   --reasons  comma-separated reasons (empty if not risky)
#   --gate     NOT-RISKY | OK | UNSAFE | STALE | NONE   (blast-radius verdict for the current head)
# Risky = any changed path matches risk-patterns.txt, or more than MAX_CODE_FILES code files changed.
import json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conf import BASE, CODE_EXT, MAX_CODE_FILES, ORCH_DIR, R, REPO, first_line  # noqa: E402

PATTERNS = [l.strip() for l in (ORCH_DIR / "risk-patterns.txt").read_text().splitlines()
            if l.strip() and not l.lstrip().startswith("#")] if (ORCH_DIR / "risk-patterns.txt").exists() else []
TOOLING = re.escape(str(ORCH_DIR.relative_to(REPO))) + "/" if str(ORCH_DIR).startswith(REPO) else None
if TOOLING:
    PATTERNS.append("^" + TOOLING)  # changes to the orchestrator itself are always risky


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout


def classify(pr):
    d = json.loads(sh("gh", "pr", "view", str(pr), "-R", R, "--json", "headRefOid,headRefName"))
    files = sh("gh", "api", "--paginate", f"repos/{R}/pulls/{pr}/files?per_page=100", "--jq", ".[].filename").split()
    code = [f for f in files if re.search(rf"\.({CODE_EXT})$", f) and not re.search(r"(__tests__|\.test\.|\.spec\.|(^|/)tests?/)", f)]
    reasons = [f"{len(code)} code files > {MAX_CODE_FILES}"] if len(code) > MAX_CODE_FILES else []
    reasons += sorted({p for f in files for p in PATTERNS if re.search(p, f)})
    return {"pr": pr, "risky": bool(reasons), "reasons": reasons, "sha": d["headRefOid"], "branch": d["headRefName"]}


def only_base_since(old, head, pr):
    """True if old..head contains nothing but merges of the base (the PR's own changes are unchanged)."""
    g = lambda *a: subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True)
    g("fetch", "-q", "origin", BASE, f"+refs/pull/{pr}/head:refs/remotes/pr/{pr}")
    if g("merge-base", "--is-ancestor", old, head).returncode != 0:
        return False
    return not g("rev-list", "--no-merges", f"{old}..{head}", f"^origin/{BASE}").stdout.split()


def verdict(comments, marker, head, pr):
    """Latest first-line `marker` verdict for head: (word, reviewed_sha), ('NONE', None) or ('STALE', sha)."""
    for c in reversed(comments):
        first = first_line(c)
        if not first.startswith(marker):
            continue
        m = re.search(r"Reviewed head ([0-9a-f]{7,40})", c["body"])
        word = first[len(marker):].strip().split(" ")[0].upper()
        if not m:
            return "STALE", None
        sha = m.group(1)
        if head.startswith(sha) or sha.startswith(head[:7]) or only_base_since(sha, head, pr):
            return word, sha
        return "STALE", sha
    return "NONE", None


if __name__ == "__main__":
    pr = int(sys.argv[1])
    r = classify(pr)
    mode = sys.argv[2] if len(sys.argv) > 2 else ""
    if mode == "--reasons":
        print(", ".join(r["reasons"]))
    elif mode == "--gate":
        if not r["risky"]:
            print("NOT-RISKY")
        else:
            cs = json.loads(sh("gh", "pr", "view", str(pr), "-R", R, "--json", "comments"))["comments"]
            w, _ = verdict(cs, "[BLAST-RADIUS]", r["sha"], pr)
            print({"SAFE": "OK"}.get(w, w))
    else:
        print(json.dumps(r))
