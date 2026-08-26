-- Seed: sample memory entries
INSERT OR IGNORE INTO memory (id, kind, body, created_at, pinned)
VALUES
  (1, 'fact', 'Fermi is a personal MCP agent with cross-host memory.', strftime('%s', 'now') * 1000, 1),
  (2, 'preference', 'User prefers tab indentation and single quotes.', strftime('%s', 'now') * 1000, 0);

-- Seed: sample session
INSERT OR IGNORE INTO sessions (id, host, mode, started_at)
VALUES ('seed-session-001', 'claude-desktop', 'chat', strftime('%s', 'now') * 1000);

-- Seed: sample message
INSERT OR IGNORE INTO messages (id, session_id, role, body, created_at)
VALUES (1, 'seed-session-001', 'user', 'Hello Fermi!', strftime('%s', 'now') * 1000);

-- Seed: sample skill
INSERT OR IGNORE INTO skills (slug, title, description, body_r2_key, created_by)
VALUES ('hello-world', 'Hello World', 'A simple greeting skill', 'skills/hello-world.md', 'system');
