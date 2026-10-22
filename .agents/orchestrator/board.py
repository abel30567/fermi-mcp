# board.py gist|setup|sync [--apply] — a kanban of every tracked issue, with Status DERIVED from PR markers.
#   gist  : render Markdown and publish it to a SECRET (unlisted) gist. Works with any gh token.
#   setup : create a GitHub Project (user-owned, BOARD_OWNER, default @me) with the Status options
#   sync  : set each issue's Status on that Project. setup/sync need a gh token with the `project` scope.
# Tracked issues = label `tracked` or `follow-up`. Nobody edits Status by hand; the only manual inputs are
# the labels `status:ready` (Backlog -> Ready), `status:blocked` and `env:staging`.
import datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conf import BOARD_TITLE, JIRA_URL, R, STATE, TITLE_RE, TRACKED_LABELS, first_line  # noqa: E402

OWNER = os.environ.get("BOARD_OWNER", "@me")
STATUSES = ["Backlog", "Ready", "In Progress", "In Review", "Changes Requested", "Verified",
            "Merged", "On Staging", "Released", "Done", "Blocked"]
ICON = {"Backlog": "⚪", "Ready": "🔵", "In Progress": "🟡", "In Review": "🟣", "Changes Requested": "🟠",
        "Verified": "🟢", "Merged": "✅", "On Staging": "🧪", "Released": "🚀", "Done": "☑️", "Blocked": "⛔"}
APPLY = "--apply" in sys.argv
GIST_ID = STATE / "board-gist-id"   # local only; the gist is secret (unlisted)


def gh(*a):
    p = subprocess.run(["gh", *a], capture_output=True, text=True)
    if p.returncode:
        sys.exit(f"gh {' '.join(a[:4])}: {p.stderr.strip()[:400]}")
    return p.stdout


def derive(issue, prs, live_keys):
    """Status for one issue from its linked PRs (latest first-line markers) and labels."""
    labels = {l["name"] for l in issue["labels"]}
    if issue["state"] == "CLOSED":  # closed after release = Released; closed with no shipped PR = Done
        return "Released" if any(p["state"] == "MERGED" for p in prs) else "Done"
    if "status:blocked" in labels:
        return "Blocked"
    if "env:staging" in labels:
        return "On Staging"
    open_prs = [p for p in prs if p["state"] == "OPEN"]
    if open_prs:
        cs = sorted((c for p in open_prs for c in p["comments"]), key=lambda c: c["createdAt"])
        last = lambda m: next((first_line(c) for c in reversed(cs) if first_line(c).startswith(m)), "")
        b, v, br = last("[BUILDER]"), last("[VERIFIER]"), last("[BLAST-RADIUS]")
        tb = max((c["createdAt"] for c in cs if re.match(r"\[BUILDER\] (READY|ADDRESSED)", first_line(c))), default="")
        tv = max((c["createdAt"] for c in cs if first_line(c).startswith("[VERIFIER]")), default="")
        if "BLOCKED" in b:
            return "Blocked"
        if tv and tv > tb and ("CHANGES" in v or "UNSAFE" in br):
            return "Changes Requested"
        if tv and tv > tb and "VERIFIED" in v:
            return "Verified"
        return "In Review" if tb else "In Progress"
    if any(p["state"] == "MERGED" for p in prs):
        return "Merged"
    m = TITLE_RE.match(issue["title"])
    if m and m.group(1) in live_keys:
        return "In Progress"
    return "Ready" if "status:ready" in labels else "Backlog"


def collect():
    """[(issue, key, status, linked_prs, fix_rounds)] for every tracked issue."""
    issues = []
    for lab in TRACKED_LABELS:
        issues += json.loads(gh("issue", "list", "-R", R, "--state", "all", "--label", lab, "--limit", "300",
                                "--json", "number,title,state,labels,url"))
    issues = list({i["number"]: i for i in issues}.values())
    prs = json.loads(gh("pr", "list", "-R", R, "--state", "all", "--limit", "200",
                        "--json", "number,title,state,body,comments,url"))
    live = set()
    for f in (STATE / "state").glob("*.pid"):
        try:
            os.kill(int(f.read_text().strip()), 0); live.add(f.stem)
        except (OSError, ValueError):
            pass
    rows = []
    for i in sorted(issues, key=lambda x: x["number"]):
        m = TITLE_RE.match(i["title"]); key = m.group(1) if m else ""
        linked = [pr for pr in prs if re.search(rf"(Ref|Closes|Fixes|Resolves)\s*#{i['number']}\b",
                                                 (pr["body"] or "") + " ".join(c["body"] for c in pr["comments"]))]
        if not linked and key:  # fall back to PRs titled with the same [KEY]
            linked = [pr for pr in prs if pr["title"].startswith(f"[{key}]")]
        rounds = sum(1 for pr in linked for c in pr["comments"] if first_line(c).startswith("[BUILDER] ADDRESSED"))
        rows.append((i, key, derive(i, linked, live), linked, rounds))
    return rows


def render(rows):
    now = dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    by = {s: [r for r in rows if r[2] == s] for s in STATUSES}
    out = [f"# {BOARD_TITLE}", "", f"_Updated {now} by `orch board`. Status is derived from PR comment markers._", "",
           " · ".join(f"{ICON[s]} **{s}** {len(by[s])}" for s in STATUSES if by[s]) or "_No tracked issues yet._", ""]
    for s in STATUSES:
        if not by[s]:
            continue
        out += [f"## {ICON[s]} {s} ({len(by[s])})", "", "| Issue | Key | Title | PRs | Fix rounds |", "|---|---|---|---|---|"]
        for i, key, _, linked, rounds in by[s]:
            title = TITLE_RE.sub("", i["title"]).strip().replace("|", "\\|")
            prs = ", ".join(f"[#{p['number']}]({p['url']}) {p['state'].lower()}" for p in sorted(linked, key=lambda p: p["number"])) or "—"
            k = f"[{key}]({JIRA_URL}/browse/{key})" if key and JIRA_URL and not key.startswith("ISSUE-") else (key or "—")
            out.append(f"| [#{i['number']}]({i['url']}) | {k} | {title[:90]} | {prs} | {rounds} |")
        out.append("")
    return "\n".join(out) + "\n"


def gist():
    md = render(collect())
    path = STATE / "board.md"
    path.write_text(md)
    if not APPLY:
        print(md); return
    if GIST_ID.exists():
        gh("gist", "edit", GIST_ID.read_text().strip(), "-f", "board.md", str(path))
        print(f"updated https://gist.github.com/{GIST_ID.read_text().strip()}")
    else:
        url = gh("gist", "create", str(path), "--desc", BOARD_TITLE).strip()  # secret by default
        GIST_ID.write_text(url.rstrip("/").rsplit("/", 1)[-1])
        print(f"created {url}")


def project():
    for p in json.loads(gh("project", "list", "--owner", OWNER, "--format", "json", "--limit", "100"))["projects"]:
        if p["title"] == BOARD_TITLE:
            return p
    return None


def fields(num):
    return {f["name"]: f for f in json.loads(gh("project", "field-list", str(num), "--owner", OWNER, "--format", "json", "--limit", "50"))["fields"]}


def setup():
    p = project()
    if p:
        print(f"exists: #{p['number']} {p['url']}"); return
    if not APPLY:
        print(f"would create project '{BOARD_TITLE}' for {OWNER} (needs `gh auth refresh -s project`)"); return
    p = json.loads(gh("project", "create", "--owner", OWNER, "--title", BOARD_TITLE, "--format", "json"))
    num, st = p["number"], fields(p["number"])["Status"]["id"]
    opts = ",".join('{name:%s,color:%s,description:""}' % (json.dumps(s), c) for s, c in zip(
        STATUSES, ["GRAY", "BLUE", "YELLOW", "PURPLE", "ORANGE", "GREEN", "GREEN", "PINK", "GRAY", "GRAY", "RED"]))
    gh("api", "graphql", "-f", "query=mutation{updateProjectV2Field(input:{fieldId:\"%s\",singleSelectOptions:[%s]})"
       "{projectV2Field{... on ProjectV2SingleSelectField{id}}}}" % (st, opts))
    gh("project", "field-create", str(num), "--owner", OWNER, "--name", "Key", "--data-type", "TEXT")
    gh("project", "field-create", str(num), "--owner", OWNER, "--name", "Fix rounds", "--data-type", "NUMBER")
    gh("project", "link", str(num), "--owner", OWNER, "--repo", R)
    print(f"created: #{num} {p['url']}")


def sync():
    p = project()
    if not p:
        sys.exit("no project; run: orch board setup --apply")
    num, pid = p["number"], p["id"]
    fs = fields(num); st = fs["Status"]
    opt = {o["name"]: o["id"] for o in st["options"]}
    items = {}
    for it in json.loads(gh("project", "item-list", str(num), "--owner", OWNER, "--format", "json", "--limit", "500"))["items"]:
        if it.get("content", {}).get("number"):
            items[(it["content"].get("type"), it["content"]["number"])] = it
    for i, key, status, linked, rounds in collect():
        item = items.get(("Issue", i["number"]))
        cur = (item or {}).get("status")
        print(f"#{i['number']:<4} {key:12} {status:18} {'(was ' + cur + ')' if cur and cur != status else ''} PRs={[p['number'] for p in linked]}")
        if not APPLY:
            continue
        if not item:
            item = json.loads(gh("project", "item-add", str(num), "--owner", OWNER, "--url", i["url"], "--format", "json"))
        edit = lambda *a: gh("project", "item-edit", "--id", item["id"], "--project-id", pid, *a)
        if cur != status:
            edit("--field-id", st["id"], "--single-select-option-id", opt[status])
        if key:
            edit("--field-id", fs["Key"]["id"], "--text", key)
        edit("--field-id", fs["Fix rounds"]["id"], "--number", str(rounds))


if __name__ == "__main__":
    cmd = next((a for a in sys.argv[1:] if not a.startswith("-")), "gist")
    {"setup": setup, "sync": sync, "gist": gist}[cmd]()
