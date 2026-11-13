declare module 'cloudflare:test' {
	interface ProvidedEnv {
		FERMI_DB: D1Database
		TEST_MIGRATIONS: D1Migration[]
		FERMI_KV: KVNamespace
		TELEGRAM_BOT_TOKEN: string
		TELEGRAM_WEBHOOK_SECRET: string
	}
}
