import type { z } from 'zod'
import { type SecretScope, getSecret } from './secrets-store.ts'
import { type AgentLikeState, type RiskLevel, type ToolScope, runWithGuardrails } from './tool.ts'

export const SECRET_FIELD = Symbol.for('fermi.x-kody-secret')

/** Mark a zod schema field as accepting a `{{secret:NAME}}` placeholder that the registry resolves before invocation. */
export function secretField<T extends z.ZodTypeAny>(schema: T): T {
	;(schema as unknown as Record<symbol, boolean>)[SECRET_FIELD] = true
	return schema
}

export interface CapabilityDef<T extends Record<string, z.ZodType> = Record<string, z.ZodType>> {
	name: string
	domain: string
	description: string
	inputSchema: z.ZodObject<T>
	outputSchema?: z.ZodTypeAny
	handler: (
		args: z.infer<z.ZodObject<T>>,
		env: Env,
		ctx?: { sessionId: string },
	) => Promise<unknown>
	scope: ToolScope[]
	risk: RiskLevel
	readOnly?: boolean
	idempotent?: boolean
	destructive?: boolean
	keywords?: string[]
	tags?: string[]
}

const REGISTRY = new Map<string, CapabilityDef>()

export function defineCapability<T extends Record<string, z.ZodType>>(def: CapabilityDef<T>) {
	REGISTRY.set(def.name, def as unknown as CapabilityDef)
}

export function getCapability(name: string): CapabilityDef | undefined {
	return REGISTRY.get(name)
}

export function getCapabilityRegistry(): CapabilityDef[] {
	return Array.from(REGISTRY.values())
}

export function clearCapabilityRegistry(): void {
	REGISTRY.clear()
}

const SECRET_PLACEHOLDER = /^\{\{secret:([a-zA-Z0-9._-]+)(?:\|scope=(session|app|user))?\}\}$/

async function resolveSecretFields(
	cap: CapabilityDef,
	args: Record<string, unknown>,
	env: Env,
	sessionId: string,
): Promise<Record<string, unknown>> {
	const shape = cap.inputSchema.shape as Record<string, z.ZodTypeAny>
	const next: Record<string, unknown> = { ...args }
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const isSecret = (fieldSchema as unknown as Record<symbol, boolean>)[SECRET_FIELD] === true
		if (!isSecret) continue
		const value = next[key]
		if (typeof value !== 'string') continue
		const match = SECRET_PLACEHOLDER.exec(value)
		if (!match) continue
		const secretName = match[1]
		const scope = (match[2] as SecretScope | undefined) ?? 'app'
		const secret = await getSecret(secretName, scope, sessionId, env)
		if (!secret) {
			throw new Error(`Secret not found: ${secretName} (scope: ${scope})`)
		}
		const allowed = secret.metadata.allowed_capabilities
		if (allowed.length > 0 && !allowed.includes(cap.name)) {
			throw new Error(`Secret "${secretName}" is not allowed for capability "${cap.name}"`)
		}
		next[key] = secret.value
	}
	return next
}

export interface InvokeCapabilityResult {
	ok: boolean
	value?: unknown
	error?: { reason: string; details?: Record<string, unknown> }
}

export async function invokeCapability(
	name: string,
	args: Record<string, unknown>,
	env: Env,
	agentState?: AgentLikeState,
	approvalToken?: string,
): Promise<InvokeCapabilityResult> {
	const cap = REGISTRY.get(name)
	if (!cap) {
		return { ok: false, error: { reason: 'unknown_capability', details: { name } } }
	}

	const sessionId = agentState?.sessionId ?? ''
	let resolvedArgs: Record<string, unknown>
	try {
		resolvedArgs = await resolveSecretFields(cap, args, env, sessionId)
	} catch (err) {
		return {
			ok: false,
			error: {
				reason: 'secret_resolution_failed',
				details: { message: err instanceof Error ? err.message : String(err) },
			},
		}
	}

	const parsed = cap.inputSchema.safeParse(resolvedArgs)
	if (!parsed.success) {
		return {
			ok: false,
			error: {
				reason: 'invalid_args',
				details: { issues: parsed.error.issues },
			},
		}
	}

	const result = await runWithGuardrails({
		def: {
			name: cap.name,
			scope: cap.scope,
			risk: cap.risk,
			mutates: !cap.readOnly,
		},
		args: parsed.data as Record<string, unknown>,
		env,
		agentState,
		approvalToken,
		planModeExempt: false,
		approvalPolicy: cap.risk === 'high' ? 'require_token' : 'none',
		handler: (a) =>
			cap.handler(a as z.infer<z.ZodObject<typeof cap.inputSchema.shape>>, env, { sessionId }),
	})

	if (result.kind === 'ok') return { ok: true, value: result.value }
	if (result.kind === 'pending_approval') {
		return {
			ok: false,
			error: { reason: 'requires_approval', details: { token: result.token } },
		}
	}
	return { ok: false, error: { reason: result.reason, details: result.details } }
}
