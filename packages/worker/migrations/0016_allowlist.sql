-- Allowlist v2: per-channel sender allowlist moves from KV blobs to D1 so it
-- can be listed, joined against tasks for usage stats, and edited via MCP.
CREATE TABLE IF NOT EXISTS allowlist (
  channel TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  note TEXT,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  PRIMARY KEY (channel, sender_id)
);

-- Seed the existing allowlisted senders (owner + guest) so the KV → D1 cutover
-- doesn't lock anyone out.
INSERT OR IGNORE INTO allowlist (channel, sender_id, note, added_at, added_by) VALUES
  ('tg', '7254471750', 'owner', 1783200000000, 'migration'),
  ('wa', '17866630320', 'owner', 1783200000000, 'migration'),
  ('wa', '14074122029', 'guest', 1783200000000, 'migration');

-- Usage stats join tasks by (channel, sender).
CREATE INDEX IF NOT EXISTS tasks_channel_sender ON tasks(channel, sender);
