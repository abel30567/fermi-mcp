import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pinRunner } from '../src/lib/fleet-config.ts'
import type { CloudAgentRow } from '../src/lib/fleet-store.ts'
import { bootstrapUserData, dispatchProvision } from '../src/lib/provisioner.ts'
import { runnerFetchScript, runnerPinFromConfig, runnerUrl } from '../src/lib/runner-pin.ts'
import { setupFleetSchema } from './setup-d1.ts'

const PIN = { ref: 'a'.repeat(40), files: { 'box-runner.mjs': 'b'.repeat(64) } }
const SHA = PIN.files['box-runner.mjs']

function userData(overrides: Partial<Parameters<typeof bootstrapUserData>[0]> = {}) {
	return bootstrapUserData({
		boxId: 'box-test',
		agentId: 'ca_test',
		queue: 'default',
		route: 'claude',
		ttlSeconds: 3600,
		mcpBaseUrl: 'https://fermi.example.com',
		boxToken: 'box-test.supersecret',
		claudeModel: null,
		runnerPin: PIN,
		...overrides,
	})
}

describe('runner boot pin (#34)', () => {
	beforeAll(setupFleetSchema)

	it('fetch script pins the ref and verifies sha256 with no fallback', () => {
		const script = runnerFetchScript(PIN)
		expect(script).toContain(runnerUrl(PIN.ref))
		expect(script).toContain(SHA)
		expect(script).not.toContain('/main/') // no floating branch
		expect(script).not.toContain('|| true') // fail closed, no baked-copy fallback
	})

	it('user-data verifies the runner BEFORE materializing the box token', () => {
		const script = userData()
		const verifyAt = script.indexOf(SHA)
		const tokenAt = script.indexOf('FERMI_BOX_TOKEN=')
		expect(verifyAt).toBeGreaterThan(-1)
		expect(tokenAt).toBeGreaterThan(-1)
		expect(verifyAt).toBeLessThan(tokenAt)
	})

	it('user-data has no unpinned curl of main', () => {
		expect(userData()).not.toContain('fermi-daemon/main/')
	})

	it('dispatchProvision refuses launch when the runner pin is unset', async () => {
		await env.FERMI_KV.put(
			'fleet:config',
			JSON.stringify({ default_env: 'test-env', runner_ref: null, runner_sha256: null }),
		)
		const agent: CloudAgentRow = {
			id: 'ca_pinless',
			status: 'launching',
			route: 'claude',
			queue: 'default',
			prompt: 'x',
			proof_contract: 'y',
			box_id: null,
			ttl_seconds: 3600,
			budget_usd: null,
			cost_usd: 0,
			created_at: Date.now(),
			started_at: null,
			ended_at: null,
			exit_reason: null,
			meta: '{}',
		} as unknown as CloudAgentRow
		const out = await dispatchProvision(env, agent)
		expect(out.dispatched).toBe(false)
		expect(out.reason).toBe('runner_pin_unset')
	})
})

describe('runner pin manifest (MCP-22)', () => {
	const REF = 'c'.repeat(40)
	const MANIFEST = {
		'box-runner.mjs': '1'.repeat(64),
		'harness/claude.mjs': '2'.repeat(64),
		'lib/report.mjs': '3'.repeat(64),
	}

	it('fetches and verifies every manifest file before installing any', () => {
		const lines = runnerFetchScript({ ref: REF, files: MANIFEST }).split('\n')
		const lastVerify = Math.max(...lines.map((l, i) => (l.includes('sha256sum -c') ? i : -1)))
		const firstMove = lines.findIndex((l) => l.startsWith('mv '))
		for (const [path, sha] of Object.entries(MANIFEST)) {
			expect(lines).toContain(
				`curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors '${runnerUrl(REF, path)}' -o '/opt/fermi/${path}.new'`,
			)
			expect(lines).toContain(`echo '${sha}  /opt/fermi/${path}.new' | sha256sum -c - >/dev/null`)
			expect(lines).toContain(`mv '/opt/fermi/${path}.new' '/opt/fermi/${path}'`)
		}
		expect(lines).toContain("mkdir -p '/opt/fermi/harness'")
		expect(lastVerify).toBeLessThan(firstMove)
	})

	it('refuses to render a manifest without box-runner.mjs or with an unsafe path', () => {
		expect(() => runnerFetchScript({ ref: REF, files: { 'lib/x.mjs': '1'.repeat(64) } })).toThrow()
		for (const path of ['../etc/passwd', '/abs.mjs', "a'b.mjs", 'a/../b.mjs'])
			expect(() =>
				runnerFetchScript({ ref: REF, files: { ...MANIFEST, [path]: '1'.repeat(64) } }),
			).toThrow()
	})

	it('reads a manifest pin, a legacy single-file pin, and fails closed on a bad manifest', () => {
		const base = { runner_ref: REF, runner_sha256: '9'.repeat(64) }
		expect(runnerPinFromConfig({ ...base, runner_files: MANIFEST })).toEqual({
			ref: REF,
			files: MANIFEST,
		})
		expect(runnerPinFromConfig(base)).toEqual({
			ref: REF,
			files: { 'box-runner.mjs': '9'.repeat(64) },
		})
		expect(runnerPinFromConfig({ ...base, runner_files: { 'x.mjs': '1'.repeat(64) } })).toBeNull()
		expect(runnerPinFromConfig({ ...base, runner_ref: null })).toBeNull()
	})

	it('a legacy single-file config still renders the same box-runner fetch', () => {
		const pin = runnerPinFromConfig({ runner_ref: REF, runner_sha256: '9'.repeat(64) })
		expect(pin).not.toBeNull()
		const script = userData({ runnerPin: pin as NonNullable<typeof pin> })
		expect(script).toContain(runnerUrl(REF))
		expect(script).toContain(
			`echo '${'9'.repeat(64)}  /opt/fermi/box-runner.mjs.new' | sha256sum -c`,
		)
	})
})

describe('POST /admin/fleet/pin-runner (MCP-22)', () => {
	const REF = 'd'.repeat(40)
	const GH = 'https://raw.githubusercontent.com'
	const body = (path: string) => `// ${path}\n`
	const sha = async (text: string) =>
		[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
			.map((x) => x.toString(16).padStart(2, '0'))
			.join('')
	const serve = (path: string, status = 200) =>
		fetchMock
			.get(GH)
			.intercept({ path: `/abel30567/fermi-daemon/${REF}/${path}` })
			.reply(status, status === 200 ? body(path) : 'nope')
	const stored = async () => JSON.parse((await env.FERMI_KV.get('fleet:config')) ?? '{}')

	beforeEach(async () => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
		await env.FERMI_KV.put('fleet:config', JSON.stringify({ max_concurrent: 7 }))
	})
	afterEach(() => {
		fetchMock.assertNoPendingInterceptors()
		fetchMock.deactivate()
	})

	it('legacy {ref} pins box-runner.mjs at its fetched hash', async () => {
		serve('box-runner.mjs')
		const hash = await sha(body('box-runner.mjs'))
		const out = await pinRunner(env, { ref: REF })
		expect(out).toMatchObject({ status: 200, body: { ok: true, ref: REF, sha256: hash } })
		expect(await stored()).toEqual({
			max_concurrent: 7,
			runner_ref: REF,
			runner_sha256: hash,
			runner_files: { 'box-runner.mjs': hash },
		})
	})

	it('pins a manifest when every declared hash matches the file at that ref', async () => {
		const files: Record<string, string> = {}
		for (const p of ['box-runner.mjs', 'harness/claude.mjs']) {
			serve(p)
			files[p] = await sha(body(p))
		}
		const out = await pinRunner(env, { ref: REF, files })
		expect(out).toMatchObject({ status: 200, body: { ok: true, files } })
		expect(await stored()).toMatchObject({
			runner_ref: REF,
			runner_sha256: files['box-runner.mjs'],
			runner_files: files,
		})
	})

	it('refuses a manifest whose declared hash does not match, storing nothing', async () => {
		serve('box-runner.mjs')
		serve('lib/report.mjs')
		const files = {
			'box-runner.mjs': await sha(body('box-runner.mjs')),
			'lib/report.mjs': '0'.repeat(64),
		}
		const out = await pinRunner(env, { ref: REF, files })
		expect(out).toMatchObject({
			status: 409,
			body: { ok: false, error: 'sha256_mismatch', path: 'lib/report.mjs' },
		})
		expect(await stored()).toEqual({ max_concurrent: 7 })
	})

	it('refuses a manifest naming a file missing at that ref', async () => {
		serve('box-runner.mjs')
		serve('lib/gone.mjs', 404)
		const files = {
			'box-runner.mjs': await sha(body('box-runner.mjs')),
			'lib/gone.mjs': '0'.repeat(64),
		}
		expect(await pinRunner(env, { ref: REF, files })).toMatchObject({
			status: 502,
			body: { ok: false, error: 'fetch_404', path: 'lib/gone.mjs' },
		})
		expect(await stored()).toEqual({ max_concurrent: 7 })
	})

	it('rejects bad refs and malformed manifests without fetching', async () => {
		expect((await pinRunner(env, { ref: 'main' })).status).toBe(400)
		expect((await pinRunner(env, { ref: REF, files: ['box-runner.mjs'] })).status).toBe(400)
		expect(
			(await pinRunner(env, { ref: REF, files: { 'lib/x.mjs': '1'.repeat(64) } })).status,
		).toBe(400)
		expect((await pinRunner(env, { ref: REF, files: { 'box-runner.mjs': 'short' } })).status).toBe(
			400,
		)
		expect(await stored()).toEqual({ max_concurrent: 7 })
	})
})
