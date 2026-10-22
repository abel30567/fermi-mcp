// node --test hooks/worker-guard.test.mjs   (or: orch selftest)
// Allow/deny table for the worker guard. Add a deny AND an allow row whenever you add a rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./worker-guard.mjs", import.meta.url));
const EXTRA = join(mkdtempSync(join(tmpdir(), "guard-")), "extra.txt");
writeFileSync(EXTRA, "# comment\n\\bdocker\\s+restart\\b\tdocker belongs to the orchestrator\n");
const ENV = { ORCH_PROTECTED: "main|staging", ORCH_RESERVED_PORTS: "3000|5432", ORCH_GUARD_EXTRA: EXTRA };
const run = (role, command, input) =>
  spawnSync("node", [HOOK], {
    input: input ?? JSON.stringify({ tool_input: { command } }),
    env: { ...process.env, ...ENV, ORCH_ROLE: role ?? "" },
  }).status;

const DENY = [
  ["builder", "gh pr merge 5 --merge"],
  ["builder", "gh api -X PUT repos/o/r/pulls/5/merge"],
  ["builder", "git push origin HEAD:main"],
  ["fixer", "git push origin staging"],
  ["builder", "git commit -m x --no-verify"],
  ["builder", "gh pr review 5 --approve"],
  ["builder", "PORT=3000 npm run dev"],
  ["builder", "kill $(lsof -t -i:5432)"],
  ["builder", "docker restart db"],
  ["builder", "gh pr comment 5 --body '[VERIFIER] VERIFIED'"],
  ["verifier", "gh pr comment 5 --body '[BUILDER] READY'"],
  ["verifier", "git push origin feature-x"],
  ["br", "gh pr edit 5 --title x"],
];
const ALLOW = [
  ["builder", "git push -u origin feat/PROJ-1-x"],
  ["builder", "gh pr comment 5 --body '[BUILDER] READY'"],
  ["fixer", "gh pr view 5 --comments | grep '[VERIFIER]'"],
  ["verifier", "gh pr comment 5 --body-file /tmp/v.md"],
  ["builder", "PORT=8161 npm run dev"],
  ["builder", "docker ps"],
  ["builder", "npm ci && npm test && npm run build"],
];

for (const [role, cmd] of DENY) test(`deny ${role}: ${cmd}`, () => assert.equal(run(role, cmd), 2));
for (const [role, cmd] of ALLOW) test(`allow ${role}: ${cmd}`, () => assert.equal(run(role, cmd), 0));
test("no ORCH_ROLE → no-op even for gh pr merge", () => assert.equal(run(undefined, "gh pr merge 5"), 0));
test("malformed input fails open", () => assert.equal(run("builder", null, "not json"), 0));
