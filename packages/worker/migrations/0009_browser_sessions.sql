CREATE TABLE IF NOT EXISTS browser_sessions (
  id            TEXT    PRIMARY KEY,
  label         TEXT,
  live_view_url TEXT,
  status        TEXT    NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active', 'waiting_for_human', 'closed')),
  created_at    INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  closed_at     INTEGER
);
