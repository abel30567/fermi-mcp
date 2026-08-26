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
				},
			},
		},
	},
})
