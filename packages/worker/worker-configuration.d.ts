import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

declare global {
	interface Env {
		FERMI_DB: D1Database
		FERMI_BUCKET: R2Bucket
		FERMI_KV: KVNamespace
		OAUTH_KV: KVNamespace
		OAUTH_PROVIDER: OAuthHelpers
		AI: Ai
		FERMI_VECTORIZE?: VectorizeIndex
		MCP_OBJECT: DurableObjectNamespace
		CANVAS_DO: DurableObjectNamespace
		SANDBOX_STORAGE: DurableObjectNamespace
		BROWSER_SESSION: DurableObjectNamespace
		MYBROWSER?: Fetcher
		LOADER?: WorkerLoader
		GATEWAY?: Fetcher
		FERMI_ENV: string
		FERMI_BEARER_TOKEN?: string
		FERMI_SECRETS_KEY: string
		FERMI_OWNER_SECRET?: string
		FERMI_AUTH_ENABLED?: string
		CF_ACCOUNT_ID?: string
		CF_BROWSER_API_TOKEN?: string
		ANTHROPIC_API_KEY?: string
		TELEGRAM_BOT_TOKEN?: string
		SLACK_BOT_TOKEN?: string
		SLACK_SIGNING_SECRET?: string
		MACOS_MCP_URL?: string
		MACOS_MCP_TOKEN?: string
	}
}
