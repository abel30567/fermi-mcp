-- Single-use approval tokens for high-risk tools (lib/tool.ts). D1 has one primary, so
-- redeeming with DELETE ... RETURNING is atomic, unlike the former KV get-then-delete.
CREATE TABLE IF NOT EXISTS approval_tokens (
	token TEXT PRIMARY KEY,
	tool TEXT NOT NULL,
	args_hash TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_expires ON approval_tokens(expires_at);
