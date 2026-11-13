-- 0002_seed.sql inserted a message before 0003 created the FTS sync triggers, so that row was
-- never indexed and deleting it made the messages_ad trigger fail with SQLITE_CORRUPT.
-- Rebuild the external-content index from the messages table.
INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
