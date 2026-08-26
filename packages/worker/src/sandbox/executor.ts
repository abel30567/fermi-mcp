import { DynamicWorkerExecutor, type ToolProvider, resolveProvider } from '@cloudflare/codemode'
import type { SandboxStorageDO } from '../do/sandbox-storage.ts'
import { type CapabilityDef, getCapabilityRegistry, invokeCapability } from '../lib/capability.ts'
import { loadAllPackagesAsModules } from '../lib/packages-store.ts'
import type { AgentLikeState } from '../lib/tool.ts'

export interface RunUserCodeInput {
	source: string
	env: Env
	agentState?: AgentLikeState
	timeoutMs?: number
	outboundFetcher?: Fetcher | null
}

export interface RunUserCodeResult {
	ok: boolean
	result?: unknown
	error?: string
	logs?: string[]
}

function buildStorageProvider(
	env: Env,
	agentState: AgentLikeState | undefined,
): ToolProvider | null {
	if (!env.SANDBOX_STORAGE) return null
	const sessionId = agentState?.sessionId?.trim() || 'default'
	const id = env.SANDBOX_STORAGE.idFromName(sessionId)
	const stub = env.SANDBOX_STORAGE.get(id) as unknown as DurableObjectStub<SandboxStorageDO>
	return {
		name: 'storage',
		positionalArgs: true,
		tools: {
			// biome-ignore lint/suspicious/noExplicitAny: positional bridge to DO RPC
			get: { description: 'storage.get(key)', execute: ((...a: any[]) => stub.get(a[0])) as any },
			put: {
				description: 'storage.put(key, value)',
				// biome-ignore lint/suspicious/noExplicitAny: positional bridge to DO RPC
				execute: ((...a: any[]) => stub.put(a[0], a[1])) as any,
			},
			list: {
				description: 'storage.list(prefix?)',
				// biome-ignore lint/suspicious/noExplicitAny: positional bridge to DO RPC
				execute: ((...a: any[]) => stub.list(a[0] ?? '')) as any,
			},
			delete: {
				description: 'storage.delete(key)',
				// biome-ignore lint/suspicious/noExplicitAny: positional bridge to DO RPC
				execute: ((...a: any[]) => stub.delete(a[0])) as any,
			},
			sql: {
				description: 'storage.sql(query, ...args)',
				// biome-ignore lint/suspicious/noExplicitAny: positional bridge to DO RPC
				execute: ((...a: any[]) => stub.sql(a[0], ...a.slice(1))) as any,
			},
		},
	}
}

function buildProvider(env: Env, agentState: AgentLikeState | undefined): ToolProvider {
	const tools: Record<
		string,
		{ description: string; execute: (args: unknown) => Promise<unknown> }
	> = {}
	for (const cap of getCapabilityRegistry() as CapabilityDef[]) {
		tools[cap.name] = {
			description: cap.description,
			execute: async (args: unknown) => {
				const res = await invokeCapability(
					cap.name,
					(args ?? {}) as Record<string, unknown>,
					env,
					agentState,
				)
				if (!res.ok) {
					const reason = res.error?.reason ?? 'unknown_error'
					const details = res.error?.details ? ` ${JSON.stringify(res.error.details)}` : ''
					throw new Error(`${cap.name} ${reason}:${details}`)
				}
				return res.value
			},
		}
	}
	return { name: 'codemode', tools }
}

export async function runUserCode(input: RunUserCodeInput): Promise<RunUserCodeResult> {
	const { source, env, agentState, timeoutMs = 120_000, outboundFetcher = null } = input
	if (!env.LOADER) {
		return {
			ok: false,
			error:
				'LOADER binding not configured (worker_loaders closed-beta access required on this account)',
		}
	}

	const capProvider = resolveProvider(buildProvider(env, agentState))
	const storageProvider = buildStorageProvider(env, agentState)
	const providers = [capProvider]
	if (storageProvider) providers.push(resolveProvider(storageProvider))

	const modules = await loadAllPackagesAsModules(env).catch(() => ({}) as Record<string, string>)

	const executor = new DynamicWorkerExecutor({
		loader: env.LOADER,
		timeout: timeoutMs,
		globalOutbound: outboundFetcher,
		modules,
	})

	const exe = await executor.execute(source, providers)
	if (exe.error) {
		return { ok: false, error: exe.error, logs: exe.logs, result: exe.result }
	}
	return { ok: true, result: exe.result, logs: exe.logs }
}
