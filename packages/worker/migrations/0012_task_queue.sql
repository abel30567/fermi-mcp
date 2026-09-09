-- Task queue: channel gateways enqueue inbound messages, the Mac-local
-- claude -p daemon drains them via MCP tools (task_claim / task_complete).
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  sender TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','done','failed')),
  result TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_status_created ON tasks(status, created_at);
