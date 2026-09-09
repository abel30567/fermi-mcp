-- One active lease per (session, box): makes the concurrency cap enforceable in
-- a single statement and prevents duplicate active leases under replica lag.
CREATE UNIQUE INDEX IF NOT EXISTS leases_one_active_per_box
  ON web_session_leases(session_name, box_id) WHERE released_at IS NULL;
