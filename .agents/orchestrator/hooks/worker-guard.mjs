#!/usr/bin/env node
// PreToolUse(Bash) guard for orchestrator workers (Claude Code hook protocol: JSON on stdin, exit 2 = deny).
// Loaded only via the --settings file launch.sh writes, and a no-op unless ORCH_ROLE is set, so your
// interactive sessions are never affected. Fails open on bad input. Configured by launch.sh through:
//   ORCH_PROTECTED       branch alternation workers may never push to (BASE is always included)
//   ORCH_RESERVED_PORTS  port alternation only the orchestrator may use
//   ORCH_GUARD_EXTRA     path to guard-extra.txt: "<regex>\t<reason>" per line
import { readFileSync } from "node:fs";

const role = process.env.ORCH_ROLE;
if (!role) process.exit(0);

let cmd = "";
try {
  cmd = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

const PROTECTED = `(${process.env.ORCH_PROTECTED || "main|master|develop|development|staging|production"})`;
const PORTS = process.env.ORCH_RESERVED_PORTS || "";
const rules = [
  [/\bgh\s+pr\s+merge\b/, "only the orchestrator merges (merge-gate.py)"],
  [/\bgh\s+api\b[^\n]*\/pulls\/\d+\/merge\b/, "only the orchestrator merges (merge-gate.py)"],
  [new RegExp(`\\bgit\\s+push\\b[^\\n;&|]*(\\s|:|/)${PROTECTED}(\\s|$)`), "never push to a protected branch"],
  [/--no-verify\b/, "never bypass git hooks"],
  [/\bgh\s+pr\s+review\b[^\n]*--approve/, "workers do not approve PRs"],
];
if (PORTS) {
  rules.push([new RegExp(`\\b(lsof|kill|pkill|fuser)\\b[^\\n]*\\b(${PORTS})\\b|--port[= ](${PORTS})\\b|PORT=(${PORTS})\\b`),
    `ports ${PORTS.replaceAll("|", "/")} are reserved for the orchestrator`]);
}
try {
  for (const line of readFileSync(process.env.ORCH_GUARD_EXTRA || "/nonexistent", "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [re, why = "blocked by guard-extra.txt"] = line.split("\t");
    try { rules.push([new RegExp(re), why]); } catch { /* skip bad regex */ }
  }
} catch { /* no extra rules */ }

// Role-scoped markers: each role may only speak for itself.
const own = { builder: "BUILDER", fixer: "BUILDER", verifier: "VERIFIER", br: "BLAST-RADIUS" }[role];
const posting = /\bgh\s+(pr|issue)\s+(comment|create|edit)\b|\bgh\s+api\b[^\n]*comments/.test(cmd);
for (const m of ["BUILDER", "VERIFIER", "BLAST-RADIUS", "ORCHESTRATOR"]) {
  if (posting && m !== own) rules.push([new RegExp(`\\[${m}\\]`), `a ${role} may not post ${m} markers`]);
}
if (role === "verifier" || role === "br") {
  rules.push([/\bgit\s+push\b/, "reviewers never push"]);
  rules.push([/\bgh\s+pr\s+(edit|ready|close|create)\b/, "reviewers never edit PRs"]);
}

for (const [re, why] of rules) {
  if (re.test(cmd)) {
    process.stderr.write(`orchestrator worker-guard (${role}): blocked — ${why}. Post [BUILDER] BLOCKED / explain in your verdict instead.\n`);
    process.exit(2);
  }
}
process.exit(0);
