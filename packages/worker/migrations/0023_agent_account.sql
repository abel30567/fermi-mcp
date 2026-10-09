-- Alternate Claude subscription accounts for the claude route: an agent with
-- account 'kayo' boots on secret CLAUDE_CODE_OAUTH_TOKEN_KAYO instead of the
-- default CLAUDE_CODE_OAUTH_TOKEN. NULL = default account.
ALTER TABLE cloud_agents ADD COLUMN account TEXT;
