import { DurableObject } from 'cloudflare:workers'

interface KvRow extends Record<string, SqlStorageValue> {
	key: string
	value_json: string
	updated_at: number
}

export class SandboxStorageDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(
				'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)',
			)
		})
	}

	async get(key: string): Promise<unknown> {
		const rows = this.ctx.storage.sql.exec<KvRow>('SELECT * FROM kv WHERE key = ?', key).toArray()
		if (rows.length === 0) return null
		return JSON.parse(rows[0].value_json)
	}

	async put(key: string, value: unknown): Promise<{ ok: true; key: string }> {
		const json = JSON.stringify(value ?? null)
		this.ctx.storage.sql.exec(
			'INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
			key,
			json,
			Date.now(),
		)
		return { ok: true, key }
	}

	async list(prefix = ''): Promise<string[]> {
		const rows = this.ctx.storage.sql
			.exec<KvRow>("SELECT key FROM kv WHERE key LIKE ? || '%' ORDER BY key", prefix)
			.toArray()
		return rows.map((r) => r.key)
	}

	async delete(key: string): Promise<{ deleted: boolean }> {
		const cur = this.ctx.storage.sql.exec('DELETE FROM kv WHERE key = ?', key)
		return { deleted: cur.rowsWritten > 0 }
	}

	async sql(query: string, ...args: unknown[]): Promise<{ results: Record<string, unknown>[] }> {
		const stmt = this.ctx.storage.sql.exec(
			query,
			...(args as (string | number | ArrayBuffer | null)[]),
		)
		return { results: stmt.toArray() }
	}
}
