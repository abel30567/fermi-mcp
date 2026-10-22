# merge-gate.py [--apply] — merge at most ONE open [KEY] PR into BASE, and only if ALL hold:
#   1. no `merge:hold` label, GitHub says MERGEABLE
#   2. latest first-line [VERIFIER] verdict is VERIFIED, newer than the last [BUILDER] READY/ADDRESSED,
#      and its `Reviewed head` is the current head (or only BASE was merged in since)
#   3. risky PRs (risk.py) carry a matching [BLAST-RADIUS] SAFE
#   4. head contains current origin/BASE (strict train; otherwise update-branch and wait)
#   5. every GitHub check on the head passed
# Without --apply it only reports. It never touches your issue tracker; it prints TRACKER lines for you.
import json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import risk  # noqa: E402
from conf import BASE, MERGE_METHOD, R, REPO, STATE, TITLE_RE, first_line  # noqa: E402

APPLY = "--apply" in sys.argv


def gh(*a):
    p = subprocess.run(["gh", *a], capture_output=True, text=True)
    return p.stdout, p.returncode


subprocess.run(["git", "-C", REPO, "fetch", "-q", "origin", BASE])
base_sha = subprocess.run(["git", "-C", REPO, "rev-parse", f"origin/{BASE}"], capture_output=True, text=True).stdout.strip()
prs = json.loads(gh("pr", "list", "-R", R, "--state", "open", "--base", BASE, "--limit", "100",
                    "--json", "number,title,labels,headRefOid,mergeable,isDraft,comments")[0] or "[]")
prs = sorted((p for p in prs if TITLE_RE.match(p["title"])), key=lambda p: p["number"])
for p in prs:
    n, head, key = p["number"], p["headRefOid"], TITLE_RE.match(p["title"]).group(1)
    tag = f"#{n} {key}"
    if any(l["name"] == "merge:hold" for l in p["labels"]):
        print(f"HOLD     {tag} (merge:hold)"); continue
    cs = p["comments"]
    v_word, _ = risk.verdict(cs, "[VERIFIER]", head, n)
    last_v = max((c["createdAt"] for c in cs if first_line(c).startswith("[VERIFIER]")), default="")
    last_b = max((c["createdAt"] for c in cs if re.match(r"\[BUILDER\] (READY|ADDRESSED)", first_line(c))), default="")
    if v_word != "VERIFIED" or last_b > last_v:
        why = "stale (builder pushed after verdict)" if last_b > last_v and last_v else v_word
        print(f"WAIT     {tag} verifier={why}"); continue
    r = risk.classify(n)
    if r["risky"]:
        b_word, _ = risk.verdict(cs, "[BLAST-RADIUS]", head, n)
        if b_word != "SAFE":
            print(f"WAIT     {tag} risky ({', '.join(r['reasons'])}) blast-radius={b_word} -> orch launch br {n}"); continue
    if p["mergeable"] == "UNKNOWN":
        print(f"WAIT     {tag} GitHub is still computing mergeability; re-run"); continue
    if p["mergeable"] != "MERGEABLE":
        print(f"CONFLICT {tag} mergeable={p['mergeable']} -> orch launch fixer {n} 'merge origin/{BASE}'"); continue
    subprocess.run(["git", "-C", REPO, "fetch", "-q", "origin", f"+refs/pull/{n}/head:refs/remotes/pr/{n}"])
    if subprocess.run(["git", "-C", REPO, "merge-base", "--is-ancestor", base_sha, head]).returncode:
        if APPLY and gh("pr", "update-branch", str(n), "-R", R)[1] == 0:
            print(f"BEHIND   {tag} merged {BASE} in; re-run after checks finish")
        else:
            print(f"BEHIND   {tag} head lacks origin/{BASE} {base_sha[:7]} (run with --apply to update-branch)")
        break  # strict train: one front at a time
    checks = json.loads(gh("pr", "checks", str(n), "-R", R, "--json", "name,bucket")[0] or "[]")
    bad = [c["name"] for c in checks if c["bucket"] not in ("pass", "skipping")]
    if bad:
        print(f"CHECKS   {tag} not green: {', '.join(bad)}"); break
    if not checks:
        print(f"NOTE     {tag} has no CI checks; the local gates are the only evidence (see templates/github/pr-gates.yml)")
    if not APPLY:
        print(f"READY    {tag} all gates pass (dry run; --apply merges)"); break
    if p["isDraft"]:
        gh("pr", "ready", str(n), "-R", R)
    gh("pr", "comment", str(n), "-R", R, "--body",
       f"[ORCHESTRATOR] Merging into {BASE}: [VERIFIER] VERIFIED on {head[:7]}"
       + (" + [BLAST-RADIUS] SAFE" if r["risky"] else "") + ", head contains current base, checks green.")
    out, rc = gh("pr", "merge", str(n), "-R", R, f"--{MERGE_METHOD}")
    if rc:
        print(f"FAILED   {tag} gh pr merge rc={rc}"); break
    print(f"MERGED   {tag} -> {BASE}")
    print(f"TRACKER  {key}: merged in PR #{n}; update your tracker if you mirror one")
    if (STATE / "board-gist-id").exists():
        subprocess.run(["python3", "-I", str(Path(__file__).resolve().parent / "board.py"), "gist", "--apply"], capture_output=True)
    break
if not prs:
    print("no open [KEY] PRs against", BASE)
