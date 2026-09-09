-- Outbound message queue: the Worker never talks to WhatsApp directly.
-- channel_send / acks / pairing replies for `wa` insert here; the Mac-local
-- wa-bridge polls GET /wa/outbox, delivers via Baileys, and acks each id.
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_channel_status ON outbox(channel, status, created_at);
