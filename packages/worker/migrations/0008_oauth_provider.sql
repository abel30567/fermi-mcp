-- OAuth 2.0 Authorization Server tables for MCP endpoint protection
-- These are separate from the existing oauth_clients table (which is for outbound OAuth flows)

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	client_id TEXT NOT NULL UNIQUE,
	client_secret_hash TEXT,
	redirect_uris TEXT NOT NULL DEFAULT '[]',
	allowed_scopes TEXT NOT NULL DEFAULT '["mcp"]',
	name TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	token_hash TEXT NOT NULL UNIQUE,
	token_type TEXT NOT NULL CHECK(token_type IN ('access', 'refresh')),
	client_id TEXT NOT NULL,
	scopes TEXT NOT NULL DEFAULT '["mcp"]',
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
	FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	code_hash TEXT NOT NULL UNIQUE,
	client_id TEXT NOT NULL,
	redirect_uri TEXT NOT NULL,
	scopes TEXT NOT NULL DEFAULT '["mcp"]',
	code_challenge TEXT,
	code_challenge_method TEXT DEFAULT 'S256',
	expires_at INTEGER NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
	FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_hash ON mcp_oauth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_client ON mcp_oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_expires ON mcp_oauth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_hash ON mcp_oauth_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expires ON mcp_oauth_codes(expires_at);
