CREATE TABLE IF NOT EXISTS connectors (
  name TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  secret_name TEXT,
  base_url TEXT NOT NULL,
  description TEXT,
  default_headers TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
