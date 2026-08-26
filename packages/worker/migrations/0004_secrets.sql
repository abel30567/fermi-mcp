CREATE TABLE IF NOT EXISTS secrets (
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('user','app','session')),
  session_id TEXT NOT NULL DEFAULT '',
  encrypted_value BLOB NOT NULL,
  iv BLOB NOT NULL,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  allowed_capabilities TEXT NOT NULL DEFAULT '[]',
  allowed_packages TEXT NOT NULL DEFAULT '[]',
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, scope, session_id)
);
CREATE INDEX IF NOT EXISTS secrets_scope ON secrets(scope);
