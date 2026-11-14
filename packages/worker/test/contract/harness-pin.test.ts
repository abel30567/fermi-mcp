import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/channels/box-gateway.ts'
import worker from '../../src/index.ts'
import { getFleetConfig } from '../../src/lib/fleet-config.ts'
import {
	createCloudAgent,
	getCloudAgent,
	registerBox,
	updateBox,
} from '../../src/lib/fleet-store.ts'
import { harnessPinFromConfig } from '../../src/lib/harness-pin.ts'
import { bootstrapUserData } from '../../src/lib/provisioner.ts'

// hbar harness pin routes (ISSUE-89), through the real fetch entry.

const ADMIN = 'harness-admin-bearer'
const testEnv = { ...env, FERMI_BEARER_TOKEN: ADMIN } as Env
const NAME = 'hbar-linux-x64.tar.gz'
const BYTES = new Uint8Array(256 * 1024).map((_, i) => (i * 31) % 251)
const SECRET = 'harness-box-secret'

async function send(path: string, init: RequestInit = {}, e: Env = testEnv) {
	const ctx = createExecutionContext()
	const res = await worker.fetch(new Request(`http://fermi.test${path}`, init), e, ctx)
	await waitOnExecutionContext(ctx)
	return res
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const admin = bearer(ADMIN)
const json = (body: unknown, headers: Record<string, string> = admin): RequestInit => ({
	method: 'POST',
	headers: { ...headers, 'content-type': 'application/json' },
	body: JSON.stringify(body),
})
const sha = async (b: Uint8Array) =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('')
const upload = async (name: string, body: Uint8Array, sha256: string, headers = admin) =>
	send(`/admin/fleet/harness?name=${encodeURIComponent(name)}`, {
		method: 'PUT',
		headers: { ...headers, 'x-content-sha256': sha256 },
		body,
	})

let n = 0
async function seedBox() {
	n += 1
	const boxId = `box-h${n}`
	const agentId = `ca_harness${n}`
	await registerBox(env.FERMI_DB, {
		boxId,
		provider: 'aws',
		meta: { agent_id: agentId, token_hash: await sha256Hex(SECRET) },
	})
	await createCloudAgent(env.FERMI_DB, {
		id: agentId,
		queue: `agent:${agentId}`,
		prompt: 'p',
		proofContract: 'c',
		boxId,
	})
	return { boxId, agentId, token: `${boxId}.${SECRET}` }
}

beforeEach(async () => {
	await env.FERMI_KV.delete('fleet:config')
	await env.FERMI_BUCKET.delete(`harness/${NAME}`)
})

// cloud_agents rows reference boxes; drop ours so setup.ts can reset boxes.
afterEach(async () => {
	await env.FERMI_DB.batch([
		env.FERMI_DB.prepare("DELETE FROM tasks WHERE queue LIKE 'agent:ca_harness%'"),
		env.FERMI_DB.prepare("DELETE FROM cloud_agents WHERE id LIKE 'ca_harness%'"),
	])
})

describe('harness route auth (ISSUE-89)', () => {
	it('admin routes answer 401 without the bearer and to a box token', async () => {
		const { token } = await seedBox()
		const pinBody = { name: NAME, sha256: 'e'.repeat(64), version: '1' }
		for (const h of [{}, bearer('wrong'), bearer(token)]) {
			expect((await upload(NAME, BYTES, await sha(BYTES), h)).status).toBe(401)
			expect((await send('/admin/fleet/pin-harness', json(pinBody, h))).status).toBe(401)
		}
		expect((await send('/admin/fleet/config')).status).toBe(401)
		expect((await send('/admin/fleet/config', { headers: admin })).status).toBe(200)
		// With no FERMI_BEARER_TOKEN configured nothing gets in.
		const noBearer = { ...env, FERMI_BEARER_TOKEN: undefined } as unknown as Env
		expect((await send('/admin/fleet/pin-harness', json({ clear: true }), noBearer)).status).toBe(
			401,
		)
		expect(await env.FERMI_BUCKET.head(`harness/${NAME}`)).toBeNull()
	})

	it('GET /box/harness answers 401 to the admin bearer, no token and a destroyed box', async () => {
		const { boxId, token } = await seedBox()
		expect((await send('/box/harness', { headers: admin })).status).toBe(401)
		expect((await send('/box/harness')).status).toBe(401)
		expect((await send('/box/harness', { headers: bearer(token) })).status).toBe(404) // no pin
		await updateBox(env.FERMI_DB, boxId, { status: 'destroyed', destroyedAt: Date.now() })
		expect((await send('/box/harness', { headers: bearer(token) })).status).toBe(401)
	})
})

describe('harness upload, pin, download, clear (ISSUE-89)', () => {
	it('refuses a bad name and a body whose sha256 differs from the header', async () => {
		const good = await sha(BYTES)
		for (const name of ['../x.tar.gz', 'Hbar.tar.gz', 'hbar.zip', '.hbar.tar.gz', ''])
			expect((await upload(name, BYTES, good)).status).toBe(400)
		expect((await upload(NAME, BYTES, 'nothex')).status).toBe(400)
		const res = await upload(NAME, BYTES, 'f'.repeat(64))
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ ok: false, error: 'sha256_mismatch' })
		expect(await env.FERMI_BUCKET.head(`harness/${NAME}`)).toBeNull()
	})

	it('streams a 95 MB body to R2', async () => {
		const size = 95 * 1024 * 1024
		const chunk = new Uint8Array(1024 * 1024).fill(7)
		const digest = new crypto.DigestStream('SHA-256')
		const dw = digest.getWriter()
		for (let i = 0; i < 95; i++) await dw.write(chunk)
		await dw.close()
		const hash = [...new Uint8Array(await digest.digest)]
			.map((x) => x.toString(16).padStart(2, '0'))
			.join('')
		const { readable, writable } = new FixedLengthStream(size)
		const w = writable.getWriter()
		const pump = (async () => {
			for (let i = 0; i < 95; i++) await w.write(chunk)
			await w.close()
		})()
		const res = await send('/admin/fleet/harness?name=big.tar.gz', {
			method: 'PUT',
			headers: { ...admin, 'x-content-sha256': hash },
			body: readable,
			duplex: 'half',
		} as RequestInit)
		await pump
		expect(await res.json()).toEqual({ ok: true, name: 'big.tar.gz', size, sha256: hash })
		await env.FERMI_BUCKET.delete('harness/big.tar.gz')
	}, 60_000)

	it('pin refuses a missing object and a sha256 that is not the stored one', async () => {
		const good = await sha(BYTES)
		const missing = await send(
			'/admin/fleet/pin-harness',
			json({ name: NAME, sha256: good, version: '1' }),
		)
		expect(missing.status).toBe(404)
		expect((await upload(NAME, BYTES, good)).status).toBe(200)
		const wrong = await send(
			'/admin/fleet/pin-harness',
			json({ name: NAME, sha256: 'f'.repeat(64), version: '1' }),
		)
		expect(wrong.status).toBe(409)
		expect(await wrong.json()).toMatchObject({ error: 'sha256_mismatch', actual: good })
		for (const version of ['', 'a b', "1'", 'x'.repeat(41)])
			expect(
				(await send('/admin/fleet/pin-harness', json({ name: NAME, sha256: good, version })))
					.status,
			).toBe(400)
		expect((await getFleetConfig(env)).harness).toBeNull()
	})

	it('upload → pin → download returns the bytes; clear → 404 and no block in user-data', async () => {
		const { token } = await seedBox()
		const good = await sha(BYTES)
		const up = await upload(NAME, BYTES, good)
		expect(await up.json()).toEqual({ ok: true, name: NAME, size: BYTES.byteLength, sha256: good })

		const pin = { name: NAME, sha256: good, version: '2.1.0+hbar.7' }
		const pinned = await send('/admin/fleet/pin-harness', json(pin))
		expect(pinned.status).toBe(200)
		const cfg = (await (await send('/admin/fleet/config', { headers: admin })).json()) as {
			config: { harness: unknown }
		}
		expect(cfg.config.harness).toEqual(pin)

		const dl = await send('/box/harness', { headers: bearer(token) })
		expect(dl.status).toBe(200)
		expect(new Uint8Array(await dl.arrayBuffer())).toEqual(BYTES)

		const userData = async () =>
			bootstrapUserData({
				boxId: 'box-x',
				agentId: 'ca_x',
				queue: 'agent:ca_x',
				route: 'claude',
				ttlSeconds: 3600,
				mcpBaseUrl: 'https://fermi.example.com',
				boxToken: 'box-x.s',
				claudeModel: null,
				runnerPin: { ref: 'a'.repeat(40), files: { 'box-runner.mjs': '1'.repeat(64) } },
				harness: harnessPinFromConfig(await getFleetConfig(env)),
			})
		expect(await userData()).toContain('/box/harness')

		expect((await send('/admin/fleet/pin-harness', json({ clear: true }))).status).toBe(200)
		expect((await getFleetConfig(env)).harness).toBeNull()
		expect((await send('/box/harness', { headers: bearer(token) })).status).toBe(404)
		expect(await userData()).not.toContain('hbar')
	})
})

describe('fleet config and notes (ISSUE-89)', () => {
	it('GET /admin/fleet/config shows harness: null; POST refuses a harness key like runner_ref', async () => {
		const cfg = (await (await send('/admin/fleet/config', { headers: admin })).json()) as {
			config: Record<string, unknown>
		}
		expect(cfg.config).toHaveProperty('harness', null)
		for (const body of [
			{ runner_ref: 'a'.repeat(40) },
			{ harness: { name: NAME, sha256: 'e'.repeat(64), version: '1' } },
		]) {
			const res = await send('/admin/fleet/config', json(body))
			expect(res.status).toBe(400)
			expect(await res.json()).toMatchObject({ ok: false })
		}
		expect((await getFleetConfig(env)).harness).toBeNull()
	})

	it('a harness: note shows in the agent events and changes no liveness field', async () => {
		const { agentId, token } = await seedBox()
		const before = await getCloudAgent(env.FERMI_DB, agentId)
		for (const note of [
			'harness: hbar 2.1.0',
			'harness: claude (hbar 2.1.0 not installed: sha256)',
		])
			expect((await send('/box/report', json({ note }, bearer(token)))).status).toBe(200)
		const after = await getCloudAgent(env.FERMI_DB, agentId)
		expect(after?.last_working_event_at).toBe(before?.last_working_event_at)
		expect(after?.restart_count).toBe(before?.restart_count)
		expect(after?.status).toBe(before?.status)
		const status = (await (
			await send(`/admin/fleet/status?id=${agentId}`, { headers: admin })
		).json()) as { events: Array<{ note: string }> }
		expect(status.events.map((e) => e.note)).toEqual(
			expect.arrayContaining([
				'harness: hbar 2.1.0',
				'harness: claude (hbar 2.1.0 not installed: sha256)',
			]),
		)
	})
})
