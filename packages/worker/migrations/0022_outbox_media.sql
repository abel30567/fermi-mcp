-- Optional outbound attachment (JSON: { kind, path?, url?, mimetype?, caption?, file_name? }).
-- NULL for plain text rows; the bridges send the attachment when present.
ALTER TABLE outbox ADD COLUMN media TEXT;
