# heartbeat.py — one-screen status: workers, open [KEY] PRs and their next step, disk, optional health URL.
import datetime as dt, json, os, subprocess, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import risk  # noqa: E402
from conf import BASE, HEALTH_URL, R, STATE, TITLE_RE, WTROOT, first_line  # noqa: E402

now = dt.datetime.now(dt.timezone.utc)


def alive(pid):
    try:
        os.kill(int(pid), 0); return True
    except (OSError, ValueError):
        return False


print("== WORKERS")
pids = sorted((STATE / "state").glob("*.pid"))
for f in pids:
    pid = f.read_text().strip(); wid = f.stem
    run = next(iter(sorted((STATE / "runs").glob(f"*-{wid}.json"), key=lambda p: p.stat().st_mtime, reverse=True)), None)
    if alive(pid):
        print(f"   LIVE  {wid:10} pid={pid} {(now.timestamp() - f.stat().st_mtime) / 60:.0f} min")
    else:
        res = "no output"
        if run and run.stat().st_size:
            try:
                d = json.loads(run.read_text().strip().splitlines()[-1])
                res = f"{'ERROR' if d.get('is_error') else 'done'} turns={d.get('num_turns')} {round((d.get('duration_ms') or 0)/60000)} min: {str(d.get('result',''))[:90]!r}"
            except (ValueError, IndexError):
                res = "no JSON result (see logs/)"
        print(f"   EXIT  {wid:10} {res}")
if not pids:
    print("   (none)")

print(f"== OPEN PRs -> {BASE}")
prs = json.loads(subprocess.run(["gh", "pr", "list", "-R", R, "--state", "open", "--base", BASE, "--limit", "100",
                                 "--json", "number,title,headRefOid,mergeable,updatedAt,comments,labels"],
                                capture_output=True, text=True).stdout or "[]")
live = {f.stem for f in pids if alive(f.read_text().strip())}
shown = 0
for p in sorted((p for p in prs if TITLE_RE.match(p["title"])), key=lambda p: p["number"]):
    n, cs, key = p["number"], p["comments"], TITLE_RE.match(p["title"]).group(1)
    b = next((first_line(c) for c in reversed(cs) if first_line(c).startswith("[BUILDER]")), "-")
    v, _ = risk.verdict(cs, "[VERIFIER]", p["headRefOid"], n)
    r = risk.classify(n)
    br = risk.verdict(cs, "[BLAST-RADIUS]", p["headRefOid"], n)[0] if r["risky"] else "n/a"
    age = (now - dt.datetime.fromisoformat(p["updatedAt"].replace("Z", "+00:00"))).total_seconds() / 3600
    nxt = ("fixer" if v == "CHANGES" else "verifier" if v in ("NONE", "STALE") else
           "br" if r["risky"] and br != "SAFE" else "merge-gate")
    if "BLOCKED" in b:
        nxt = "human (builder BLOCKED)"
    busy = any(w in live for w in (f"V{n}", f"BR{n}", key))
    hold = " HOLD" if any(l["name"] == "merge:hold" for l in p["labels"]) else ""
    print(f"   #{n} {p['title'][:52]:52} builder={b[10:] or '-':9} verifier={v:8} br={br:6} "
          f"{p['mergeable'][:5]} {age:.0f}h next={'(busy)' if busy else nxt}{hold}")
    shown += 1
if not shown:
    print("   (none)")

print("== HOST")
st = os.statvfs(str(Path.home()))
wts = [d for d in WTROOT.glob("*") if d.is_dir()] if WTROOT.exists() else []
print(f"   disk free {st.f_bavail * st.f_frsize // 2**30} GB, worktrees {len(wts)}, FREEZE={'on' if (STATE/'FREEZE').exists() else 'off'}")
if HEALTH_URL:
    try:
        urllib.request.urlopen(HEALTH_URL, timeout=3); print(f"   {HEALTH_URL} up")
    except Exception as e:  # noqa: BLE001
        print(f"   {HEALTH_URL} " + ("up" if getattr(e, "code", None) else f"DOWN ({e})"))

# keep the secret-gist board current (no-op until `orch board --apply` has created it once)
if (STATE / "board-gist-id").exists():
    r = subprocess.run(["python3", "-I", str(Path(__file__).resolve().parent / "board.py"), "gist", "--apply"], capture_output=True, text=True)
    print("== BOARD\n   " + (r.stdout.strip().splitlines() or [r.stderr.strip()[:200]])[-1])
