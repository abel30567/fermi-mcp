import { env } from 'cloudflare:test'

const MEMORY_SCHEMA = `CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
  source_uri TEXT, embedding BLOB, created_at INTEGER NOT NULL,
  pinned INTEGER DEFAULT 0, decayed_at INTEGER
)`

export async function setupMemorySchema() {
	await env.FERMI_DB.prepare(MEMORY_SCHEMA).run()
}

export async function clearMemory() {
	await env.FERMI_DB.prepare('DELETE FROM memory').run()
}

// Mirrors migrations/0010_skills_layer.sql
const SKILLS_SCHEMA = `CREATE TABLE IF NOT EXISTS skills (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  keywords TEXT NOT NULL DEFAULT '[]', allowed_tools TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','promoted_from_memory','hermes')),
  origin_memory_id INTEGER, usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  decayed_at INTEGER
)`

const HOOKS_SCHEMA = `CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY, event TEXT NOT NULL, matcher TEXT, scope TEXT NOT NULL,
  command TEXT, url TEXT, trust_level TEXT NOT NULL, is_async INTEGER DEFAULT 0,
  once INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, created_at INTEGER
)`

export async function setupSkillsSchema() {
	await env.FERMI_DB.prepare(SKILLS_SCHEMA).run()
	await env.FERMI_DB.prepare(HOOKS_SCHEMA).run()
}

export async function clearSkills() {
	await env.FERMI_DB.prepare('DELETE FROM skills').run()
}

// Mirrors migrations/0001_init.sql sessions/messages + 0003 FTS triggers
const SESSIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, host TEXT NOT NULL, mode TEXT DEFAULT 'chat',
  started_at INTEGER, ended_at INTEGER, summary TEXT
)`

const MESSAGES_SCHEMA = `CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id),
  role TEXT, body TEXT, created_at INTEGER
)`

export async function setupSessionsSchema() {
	await env.FERMI_DB.prepare(SESSIONS_SCHEMA).run()
	await env.FERMI_DB.prepare(MESSAGES_SCHEMA).run()
}

export async function clearSessions() {
	await env.FERMI_DB.prepare('DELETE FROM messages').run()
	await env.FERMI_DB.prepare('DELETE FROM sessions').run()
}

// Mirrors migrations/0013_profile_docs.sql
const PROFILE_SCHEMA = `CREATE TABLE IF NOT EXISTS profile_docs (
  name TEXT PRIMARY KEY CHECK (name IN ('agent','user')),
  body TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
)`

export async function setupProfileSchema() {
	await env.FERMI_DB.prepare(PROFILE_SCHEMA).run()
}

export async function clearProfile() {
	await env.FERMI_DB.prepare('DELETE FROM profile_docs').run()
}

// Mirrors migrations/0014_schedules.sql
const SCHEDULES_SCHEMA = `CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, chat_id TEXT NOT NULL,
  prompt TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('at','every')),
  run_at INTEGER, every_minutes INTEGER, next_run_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  last_run_at INTEGER, last_status TEXT
)`

export async function setupSchedulesSchema() {
	await env.FERMI_DB.prepare(SCHEDULES_SCHEMA).run()
	await env.FERMI_DB.prepare(
		'CREATE INDEX IF NOT EXISTS schedules_due ON schedules(enabled, next_run_at)',
	).run()
}

export async function clearSchedules() {
	await env.FERMI_DB.prepare('DELETE FROM schedules').run()
}

// Mirrors migrations/0012_task_queue.sql
const TASKS_SCHEMA = `CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, sender TEXT NOT NULL,
  chat_id TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','done','failed')),
  result TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER, completed_at INTEGER,
  queue TEXT NOT NULL DEFAULT 'main', claimed_by TEXT,
  lease_expires_at INTEGER, parent_task_id TEXT
)`

export async function setupTasksSchema() {
	await env.FERMI_DB.prepare(TASKS_SCHEMA).run()
	await env.FERMI_DB.prepare(
		'CREATE INDEX IF NOT EXISTS tasks_status_created ON tasks(status, created_at)',
	).run()
	await env.FERMI_DB.prepare(
		'CREATE INDEX IF NOT EXISTS tasks_queue_status_created ON tasks(queue, status, created_at)',
	).run()
}

// Mirrors migrations/0017_cloud_fleet.sql (boxes + cloud_agents)
const BOXES_SCHEMA = `CREATE TABLE IF NOT EXISTS boxes (
  box_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'aws'
    CHECK (provider IN ('aws','cloudflare','private')),
  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','online','offline','destroyed')),
  instance_ref TEXT, mcp_url TEXT, oauth_client_id TEXT, region TEXT,
  snapshot_ref TEXT, last_heartbeat_at INTEGER,
  created_at INTEGER NOT NULL, destroyed_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}'
)`

const CLOUD_AGENTS_SCHEMA = `CREATE TABLE IF NOT EXISTS cloud_agents (
  id TEXT PRIMARY KEY, box_id TEXT REFERENCES boxes(box_id), task_id TEXT,
  queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'launching'
    CHECK (status IN ('launching','running','waiting_human','done','failed','destroyed')),
  route TEXT NOT NULL DEFAULT 'claude'
    CHECK (route IN ('claude','codex','grok')),
  prompt TEXT NOT NULL, proof_contract TEXT NOT NULL,
  budget_usd REAL, ttl_seconds INTEGER, cost_usd REAL NOT NULL DEFAULT 0, inference_usd REAL NOT NULL DEFAULT 0,
  exit_reason TEXT, artifacts_prefix TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
)`

// Mirrors migrations/0004_secrets.sql
const SECRETS_SCHEMA = `CREATE TABLE IF NOT EXISTS secrets (
  name TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('user','app','session')),
  session_id TEXT NOT NULL DEFAULT '',
  encrypted_value BLOB NOT NULL, iv BLOB NOT NULL,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  allowed_capabilities TEXT NOT NULL DEFAULT '[]',
  allowed_packages TEXT NOT NULL DEFAULT '[]',
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, scope, session_id)
)`

export async function setupSecretsSchema() {
	await env.FERMI_DB.prepare(SECRETS_SCHEMA).run()
}

export async function clearSecrets() {
	await env.FERMI_DB.prepare('DELETE FROM secrets').run()
}

export async function setupFleetSchema() {
	await env.FERMI_DB.prepare(BOXES_SCHEMA).run()
	await env.FERMI_DB.prepare(CLOUD_AGENTS_SCHEMA).run()
}

// Mirrors migrations/0018_web_sessions.sql
const WEB_SESSIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS web_sessions (
  name TEXT PRIMARY KEY, site TEXT NOT NULL,
  encrypted_state BLOB NOT NULL, iv BLOB NOT NULL,
  max_concurrent INTEGER NOT NULL DEFAULT 1, allowed_boxes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  expires_at INTEGER, revoked_at INTEGER
)`
const WEB_LEASES_SCHEMA = `CREATE TABLE IF NOT EXISTS web_session_leases (
  id TEXT PRIMARY KEY, session_name TEXT NOT NULL, box_id TEXT NOT NULL,
  leased_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, released_at INTEGER
)`

export async function setupWebSessionSchema() {
	await env.FERMI_DB.prepare(WEB_SESSIONS_SCHEMA).run()
	await env.FERMI_DB.prepare(WEB_LEASES_SCHEMA).run()
	await env.FERMI_DB.prepare(
		'CREATE UNIQUE INDEX IF NOT EXISTS leases_one_active_per_box ON web_session_leases(session_name, box_id) WHERE released_at IS NULL',
	).run()
}

export async function clearWebSessions() {
	await env.FERMI_DB.prepare('DELETE FROM web_sessions').run()
	await env.FERMI_DB.prepare('DELETE FROM web_session_leases').run()
}

export async function clearFleet() {
	await env.FERMI_DB.prepare('DELETE FROM cloud_agents').run()
	await env.FERMI_DB.prepare('DELETE FROM boxes').run()
}

export async function clearTasks() {
	await env.FERMI_DB.prepare('DELETE FROM tasks').run()
}

// Mirrors migrations/0016_allowlist.sql (table + tasks index; no seed rows)
const ALLOWLIST_SCHEMA = `CREATE TABLE IF NOT EXISTS allowlist (
  channel TEXT NOT NULL, sender_id TEXT NOT NULL, note TEXT,
  added_at INTEGER NOT NULL, added_by TEXT,
  PRIMARY KEY (channel, sender_id)
)`

export async function setupAllowlistSchema() {
	await env.FERMI_DB.prepare(ALLOWLIST_SCHEMA).run()
	await env.FERMI_DB.prepare(
		'CREATE INDEX IF NOT EXISTS tasks_channel_sender ON tasks(channel, sender)',
	).run()
}

export async function clearAllowlist() {
	await env.FERMI_DB.prepare('DELETE FROM allowlist').run()
}

// Mirrors migrations/0015_outbox.sql
const OUTBOX_SCHEMA = `CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  created_at INTEGER NOT NULL, sent_at INTEGER
)`

export async function setupOutboxSchema() {
	await env.FERMI_DB.prepare(OUTBOX_SCHEMA).run()
	await env.FERMI_DB.prepare(
		'CREATE INDEX IF NOT EXISTS outbox_channel_status ON outbox(channel, status, created_at)',
	).run()
}

export async function clearOutbox() {
	await env.FERMI_DB.prepare('DELETE FROM outbox').run()
}

// Mirrors migrations/0001_init.sql audit table + 0011_usage_analytics.sql columns
const AUDIT_SCHEMA = `CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, tool TEXT NOT NULL,
  args_hash TEXT, outcome TEXT, risk TEXT, approved_by TEXT, hooks_fired TEXT,
  duration_ms INTEGER, result_bytes INTEGER, session_id TEXT
)`

export async function setupAuditSchema() {
	await env.FERMI_DB.prepare(AUDIT_SCHEMA).run()
}

export async function clearAudit() {
	await env.FERMI_DB.prepare('DELETE FROM audit').run()
}
