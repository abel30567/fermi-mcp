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
