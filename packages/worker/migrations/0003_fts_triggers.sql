-- Sync triggers for FTS5 external content table
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
