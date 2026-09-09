-- Inference spend is covered by the OAuth subscriptions and does NOT count
-- against the AWS budget (cost_usd = EC2 wall-clock only). Track the reported
-- harness inference figure separately as telemetry.
ALTER TABLE cloud_agents ADD COLUMN inference_usd REAL NOT NULL DEFAULT 0;
