-- Per-box / per-mission grants for secret_resolve (MCP-28). A box session may
-- resolve a secret only when a row grants that secret name + scope to the box
-- itself (box_id) or to the mission it is running (agent_id = boxes.meta.agent_id).
-- No rows = default deny. Owner (OAuth) sessions are not affected.
-- Seeded empty on purpose; grant at deploy time (placeholder values shown):
--   INSERT INTO secret_grants (secret_name, scope, box_id, created_at)
--   VALUES ('EXAMPLE_SECRET', 'app', 'box-example', 0);
CREATE TABLE IF NOT EXISTS secret_grants (
	secret_name TEXT NOT NULL,
	scope TEXT NOT NULL DEFAULT 'app' CHECK (scope IN ('user','app','session')),
	box_id TEXT,
	agent_id TEXT,
	created_at INTEGER NOT NULL,
	CHECK ((box_id IS NULL) != (agent_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_secret_grants_name ON secret_grants(secret_name, scope);
