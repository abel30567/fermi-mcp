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

-- No seed rows: this repo is public, so the owner's personal sender ids are not
-- committed here. They were removed after this migration had been applied in
-- production; D1 tracks applied migrations by filename, so live rows are untouched.
-- Add senders at runtime with the allowlist_add MCP tool, e.g.
--   allowlist_add { channel: 'wa', sender_id: '15555550100', note: 'owner' }

-- Usage stats join tasks by (channel, sender).
CREATE INDEX IF NOT EXISTS tasks_channel_sender ON tasks(channel, sender);
