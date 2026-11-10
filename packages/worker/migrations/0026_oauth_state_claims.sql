-- Single-use claims for connector OAuth state (lib/oauth-flow.ts). KV has no
-- compare-and-delete, so the callback claims its state here: the PRIMARY KEY lets
-- exactly one of concurrent callbacks insert the row, and a replay finds it taken.
CREATE TABLE IF NOT EXISTS oauth_state_claims (
	state TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_claims_expires ON oauth_state_claims(expires_at);
