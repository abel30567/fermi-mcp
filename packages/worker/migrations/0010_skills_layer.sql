-- Rebuild skills as a first-class loadable layer (issue #22).
-- Bodies live in R2 at skills/{slug}/SKILL.md (body_r2_key column dropped).
-- Note: numbered 0010 because issue #20's 0010_segments_and_edges.sql never landed.
CREATE TABLE skills_new (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','promoted_from_memory','hermes')),
  origin_memory_id INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  decayed_at INTEGER
);

-- Legacy distillation rows point at skills-staging/*.md which the new loader
-- cannot resolve; decay them so they never rank in search.
INSERT INTO skills_new (slug, name, description, allowed_tools, source,
                        usage_count, last_used_at, created_at, updated_at, decayed_at)
SELECT slug,
       title,
       description,
       COALESCE(allowed_tools, '[]'),
       CASE WHEN created_by = 'agent' THEN 'hermes' ELSE 'manual' END,
       COALESCE(uses_count, 0),
       last_used_at,
       strftime('%s','now') * 1000,
       strftime('%s','now') * 1000,
       CASE WHEN body_r2_key LIKE 'skills-staging/%' THEN strftime('%s','now') * 1000 END
FROM skills;

DROP TABLE skills;
ALTER TABLE skills_new RENAME TO skills;
CREATE INDEX IF NOT EXISTS skills_decayed ON skills(decayed_at);
