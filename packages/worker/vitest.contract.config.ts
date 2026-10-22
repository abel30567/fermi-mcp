import path from 'node:path'
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'
import type { PluginBuild } from 'esbuild'

// The workerd bundled with vitest-pool-workers predates cloudflare:email, which
// `agents` imports at load time; no contract test sends email.
const cloudflareEmailStub = {
	name: 'cloudflare-email-stub',
	setup(build: PluginBuild) {
		build.onResolve({ filter: /^cloudflare:email$/ }, () => ({
			path: path.join(__dirname, 'test/contract/cloudflare-email-stub.ts'),
		}))
	},
}

// Contract project: runs the real worker entry (src/index.ts) so tests speak MCP
// to it over SELF.fetch, exactly as a client would.
export default defineWorkersConfig(async () => ({
	test: {
		include: ['test/contract/**/*.test.ts'],
		setupFiles: ['./test/contract/setup.ts'],
		// workers-oauth-provider console.warn()s at import time; vitest's console
		// capture would then set a timer in global scope, which workerd forbids.
		disableConsoleIntercept: true,
		// ajv (via the MCP SDK) require()s JSON files the workers module loader
		// cannot load; pre-bundling the MCP entry points inlines them.
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ['agents/mcp', '@modelcontextprotocol/sdk/server/mcp.js'],
					esbuildOptions: { plugins: [cloudflareEmailStub] },
				},
			},
		},
		poolOptions: {
			workers: {
				main: './src/index.ts',
				singleWorker: true,
				// McpAgent Durable Objects keep state across requests within a test;
				// isolated storage cannot track them, so setup.ts resets D1 instead.
				isolatedStorage: false,
				wrangler: { configPath: './wrangler.test.jsonc' },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, 'migrations')),
					},
				},
			},
		},
	},
}))
