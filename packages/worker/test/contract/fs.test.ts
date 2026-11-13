import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { describeTool } from './describe-tool.ts'
import { resultJson } from './mcp-client.ts'
import { expectSchemaRejection, session } from './tool-call.ts'

// R2 is shared across files and not reset: every test writes under its own prefix.
const prefix = () => `contract-fs/${crypto.randomUUID()}/`
const SCOPE_KEY = 'permission:fs.write:scope'

describeTool('fs_write', () => {
	it('writes the object to R2', async () => {
		const path = `${prefix()}notes.txt`
		const client = await session()
		expect(resultJson(await client.callTool('fs_write', { path, body: 'héllo' }))).toEqual({
			path,
			size: 6,
			written: true,
		})
		expect(await (await env.FERMI_BUCKET.get(path))?.text()).toBe('héllo')
	})

	it('denies a path outside the configured scope and writes nothing', async () => {
		const path = `${prefix()}outside.txt`
		await env.FERMI_KV.put(SCOPE_KEY, JSON.stringify(['contract-allowed/']))
		try {
			const client = await session()
			expect(resultJson(await client.callTool('fs_write', { path, body: 'x' }))).toEqual({
				status: 'denied',
				reason: 'Path not in allowed scope',
				path,
				allowed: ['contract-allowed/'],
			})
		} finally {
			await env.FERMI_KV.delete(SCOPE_KEY)
		}
		expect(await env.FERMI_BUCKET.get(path)).toBeNull()
	})

	it('rejects a call without body', async () => {
		const client = await session()
		expectSchemaRejection(
			await client.callTool('fs_write', { path: `${prefix()}x` }),
			'fs_write',
			'body',
		)
	})
})

describeTool('fs_read', () => {
	it('round-trips what fs_write stored', async () => {
		const path = `${prefix()}round.md`
		const client = await session()
		await client.callTool('fs_write', { path, body: '# round trip' })
		expect(resultJson(await client.callTool('fs_read', { path }))).toEqual({
			path,
			size: 12,
			body: '# round trip',
		})
	})

	it('returns the Not found error for a missing path', async () => {
		const path = `${prefix()}missing`
		const client = await session()
		expect(resultJson(await client.callTool('fs_read', { path }))).toEqual({
			error: 'Not found',
			path,
		})
	})

	it('rejects a call without path', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('fs_read', {}), 'fs_read', 'path')
	})
})

describeTool('fs_list', () => {
	it('lists exactly the objects written under a prefix', async () => {
		const dir = prefix()
		const client = await session()
		await client.callTool('fs_write', { path: `${dir}a.txt`, body: 'a' })
		await client.callTool('fs_write', { path: `${dir}b.txt`, body: 'bb' })
		const listed = resultJson<{
			prefix: string
			objects: Array<{ key: string; size: number }>
			total: number
		}>(await client.callTool('fs_list', { prefix: dir }))
		expect(listed).toMatchObject({ prefix: dir, total: 2, truncated: false })
		expect(listed.objects.map(({ key, size }) => ({ key, size }))).toEqual([
			{ key: `${dir}a.txt`, size: 1 },
			{ key: `${dir}b.txt`, size: 2 },
		])
	})

	it('returns an empty listing for an unknown prefix', async () => {
		const dir = prefix()
		const client = await session()
		expect(resultJson(await client.callTool('fs_list', { prefix: dir }))).toEqual({
			prefix: dir,
			objects: [],
			truncated: false,
			total: 0,
		})
	})

	// fs_list has no required argument; a non-string prefix is its schema rejection.
	it('rejects a non-string prefix', async () => {
		const client = await session()
		expectSchemaRejection(await client.callTool('fs_list', { prefix: 7 }), 'fs_list', 'prefix')
	})
})
