-- User-schedulable jobs (OpenClaw CronService pattern): a 5-minute Cron
-- Trigger tick enqueues due schedules into the tasks queue; the Mac daemon
-- executes each prompt (a self-contained runbook) as a full agent turn.
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('at','every')),
  run_at INTEGER,
  every_minutes INTEGER,
  next_run_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules(enabled, next_run_at);
