import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2026-04-28',
					compatibilityFlags: ['nodejs_compat'],
					d1Databases: ['FERMI_DB'],
					r2Buckets: ['FERMI_BUCKET'],
					kvNamespaces: ['FERMI_KV'],
					bindings: {
						TELEGRAM_BOT_TOKEN: 'test-bot-token',
						TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
						WA_WEBHOOK_SECRET: 'test-wa-secret',
						DISCORD_BOT_TOKEN: 'test-dc-token',
						DISCORD_BRIDGE_SECRET: 'test-dc-secret',
						SLACK_BOT_TOKEN: 'test-sl-token',
						SLACK_BRIDGE_SECRET: 'test-sl-secret',
						FERMI_SECRETS_KEY: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
						FERMI_BEARER_TOKEN: 'test-admin-bearer',
					},
				},
			},
		},
	},
})
