import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// MCP-25 (same rules as fermi-daemon DMN-43): scripts/private-scan.mjs fails when a tracked file holds a real-looking number, JID or
// LID (or a line matching the local private patterns), passes on the placeholders, and never
// prints the value it found.
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SCAN = join(ROOT, 'scripts/private-scan.mjs')
// Built at runtime so this file holds no number itself: a UK drama-range (fictional) mobile.
const PLANTED = '7700' + '900' + '123'
// A US-shaped number in the unassigned 555 area code, outside the 555-555-0xxx placeholders.
const [AREA, EXCH, LINE] = ['5' + '55', '77' + '0', '09' + '00']
const NO_PATTERNS = join(tmpdir(), 'mcp25-no-such-patterns-file')

// A temp git repo with `files` ({ name: text }) added to the index.
function repo(files, untracked = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'mcp25-scan-'))
	execFileSync('git', ['init', '-q'], { cwd: dir })
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
	if (Object.keys(files).length) execFileSync('git', ['add', '.'], { cwd: dir })
	for (const [name, text] of Object.entries(untracked)) writeFileSync(join(dir, name), text)
	return dir
}

const scan = (dir, patterns = NO_PATTERNS) =>
	spawnSync(process.execPath, [SCAN, dir], {
		encoding: 'utf8',
		env: { ...process.env, FERMI_PRIVATE_PATTERNS: patterns },
	})

test('the repo passes the scan', () => {
	const r = scan(ROOT)
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stdout, /0 finding\(s\)/)
})

for (const [kind, line] of [
	['E.164 number', `call +44${PLANTED} now`],
	['WhatsApp JID', `"chat": "44${PLANTED}@s.whatsapp.net"`],
	['WhatsApp JID', `"chat": "44${PLANTED}-1@g.us"`],
	['WhatsApp LID', `"lid": "1${PLANTED}99@lid"`],
	['phone-looking chat id', `(channel wa, chat_id 44${PLANTED} is the same person)`],
]) {
	test(`a planted ${kind} fails the scan without printing it`, () => {
		const r = scan(repo({ 'a.md': 'clean\n', 'b.json': `{\n${line}\n}\n` }))
		assert.equal(r.status, 1, r.stdout)
		assert.match(r.stderr, new RegExp(`b\\.json:2: ${kind.replace('.', '\\.')}`))
		assert.ok(!(r.stdout + r.stderr).includes(PLANTED), 'the scanner printed the value')
	})
}

for (const [kind, line] of [
	['formatted number', `call +1 (${AREA}) ${EXCH}-${LINE} now`],
	['formatted number', `+44 77 ${PLANTED.slice(2, 6)} ${PLANTED.slice(6)}`],
	['formatted number', `tel:+44 ${PLANTED.slice(0, 4)} ${PLANTED.slice(4)}`],
	['formatted number', `+44 (0) ${PLANTED.slice(0, 4)} ${PLANTED.slice(4, 7)}-${PLANTED.slice(7)}`],
	['formatted number', `+44.${PLANTED.slice(0, 4)}.${PLANTED.slice(4)}`],
	['formatted US number', `${AREA}-${EXCH}-${LINE}`],
	['formatted US number', `call ${AREA}.${EXCH}.${LINE}.`],
	['formatted US number', `(${AREA}) ${EXCH}-${LINE}`],
	['formatted US number', `(${AREA})${EXCH}-${LINE}`],
	['formatted US number', `1 ${AREA} ${EXCH} ${LINE}`],
]) {
	test(`a planted ${kind} (${line.replace(/\d/g, '#')}) fails the scan without printing it`, () => {
		const r = scan(repo({ 'f.txt': `clean\n${line}\n` }))
		assert.equal(r.status, 1, r.stdout)
		assert.match(r.stderr, new RegExp(`f\\.txt:2: ${kind}`))
		assert.ok(
			![`${EXCH}-${LINE}`, PLANTED.slice(4)].some((v) => (r.stdout + r.stderr).includes(v)),
			'the scanner printed the value',
		)
	})
}

test('formatted placeholders and number-like non-phone text pass', () => {
	const text = [
		'call +1 (555) 555-0100, +1 555 555 0101, 1 555 555 0102, tel:+1-555-555-0199',
		'555-555-0123, 555.555.0124, (555) 555-0125, "lid": "+20 000 000 000 000"',
		'commit abaae0b27e0b868ff72e5622529adfb272331007, short 08922af',
		'at 2026-10-23T09:30:00.123Z, 2026-10-23 21:30:05, ts 1761200000000 1761200000001',
		'node 22.11.0, macOS 10.15.7, v1.2.3-rc.4, 2.0.0-beta.12',
		'took 12:34:56, 1h 23m 45s, 123.456 ms, 1,234,567 bytes',
		'localhost:8080, 127.0.0.1:3000, 192.168.100.200, http://[::1]:5432',
		'id 123e4567-e89b-12d3-a456-426614174000 or 12345678-1234-5678-1234-567812345678',
		'# tests 656 # pass 650 # fail 0, pass (14/0), 1 2 3 4 5 6 7 8 9 10',
		'@@ -120,7 +121,8 @@, +100 -20, +1 more, +3.5%, x +12 345 / 2',
	].join('\n')
	const r = scan(repo({ 'p.md': text }))
	assert.equal(r.status, 0, r.stderr)
})

test('the placeholders pass', () => {
	const text = [
		'call +15555550100 or +15555550101',
		'"pn": "15555554567@s.whatsapp.net", "lid": "10000000000000@lid", "alt": "15555550222@lid"',
		'"chat": "120363000000000001@g.us", "dm": "15555550100@c.us"',
		'(channel wa, chat_id 15555550100 is the same person: Example)',
		'mail owner@example.com, ts 1761200000000, id 1@g.us',
	].join('\n')
	const r = scan(repo({ 'p.md': text }))
	assert.equal(r.status, 0, r.stderr)
})

test('only tracked files are scanned', () => {
	assert.equal(scan(repo({ 'a.md': 'clean\n' }, { 'notes.md': `+44${PLANTED}\n` })).status, 0)
})

test('the local private-patterns file adds patterns, and is skipped when absent', () => {
	const dir = repo({ 'a.md': 'hello Zelda Privatename\n' })
	const patterns = join(dir, '..', `mcp25-patterns-${process.pid}`)
	writeFileSync(patterns, '# comment\n\nZelda\\s+Private\\w+\n+1(\n')
	const r = scan(dir, patterns)
	assert.equal(r.status, 1)
	assert.match(r.stderr, /a\.md:1: private pattern #1/)
	assert.ok(!r.stderr.includes('Zelda'), 'the scanner printed the value')
	assert.match(r.stdout, /2 private pattern\(s\)/)
	assert.equal(scan(dir).status, 0)
})
