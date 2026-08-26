// ── Memory ──────────────────────────────────────────────
export type MemoryKind = 'fact' | 'preference' | 'event'

export interface Memory {
	id: number
	kind: MemoryKind
	body: string
	source_uri?: string | null
	embedding?: ArrayBuffer | null
	created_at: number
	pinned: number
	decayed_at?: number | null
}

// ── Sessions ────────────────────────────────────────────
export type SessionMode = 'chat' | 'plan' | 'execute'
export type HostType = 'claude-desktop' | 'cursor' | 'vscode' | 'web' | 'api' | 'telegram' | 'slack'

export interface Session {
	id: string
	host: string
	mode: SessionMode
	started_at: number
	ended_at?: number | null
	summary?: string | null
}

// ── Messages ────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
	id: number
	session_id: string
	role: MessageRole
	body: string
	created_at: number
}

// ── Plans ───────────────────────────────────────────────
export type PlanStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'failed'

export interface PlanStep {
	index: number
	description: string
	tool?: string
	args?: Record<string, unknown>
	status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
	output?: string
}

export interface Plan {
	id: string
	session_id: string
	steps_json: string
	approved_at?: number | null
	cursor: number
	status: PlanStatus
}

// ── Team Spawns ─────────────────────────────────────────
export interface TeamSpawn {
	id: string
	parent_session: string
	role: string
	scratchpad?: string | null
	report?: string | null
	tokens_in?: number | null
	tokens_out?: number | null
	started_at?: number | null
	ended_at?: number | null
}

// ── Skills ──────────────────────────────────────────────
export type SkillSource = 'manual' | 'promoted_from_memory' | 'hermes'

export interface Skill {
	slug: string
	name: string
	description?: string | null
	keywords: string
	allowed_tools: string
	version: number
	source: SkillSource
	origin_memory_id?: number | null
	usage_count: number
	last_used_at?: number | null
	created_at: number
	updated_at: number
	decayed_at?: number | null
}

// ── Audit ───────────────────────────────────────────────
export type AuditOutcome = 'success' | 'error' | 'denied' | 'timeout'
export type RiskLevel = 'low' | 'med' | 'high'

export interface AuditEntry {
	id: number
	ts: number
	tool: string
	args_hash?: string | null
	outcome: AuditOutcome
	risk: RiskLevel
	approved_by?: string | null
	hooks_fired?: string | null
}

// ── Hooks ───────────────────────────────────────────────
export type HookEvent =
	| 'tool:before'
	| 'tool:after'
	| 'session:start'
	| 'session:end'
	| 'plan:approve'
	| 'plan:step'
	| 'memory:write'
	| 'memory:decay'
	| 'skill:loaded'
	| 'team:spawn'
	| 'team:report'

export type HookScope = 'user' | 'project' | 'session'
export type TrustLevel = 'allow' | 'ask' | 'deny'

export interface Hook {
	id: string
	event: HookEvent
	matcher?: string | null
	scope: HookScope
	command?: string | null
	url?: string | null
	trust_level: TrustLevel
	is_async: number
	once: number
	enabled: number
	created_at?: number | null
}

// ── Tools ───────────────────────────────────────────────
export type ToolScope = 'read' | 'write' | 'network' | 'shell' | 'browser:cloud' | 'browser:local'

export interface ToolMetadata {
	name: string
	description: string
	scope: ToolScope[]
	risk: RiskLevel
	mutates: boolean
}
