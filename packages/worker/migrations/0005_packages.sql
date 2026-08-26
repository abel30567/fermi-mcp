CREATE TABLE IF NOT EXISTS packages (
  slug TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.0.0',
  description TEXT,
  allowed_imports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
