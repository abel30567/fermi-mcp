CREATE TABLE IF NOT EXISTS retrievers (
  name TEXT PRIMARY KEY,
  sql TEXT NOT NULL,
  description TEXT,
  param_schema TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  name TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret_name TEXT NOT NULL,
  auth_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  redirect_path TEXT NOT NULL DEFAULT '/oauth/callback',
  result_secret_name TEXT NOT NULL,
  result_allowed_hosts TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
