-- Cloud fleet foundation: task queue ownership + box registry + cloud agent runs.
-- Tasks gain routing and lease ownership so cloud boxes and the Mac drain
-- daemon never steal each other's work (previously the only isolation was
-- the 15-minute stale window).
ALTER TABLE tasks ADD COLUMN queue TEXT NOT NULL DEFAULT 'main';
ALTER TABLE tasks ADD COLUMN claimed_by TEXT;
ALTER TABLE tasks ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
CREATE INDEX IF NOT EXISTS tasks_queue_status_created ON tasks(queue, status, created_at);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_task_id);

-- Box registry: one row per remote worker (cloud box or private worker).
-- Generalizes the MACOS_MCP_URL/MACOS_MCP_TOKEN env-var pair into data.
CREATE TABLE IF NOT EXISTS boxes (
  box_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'aws'
    CHECK (provider IN ('aws','cloudflare','private')),
  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','online','offline','destroyed')),
  instance_ref TEXT,
  mcp_url TEXT,
  oauth_client_id TEXT,
  region TEXT,
  snapshot_ref TEXT,
  last_heartbeat_at INTEGER,
  created_at INTEGER NOT NULL,
  destroyed_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS boxes_status ON boxes(status);

-- Cloud agent runs: one row per summoned agent. proof_contract is required
-- by design: no agent is launched without stating what evidence must come back.
CREATE TABLE IF NOT EXISTS cloud_agents (
  id TEXT PRIMARY KEY,
  box_id TEXT REFERENCES boxes(box_id),
  task_id TEXT,
  queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'launching'
    CHECK (status IN ('launching','running','waiting_human','done','failed','destroyed')),
  route TEXT NOT NULL DEFAULT 'claude'
    CHECK (route IN ('claude','codex','grok')),
  prompt TEXT NOT NULL,
  proof_contract TEXT NOT NULL,
  budget_usd REAL,
  ttl_seconds INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  exit_reason TEXT,
  artifacts_prefix TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS cloud_agents_status ON cloud_agents(status, created_at);
CREATE INDEX IF NOT EXISTS cloud_agents_task ON cloud_agents(task_id);
