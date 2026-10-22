import { applyD1Migrations, env } from 'cloudflare:test'

// The schema comes only from migrations/*.sql (read in vitest.config.ts).
// Idempotent: applied migrations are recorded in d1_migrations.
export async function applyMigrations() {
	await applyD1Migrations(env.FERMI_DB, env.TEST_MIGRATIONS)
}

export const setupMemorySchema = applyMigrations
export const setupSkillsSchema = applyMigrations
export const setupSessionsSchema = applyMigrations
export const setupProfileSchema = applyMigrations
export const setupSchedulesSchema = applyMigrations
export const setupTasksSchema = applyMigrations
export const setupSecretsSchema = applyMigrations
export const setupFleetSchema = applyMigrations
export const setupWebSessionSchema = applyMigrations
export const setupAllowlistSchema = applyMigrations
export const setupOutboxSchema = applyMigrations
export const setupAuditSchema = applyMigrations

export async function clearMemory() {
	await env.FERMI_DB.prepare('DELETE FROM memory').run()
}

export async function clearSkills() {
	await env.FERMI_DB.prepare('DELETE FROM skills').run()
}

export async function clearSessions() {
	await env.FERMI_DB.prepare('DELETE FROM messages').run()
	await env.FERMI_DB.prepare('DELETE FROM sessions').run()
}

export async function clearProfile() {
	await env.FERMI_DB.prepare('DELETE FROM profile_docs').run()
}

export async function clearSchedules() {
	await env.FERMI_DB.prepare('DELETE FROM schedules').run()
}

export async function clearSecrets() {
	await env.FERMI_DB.prepare('DELETE FROM secrets').run()
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

export async function clearAllowlist() {
	await env.FERMI_DB.prepare('DELETE FROM allowlist').run()
}

export async function clearOutbox() {
	await env.FERMI_DB.prepare('DELETE FROM outbox').run()
}

export async function clearAudit() {
	await env.FERMI_DB.prepare('DELETE FROM audit').run()
}
