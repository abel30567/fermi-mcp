-- Allow the antigravity headless ACP route on cloud_agents.
-- SQLite cannot ALTER a CHECK constraint in place, so rebuild cloud_agents
-- preserving all columns, data, and indexes.
CREATE TABLE cloud_agents_new (
  id TEXT PRIMARY KEY,
  box_id TEXT REFERENCES boxes(box_id),
  task_id TEXT,
  queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'launching'
    CHECK (status IN ('launching','running','waiting_human','done','failed','destroyed')),
  route TEXT NOT NULL DEFAULT 'claude'
    CHECK (route IN ('claude','codex','grok','antigravity')),
  prompt TEXT NOT NULL,
  proof_contract TEXT NOT NULL,
  budget_usd REAL,
  ttl_seconds INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  exit_reason TEXT,
  artifacts_prefix TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  inference_usd REAL NOT NULL DEFAULT 0,
  instance_type TEXT,
  last_working_event_at INTEGER,
  restart_count INTEGER NOT NULL DEFAULT 0,
  account TEXT
);

INSERT INTO cloud_agents_new (
  id, box_id, task_id, queue, status, route, prompt, proof_contract,
  budget_usd, ttl_seconds, cost_usd, exit_reason, artifacts_prefix,
  created_at, started_at, ended_at, inference_usd, instance_type,
  last_working_event_at, restart_count, account
)
SELECT
  id, box_id, task_id, queue, status, route, prompt, proof_contract,
  budget_usd, ttl_seconds, cost_usd, exit_reason, artifacts_prefix,
  created_at, started_at, ended_at, inference_usd, instance_type,
  last_working_event_at, restart_count, account
FROM cloud_agents;

DROP TABLE cloud_agents;
ALTER TABLE cloud_agents_new RENAME TO cloud_agents;
CREATE INDEX IF NOT EXISTS cloud_agents_status ON cloud_agents(status, created_at);
CREATE INDEX IF NOT EXISTS cloud_agents_task ON cloud_agents(task_id);
