-- Usage analytics: per-call telemetry on the audit log so usage_stats can
-- report call counts, durations, and estimated token consumption per tool.
ALTER TABLE audit ADD COLUMN duration_ms INTEGER;
ALTER TABLE audit ADD COLUMN result_bytes INTEGER;
ALTER TABLE audit ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS audit_tool_ts ON audit(tool, ts);
