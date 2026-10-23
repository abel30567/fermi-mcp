#!/usr/bin/env node
// private-scan.mjs [dir] — fails (exit 1) when a git-tracked file under `dir` (default: the
// current directory's repo) holds a personal number: an E.164 number, a WhatsApp JID or LID,
// a phone-looking chat_id/sender, or a number written with separators (+1 (xxx) xxx-xxxx,
// tel:+44 xxxx xxxxxx, xxx.xxx.xxxx), unless it is a placeholder (5555550xxx, 1555555xxxx,
// 10000000000000, 20000000000000).
// Extra patterns (one regex per line, # comments; a line that is not a valid regex matches
// literally) come from the untracked $FERMI_PRIVATE_PATTERNS, default
// ~/.config/fermi/private-patterns, skipped if absent. Findings name the file, line and kind,
// never the value. Exit 0 clean, 1 on a finding, 2 on a usage error. Run by the root `bun run test`.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATTERNS = [
	['E.164 number', /\+[1-9]\d{7,14}\b/g],
	// 120363… group ids are random, not a person's number.
	['WhatsApp JID', /\b(?!120363)\d{5,}(?:-\d+)?@(?:s\.whatsapp\.net|c\.us|g\.us)\b/g],
	['WhatsApp LID', /\b\d{5,}@lid\b/g],
	['phone-looking chat id', /\b(?:chat_id|sender|phone)["'`\s:=]{0,4}\+?[1-9]\d{9,14}\b/gi],
]

// Numbers written with space, dash, dot or parenthesis separators. A hit is flagged when its
// digits, joined, are 10 to 15 long and not a placeholder.
export const FORMATTED = [
	['formatted number', /(?:\+|\btel:\+?)\d+(?:[ .-]?\(\d+\)|[ .-]\d+)+/g],
	[
		'formatted US number',
		/(?<![\w.+-])(?:1[ .-])?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-]|\.\d)/g,
	],
]

const PLACEHOLDER = /^(?:5555550\d{3}|1555555\d{4}|10000000000000|20000000000000)$/
// A hit is a placeholder when the first digit run in it is one.
const isPlaceholder = (match) => PLACEHOLDER.test(/\d+/.exec(match)[0])
const isFormattedNumber = (match) => {
	const digits = match.replace(/\D/g, '')
	return digits.length >= 10 && digits.length <= 15 && !PLACEHOLDER.test(digits)
}

export const DEFAULT_PATTERNS_FILE = join(homedir(), '.config/fermi/private-patterns')

// → [RegExp] from the patterns file, [] if it does not exist.
export function readPrivatePatterns(
	file = process.env.FERMI_PRIVATE_PATTERNS || DEFAULT_PATTERNS_FILE,
) {
	if (!existsSync(file)) return []
	return readFileSync(file, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'))
		.map((l) => {
			try {
				return new RegExp(l)
			} catch {
				return new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			}
		})
}

// → [{ line, kind }] for one text.
export function scanText(text, privatePatterns = []) {
	const hits = []
	text.split('\n').forEach((l, i) => {
		for (const [kind, re] of PATTERNS)
			if ([...l.matchAll(re)].some((m) => !isPlaceholder(m[0]))) hits.push({ line: i + 1, kind })
		for (const [kind, re] of FORMATTED)
			if ([...l.matchAll(re)].some((m) => isFormattedNumber(m[0]))) hits.push({ line: i + 1, kind })
		privatePatterns.forEach(
			(re, n) => re.test(l) && hits.push({ line: i + 1, kind: `private pattern #${n + 1}` }),
		)
	})
	return hits
}

// → { files, hits: [{ file, line, kind }] } over the git-tracked files of `dir`'s repo.
export function scanRepo(dir, privatePatterns = []) {
	const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
		cwd: dir,
		encoding: 'utf8',
	}).trim()
	const files = execFileSync('git', ['ls-files', '-z'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 64 << 20,
	})
		.split('\0')
		.filter(Boolean)
	const hits = []
	for (const file of files) {
		const path = join(root, file)
		if (!existsSync(path) || !lstatSync(path).isFile()) continue // deleted in the worktree, symlink, submodule
		const text = readFileSync(path, 'utf8')
		if (text.includes('\0')) continue // binary
		for (const h of scanText(text, privatePatterns)) hits.push({ file, ...h })
	}
	return { files: files.length, hits }
}

function main(argv) {
	if (argv.length > 1 || argv[0]?.startsWith('-')) return usage()
	let result
	let privatePatterns
	try {
		privatePatterns = readPrivatePatterns()
		result = scanRepo(resolve(argv[0] ?? '.'), privatePatterns)
	} catch (err) {
		console.error(`private-scan: ${err.message}`)
		return usage()
	}
	for (const h of result.hits) console.error(`private-scan: ${h.file}:${h.line}: ${h.kind}`)
	console.log(
		`private-scan: ${result.hits.length} finding(s) in ${result.files} tracked file(s), ${privatePatterns.length} private pattern(s)`,
	)
	return result.hits.length ? 1 : 0
}

function usage() {
	console.error('usage: node scripts/private-scan.mjs [dir]')
	return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
	process.exitCode = main(process.argv.slice(2))
