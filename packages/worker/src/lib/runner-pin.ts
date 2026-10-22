/**
 * Supply-chain pin for the box-runner boot download (#34). The provisioner
 * refuses to launch without a pin, and the generated user-data verifies every
 * fetched file's sha256 BEFORE the box token is materialized — a tampered,
 * missing or unpinned file never sees credentials and the box fails closed
 * (never heartbeats; the provision-grace reaper path reclaims it).
 *
 * The pin is a manifest (MCP-22): one ref plus a sha256 per file, so the
 * runner can ship shared modules alongside box-runner.mjs. A legacy pin
 * (ref + one sha256) is the manifest `{ 'box-runner.mjs': sha256 }`.
 *
 * Leaf module: no imports, safe for both workerd and plain node (test harness).
 */

export const RUNNER_ENTRY = 'box-runner.mjs'

export interface RunnerPin {
	/** Commit SHA (or immutable tag) in abel30567/fermi-daemon. */
	ref: string
	/** Repo-relative path → sha256 hex at that ref. Always includes RUNNER_ENTRY. */
	files: Record<string, string>
}

export const REF_RE = /^[0-9a-f]{7,40}$/
const SHA256_RE = /^[0-9a-f]{64}$/
// Paths land in a URL and in single-quoted shell: plain segments only, no `..`.
const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/
const MAX_FILES = 64

export function runnerBaseUrl(ref: string): string {
	return `https://raw.githubusercontent.com/abel30567/fermi-daemon/${ref}`
}

export function runnerUrl(ref: string, path: string = RUNNER_ENTRY): string {
	return `${runnerBaseUrl(ref)}/${path}`
}

/** Returns an error string, or null when `files` is a usable manifest. */
export function manifestError(files: unknown): string | null {
	if (!files || typeof files !== 'object' || Array.isArray(files))
		return 'files must be an object of path -> sha256'
	const entries = Object.entries(files)
	if (entries.length > MAX_FILES) return `files must list at most ${MAX_FILES} paths`
	if (!(RUNNER_ENTRY in files)) return `files must include ${RUNNER_ENTRY}`
	for (const [path, sha] of entries) {
		if (!PATH_RE.test(path) || path.length > 200) return `invalid path: ${path}`
		if (typeof sha !== 'string' || !SHA256_RE.test(sha))
			return `sha256 for ${path} must be 64 lowercase hex chars`
	}
	return null
}

/**
 * The pin stored in fleet:config: a manifest, else the legacy single sha256,
 * else null. An invalid stored manifest is null too, so launch fails closed.
 */
export function runnerPinFromConfig(config: {
	runner_ref: string | null
	runner_sha256: string | null
	runner_files?: Record<string, string> | null
}): RunnerPin | null {
	if (!config.runner_ref) return null
	if (config.runner_files)
		return manifestError(config.runner_files)
			? null
			: { ref: config.runner_ref, files: config.runner_files }
	if (config.runner_sha256)
		return { ref: config.runner_ref, files: { [RUNNER_ENTRY]: config.runner_sha256 } }
	return null
}

/**
 * Bash fragment: fetch all → verify all → install all. Aborts non-zero on any
 * missing or mismatched file (callers run under `set -euo pipefail`), before
 * anything is installed. No fallback to a baked copy — fail closed is the point.
 */
export function runnerFetchScript(
	pin: RunnerPin,
	opts: { baseUrl?: string; destDir?: string } = {},
): string {
	const err = manifestError(pin.files)
	if (err) throw new Error(`runner pin: ${err}`)
	const base = opts.baseUrl ?? runnerBaseUrl(pin.ref)
	const dir = opts.destDir ?? '/opt/fermi'
	const paths = Object.keys(pin.files).sort()
	const dirs = [...new Set(paths.map((p) => `${dir}/${p}`.replace(/\/[^/]+$/, '')))]
	// --retry: large fleets boot in bursts and GitHub's raw CDN throttles them
	// (2 of 100 boxes died to this on 2026-09-07). Retries cover transient
	// throttling; the sha256 gate still catches anything short or tampered.
	return [
		...dirs.map((d) => `mkdir -p '${d}'`),
		...paths.map(
			(p) =>
				`curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors '${base}/${p}' -o '${dir}/${p}.new'`,
		),
		...paths.map((p) => `echo '${pin.files[p]}  ${dir}/${p}.new' | sha256sum -c - >/dev/null`),
		...paths.map((p) => `mv '${dir}/${p}.new' '${dir}/${p}'`),
	].join('\n')
}
