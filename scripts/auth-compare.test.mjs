import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'node:test'

// MCP-32: admin bearer and owner secret compares go through timingSafeEqual
// (packages/worker/src/lib/crypto.ts), never a plain === / !==.
const SRC = new URL('../packages/worker/src/', import.meta.url).pathname
const PLAIN =
	/[!=]==\s*`Bearer \$\{|`Bearer \$\{[^`]*\}`\s*[!=]==|[!=]==\s*env\.FERMI_OWNER_SECRET|env\.FERMI_OWNER_SECRET\s*[!=]==/

const files = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
	)

it('no admin bearer or owner secret is compared with === or !==', () => {
	const hits = files(SRC).flatMap((f) =>
		readFileSync(f, 'utf8')
			.split('\n')
			.flatMap((line, i) =>
				PLAIN.test(line) ? [`${f.slice(SRC.length)}:${i + 1}: ${line.trim()}`] : [],
			),
	)
	assert.deepEqual(hits, [])
})

it('every file reading the admin bearer or owner secret imports the shared helper', () => {
	const users = files(SRC).filter((f) =>
		/env\.FERMI_(BEARER_TOKEN|OWNER_SECRET)\b/.test(readFileSync(f, 'utf8')),
	)
	assert.ok(users.length >= 7, users.join('\n'))
	for (const f of users) {
		assert.match(
			readFileSync(f, 'utf8'),
			/import \{ timingSafeEqual \} from '(\.\.?\/)+(lib\/)?crypto\.ts'/,
			f,
		)
	}
})
