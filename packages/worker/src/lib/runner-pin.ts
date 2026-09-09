/**
 * Supply-chain pin for the box-runner boot download (#34). The provisioner
 * refuses to launch without a pin, and the generated user-data verifies the
 * fetched runner's sha256 BEFORE the box token is materialized — a tampered
 * or unpinned runner never sees credentials and the box fails closed (never
 * heartbeats; the provision-grace reaper path reclaims it).
 *
 * Leaf module: no imports, safe for both workerd and plain node (test harness).
 */

export interface RunnerPin {
	/** Commit SHA (or immutable tag) in abel30567/fermi-daemon. */
	ref: string
	/** sha256 hex of box-runner.mjs at that ref. */
	sha256: string
}

export function runnerUrl(ref: string): string {
	return `https://raw.githubusercontent.com/abel30567/fermi-daemon/${ref}/box-runner.mjs`
}

/**
 * Bash fragment: fetch → verify → install. Aborts non-zero on any mismatch
 * (callers run under `set -euo pipefail`), leaving nothing installed. No
 * fallback to a baked copy — fail closed is the point.
 */
export function runnerFetchScript(
	pin: RunnerPin,
	opts: { url?: string; dest?: string } = {},
): string {
	const url = opts.url ?? runnerUrl(pin.ref)
	const dest = opts.dest ?? '/opt/fermi/box-runner.mjs'
	// --retry: large fleets boot in bursts and GitHub's raw CDN throttles them
	// (2 of 100 boxes died to this on 2026-09-07). Retries cover transient
	// throttling; the sha256 gate still catches anything short or tampered.
	return [
		`curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors '${url}' -o '${dest}.new'`,
		`echo '${pin.sha256}  ${dest}.new' | sha256sum -c - >/dev/null`,
		`mv '${dest}.new' '${dest}'`,
	].join('\n')
}
