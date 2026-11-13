import { getSecret } from './secrets-store.ts'

/**
 * Wake target for a queue drained by an external consumer (Grok Bot on
 * `grok-bot`, fermi-mcp#12), so it reacts to an enqueue instead of polling.
 * Stored as KV `queue:hooks` = { "<queue>": QueueHook }. The auth header value
 * is the Fermi app-scope secret `secret`, sent verbatim, and only to a host in
 * that secret's allowed_hosts.
 */
export interface QueueHook {
	url: string
	auth_header: string
	secret: string
}

const KV_KEY = 'queue:hooks'
const ATTEMPT_DELAYS_MS = [0, 1_000, 3_000]
const TIMEOUT_MS = 5_000

export async function getQueueHook(env: Env, queue: string): Promise<QueueHook | null> {
	const raw = await env.FERMI_KV.get(KV_KEY)
	if (!raw) return null
	try {
		const hook = (JSON.parse(raw) as Record<string, QueueHook>)[queue]
		return hook?.url && hook.auth_header && hook.secret ? hook : null
	} catch {
		return null
	}
}

/**
 * POST `{ task_id, queue }` to the queue's hook. Best-effort: never throws,
 * bounded retries on network errors / 429 / 5xx, no-op when unconfigured.
 * Logs never include the secret value.
 */
export async function fireQueueHook(
	env: Env,
	task: { task_id: string; queue: string },
	delays: number[] = ATTEMPT_DELAYS_MS,
): Promise<void> {
	const hook = await getQueueHook(env, task.queue)
	if (!hook) return
	const secret = await getSecret(hook.secret, 'app', '', env)
	if (!secret) {
		console.warn(`queue-hook ${task.queue}: secret ${hook.secret} missing, skipped`)
		return
	}
	const host = new URL(hook.url).hostname
	if (!secret.metadata.allowed_hosts.includes(host)) {
		console.warn(`queue-hook ${task.queue}: ${host} not in ${hook.secret} allowed_hosts, skipped`)
		return
	}
	let last = ''
	for (const delay of delays) {
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
		try {
			const res = await fetch(hook.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [hook.auth_header]: secret.value },
				body: JSON.stringify(task),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			})
			if (res.ok) return
			last = `HTTP ${res.status}`
			if (res.status < 500 && res.status !== 429) break
		} catch (err) {
			last = err instanceof Error ? err.name : 'error'
		}
	}
	console.warn(`queue-hook ${task.queue}: wake for ${task.task_id} failed (${last})`)
}
