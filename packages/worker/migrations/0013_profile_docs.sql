-- Bounded curated profile docs (Hermes MEMORY.md/USER.md analog):
-- 'agent' = environment facts, conventions, lessons; 'user' = identity,
-- preferences, communication style. Hard char budgets enforced in code.
CREATE TABLE IF NOT EXISTS profile_docs (
  name TEXT PRIMARY KEY CHECK (name IN ('agent','user')),
  body TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
