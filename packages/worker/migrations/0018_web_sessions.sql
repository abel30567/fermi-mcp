-- Session vault: capture a logged-in web session once (MFA once, on the Mac /
-- residential IP), then LEASE it to N cloud boxes. Boxes replay the storageState
-- from a consistent egress; leasing (not copying) enforces concurrency caps and
-- central revocation.
CREATE TABLE IF NOT EXISTS web_sessions (
  name TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  encrypted_state BLOB NOT NULL,
  iv BLOB NOT NULL,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  allowed_boxes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);

-- One row per active lease; released_at set on release/expiry. Active leases
-- (released_at IS NULL AND expires_at > now) count against max_concurrent.
CREATE TABLE IF NOT EXISTS web_session_leases (
  id TEXT PRIMARY KEY,
  session_name TEXT NOT NULL,
  box_id TEXT NOT NULL,
  leased_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER
);
CREATE INDEX IF NOT EXISTS leases_session_active ON web_session_leases(session_name, released_at);
