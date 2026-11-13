# jira-sync.py [--apply] [KEY ...] — OPTIONAL one-way mirror of Jira tickets into tracked GitHub issues.
#   * creates `[KEY] <summary>` issues labelled `tracked` + `jira:KEY` + `type:<x>` when missing
#   * refreshes only the <!-- jira-sync --> block of existing issues (never status, never comments)
# Jira stays the contract for QA/PM; GitHub is where development happens. Without --apply: dry run.
# Config (orch.env): JIRA_URL, JIRA_PROJECT, JIRA_STATUSES, JIRA_POINTS_FIELD.
# Credentials (environment only, never a file in the repo): JIRA_EMAIL, JIRA_API_TOKEN.
import base64, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from conf import JIRA_POINTS_FIELD, JIRA_PROJECT, JIRA_STATUSES, JIRA_URL, KEY_RE, R  # noqa: E402

APPLY = "--apply" in sys.argv
KEYS = [a for a in sys.argv[1:] if re.fullmatch(KEY_RE, a)]
START, END = "<!-- jira-sync:start -->", "<!-- jira-sync:end -->"
if not JIRA_URL or not (JIRA_PROJECT or KEYS):
    sys.exit("set JIRA_URL and JIRA_PROJECT in orch.env (or pass ticket keys)")
EMAIL, TOKEN = os.environ.get("JIRA_EMAIL"), os.environ.get("JIRA_API_TOKEN")
if not (EMAIL and TOKEN):
    sys.exit("export JIRA_EMAIL and JIRA_API_TOKEN (https://id.atlassian.com/manage-profile/security/api-tokens)")


def jira(method, path, body=None):
    req = urllib.request.Request(JIRA_URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode(),
                                          "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit(f"Jira {method} {path}: HTTP {e.code} {e.read()[:300]!r}")


def gh(*a, input=None):
    p = subprocess.run(["gh", *a], capture_output=True, text=True, input=input)
    if p.returncode:
        sys.exit(f"gh {' '.join(a[:3])} failed: {p.stderr.strip()[:300]}")
    return p.stdout


def adf_md(n):
    """Minimal Atlassian Document Format -> GitHub markdown (paragraphs, lists, headings, links, tables)."""
    if not n:
        return ""
    t = n.get("type")
    kids = lambda: "".join(adf_md(c) for c in n.get("content", []))
    if t == "text":
        s = n.get("text", "")
        for m in n.get("marks", []):
            if m["type"] == "strong": s = f"**{s}**"
            elif m["type"] == "code": s = f"`{s}`"
            elif m["type"] == "link": s = f"[{s}]({m['attrs'].get('href', '')})"
        return s
    if t in ("inlineCard", "blockCard"): return n.get("attrs", {}).get("url", "")
    if t == "hardBreak": return "\n"
    if t == "mention": return "@" + n.get("attrs", {}).get("text", "").lstrip("@")
    if t == "paragraph": return kids() + "\n\n"
    if t == "heading": return "#" * min(6, n["attrs"].get("level", 3) + 1) + " " + kids() + "\n\n"
    if t in ("bulletList", "orderedList"):
        return "".join(("1. " if t == "orderedList" else "- ") + adf_md(c).strip().replace("\n", "\n  ") + "\n"
                       for c in n.get("content", [])) + "\n"
    if t == "tableRow": return "| " + " | ".join(adf_md(c).strip().replace("\n", " ") for c in n["content"]) + " |\n"
    if t == "codeBlock": return "```\n" + kids() + "\n```\n\n"
    if t in ("mediaSingle", "mediaGroup", "media"): return ""  # attachments are listed separately
    return kids()


def block(issue):
    f = issue["fields"]
    atts = "".join(f"- {a['filename']}\n" for a in f.get("attachment") or [])
    links = "".join(f"- {l['type']['name']}: {(l.get('outwardIssue') or l.get('inwardIssue'))['key']}\n" for l in f.get("issuelinks") or [])
    parent = (f.get("parent") or {}).get("key")
    pts = f.get(JIRA_POINTS_FIELD) if JIRA_POINTS_FIELD else None
    meta = " · ".join(x for x in [f["issuetype"]["name"], f"Jira status: {f['status']['name']}",
                                   f"Priority: {f['priority']['name']}" if f.get("priority") else "",
                                   f"Story points: {pts}" if pts else "", f"Parent: {parent}" if parent else ""] if x)
    return (f"{START}\n**Jira:** [{issue['key']}]({JIRA_URL}/browse/{issue['key']}) · {meta}\n\n"
            f"{adf_md(f.get('description')).strip() or '_No description in Jira._'}\n\n"
            + (f"**Jira attachments** (open in Jira):\n{atts}\n" if atts else "")
            + (f"**Linked tickets:**\n{links}\n" if links else "")
            + f"_Mirrored from Jira by `orch sync-jira`; edit the ticket in Jira, not this block._\n{END}")


statuses = ",".join(json.dumps(s) for s in JIRA_STATUSES)
jql = (f"key in ({','.join(KEYS)})" if KEYS else
       f"project = {JIRA_PROJECT} AND assignee = currentUser()" + (f" AND status in ({statuses})" if statuses else ""))
flds = ["summary", "status", "issuetype", "priority", "description", "attachment", "issuelinks", "parent"] + ([JIRA_POINTS_FIELD] if JIRA_POINTS_FIELD else [])
issues = jira("POST", "/rest/api/3/search/jql", {"jql": jql + " ORDER BY key", "maxResults": 100, "fields": flds})["issues"]
existing = {}
for i in json.loads(gh("issue", "list", "-R", R, "--state", "all", "--limit", "500", "--label", "tracked", "--json", "number,labels,body,title")):
    for l in i["labels"]:
        if l["name"].startswith("jira:"):
            existing[l["name"][5:]] = i

labels = {l["name"] for l in json.loads(gh("label", "list", "-R", R, "--limit", "500", "--json", "name"))}
def ensure_label(name, color, desc):
    if name not in labels and APPLY:
        gh("label", "create", name, "-R", R, "--color", color, "--description", desc)
        labels.add(name)

ensure_label("tracked", "0052CC", "On the orchestrator board")
for it in issues:
    key, f = it["key"], it["fields"]
    typ = "type:" + re.sub(r"[^a-z0-9]+", "-", f["issuetype"]["name"].lower())
    title, b = f"[{key}] {f['summary']}", block(it)
    if key in existing:
        cur = existing[key]; body = cur["body"] or ""
        new = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: b, body, flags=re.S) if START in body else b + "\n\n" + body
        if new.strip() == body.strip() and cur["title"] == title:
            print(f"SAME    {key} -> #{cur['number']}"); continue
        print(f"UPDATE  {key} -> #{cur['number']}")
        if APPLY:
            gh("issue", "edit", str(cur["number"]), "-R", R, "--title", title, "--body-file", "-", input=new)
        continue
    print(f"CREATE  {key} {title[:70]}")
    if APPLY:
        ensure_label(f"jira:{key}", "C5DEF5", f"Jira {key}")
        ensure_label(typ, "D4C5F9", f"Jira issue type {typ[5:]}")
        print("        " + gh("issue", "create", "-R", R, "--title", title, "--label", f"tracked,jira:{key},{typ}", "--body-file", "-", input=b).strip())
if not issues:
    print("no matching Jira tickets for:", jql)
