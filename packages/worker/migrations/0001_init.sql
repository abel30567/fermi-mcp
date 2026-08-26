CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
  source_uri TEXT, embedding BLOB, created_at INTEGER NOT NULL,
  pinned INTEGER DEFAULT 0, decayed_at INTEGER
);
CREATE INDEX IF NOT EXISTS mem_kind ON memory(kind);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, host TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'chat',
  started_at INTEGER NOT NULL, ended_at INTEGER, summary TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id),
  role TEXT, body TEXT, created_at INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body, content='messages', content_rowid='id'
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id),
  steps_json TEXT NOT NULL, approved_at INTEGER, cursor INTEGER DEFAULT 0, status TEXT
);

CREATE TABLE IF NOT EXISTS team_spawns (
  id TEXT PRIMARY KEY, parent_session TEXT REFERENCES sessions(id),
  role TEXT NOT NULL, scratchpad TEXT, report TEXT,
  tokens_in INTEGER, tokens_out INTEGER, started_at INTEGER, ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS skills (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  body_r2_key TEXT NOT NULL, allowed_tools TEXT, created_by TEXT,
  uses_count INTEGER DEFAULT 0, last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, tool TEXT NOT NULL,
  args_hash TEXT, outcome TEXT, risk TEXT, approved_by TEXT, hooks_fired TEXT
);

CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY, event TEXT NOT NULL, matcher TEXT,
  scope TEXT NOT NULL, command TEXT, url TEXT, trust_level TEXT NOT NULL,
  is_async INTEGER DEFAULT 0, once INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS hooks_event_scope ON hooks(event, scope);
