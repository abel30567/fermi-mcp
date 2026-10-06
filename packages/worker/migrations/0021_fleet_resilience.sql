-- Fleet restart resilience (fermi #42/#43): per-agent instance sizing and
-- liveness fields so a runner that restarts mid-task (t3.small OOM) is
-- detected and surfaced instead of idling until TTL.
ALTER TABLE cloud_agents ADD COLUMN instance_type TEXT;
ALTER TABLE cloud_agents ADD COLUMN last_working_event_at INTEGER;
ALTER TABLE cloud_agents ADD COLUMN restart_count INTEGER NOT NULL DEFAULT 0;
