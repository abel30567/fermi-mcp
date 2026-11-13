import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deployedVersion, smoke } from './smoke-deploy.mjs'

const VERSION = '11111111-2222-4333-8444-555555555555'
const HOST = 'fermi.example.workers.dev'
const LOG = `Uploaded fermi-test (3.10 sec)
Deployed fermi-test triggers (1.20 sec)
  https://${HOST}
  schedule: */5 * * * *
Current Version ID: ${VERSION}`

// Fake worker: /health serves `versions` in turn (the last one sticks).
function fakeWorker({ versions = [VERSION], mcpStatus = 401, authorizeHost = HOST } = {}) {
	const calls = []
	const fetch = async (url) => {
		const { pathname, host } = new URL(url)
		calls.push(pathname)
		assert.equal(host, HOST)
		if (pathname === '/health') {
			const version = versions.length > 1 ? versions.shift() : versions[0]
			return Response.json({ status: 'ok', name: 'fermi', version })
		}
		if (pathname === '/mcp') return new Response('unauthorized', { status: mcpStatus })
		if (pathname === '/.well-known/oauth-authorization-server') {
			return Response.json({ authorization_endpoint: `https://${authorizeHost}/oauth/authorize` })
		}
		return new Response('not found', { status: 404 })
	}
	return { fetch, calls }
}

const run = (worker, overrides = {}) =>
	smoke({
		publicUrl: `https://${HOST}`,
		log: LOG,
		fetch: worker.fetch,
		intervalMs: 1,
		...overrides,
	})

describe('smoke-deploy', () => {
	it('reads the version id from the deploy output', () => {
		assert.equal(deployedVersion(LOG), VERSION)
		assert.equal(deployedVersion('Deployed'), null)
	})

	it('passes once /health reports the new version', async () => {
		const worker = fakeWorker({ versions: [null, 'old-version', VERSION] })
		assert.equal(await run(worker), VERSION)
		assert.deepEqual(worker.calls, [
			'/health',
			'/health',
			'/health',
			'/mcp',
			'/.well-known/oauth-authorization-server',
		])
	})

	it('fails when the new version never shows up in time', async () => {
		await assert.rejects(
			run(fakeWorker({ versions: ['old-version'] }), { timeoutMs: 20 }),
			/old-version != /,
		)
	})

	it('fails when /mcp is reachable without a token', async () => {
		await assert.rejects(run(fakeWorker({ mcpStatus: 200 })), /returned 200, want 401/)
	})

	it('fails when the OAuth endpoint is on another host', async () => {
		await assert.rejects(run(fakeWorker({ authorizeHost: 'other.example.com' })), /OAuth/)
	})

	it('fails when FERMI_PUBLIC_URL is not a host of this deployment', async () => {
		await assert.rejects(
			run(fakeWorker(), { publicUrl: 'https://elsewhere.example.com' }),
			/not a target/,
		)
	})

	it('fails when the output has no version id', async () => {
		await assert.rejects(run(fakeWorker(), { log: 'Deployed' }), /Current Version ID/)
	})
})
