# usage.py — local token/time ledger from every worker's JSON result (never posted anywhere).
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conf import STATE  # noqa: E402

rows, tot = [], {"in": 0, "out": 0, "cr": 0, "turns": 0, "min": 0.0}
for f in sorted((STATE / "runs").glob("*.json"), key=lambda p: p.stat().st_mtime):
    try:
        d = json.loads(f.read_text().strip().splitlines()[-1])
    except (ValueError, IndexError):
        rows.append((f.stem, "-", 0, 0, 0, 0, 0.0, "no JSON result")); continue
    u = d.get("usage") or {}
    model = ",".join((d.get("modelUsage") or {}).keys()) or "-"
    r = (f.stem, model, u.get("input_tokens", 0), u.get("output_tokens", 0), u.get("cache_read_input_tokens", 0),
         d.get("num_turns", 0), round((d.get("duration_ms") or 0) / 60000, 1), "error" if d.get("is_error") else "ok")
    rows.append(r)
    for k, i in (("in", 2), ("out", 3), ("cr", 4), ("turns", 5), ("min", 6)):
        tot[k] += r[i]
print(f"{'run':22} {'model':18} {'input':>10} {'output':>8} {'cache-rd':>10} {'turns':>5} {'min':>6}  result")
for r in rows:
    print(f"{r[0]:22} {r[1][:18]:18} {r[2]:>10,} {r[3]:>8,} {r[4]:>10,} {r[5]:>5} {r[6]:>6}  {r[7]}")
print(f"{'TOTAL':22} {'':18} {tot['in']:>10,} {tot['out']:>8,} {tot['cr']:>10,} {tot['turns']:>5} {tot['min']:>6.1f}")
