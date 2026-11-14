-- Knowledge tokens (ISSUE-88): a long-lived machine principal bound to one
-- namespace, served on /k/mcp. Only SHA-256(secret) is stored.
CREATE TABLE IF NOT EXISTS knowledge_tokens (
	token_id TEXT PRIMARY KEY,
	secret_hash TEXT NOT NULL,
	namespace TEXT NOT NULL,
	label TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER,
	revoked_at INTEGER
);

-- The data wall: namespaced rows live in their own tables, so no owner or box
-- reader of `memory` / `skills` (tools, crons, retrievers) can ever see them.
CREATE TABLE IF NOT EXISTS knowledge_memory (
	id INTEGER PRIMARY KEY,
	namespace TEXT NOT NULL,
	kind TEXT NOT NULL,
	body TEXT NOT NULL,
	pinned INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_memory_ns ON knowledge_memory(namespace, pinned, created_at);

-- Skill bodies are stored here, not in R2, so the owner's fs_* tools cannot list them.
CREATE TABLE IF NOT EXISTS knowledge_skills (
	namespace TEXT NOT NULL,
	slug TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT,
	keywords TEXT NOT NULL DEFAULT '[]',
	allowed_tools TEXT NOT NULL DEFAULT '[]',
	body TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	source TEXT NOT NULL DEFAULT 'manual',
	origin_memory_id INTEGER,
	usage_count INTEGER NOT NULL DEFAULT 0,
	last_used_at INTEGER,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (namespace, slug)
);

-- Audit rows of knowledge sessions name the principal, token and namespace.
ALTER TABLE audit ADD COLUMN principal TEXT;
ALTER TABLE audit ADD COLUMN token_id TEXT;
ALTER TABLE audit ADD COLUMN namespace TEXT;
