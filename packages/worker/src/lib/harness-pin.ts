/**
 * hbar harness pin (ISSUE-89). Boxes on route `claude` install the pinned hbar
 * tarball from `GET /box/harness` and name its `cli` as CLAUDE_BIN in box.env;
 * the runner already starts `CLAUDE_BIN ?? 'claude'`. Unlike the runner pin,
 * this fails OPEN: any failed step leaves the image's Claude Code in place.
 *
 * Leaf module: no imports, safe for both workerd and plain node (test harness).
 */

export interface HarnessPin {
	/** Object name under `harness/` in FERMI_BUCKET. */
	name: string
	sha256: string
	/** Display string for notes and docs only. */
	version: string
}

export const HARNESS_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.tar\.gz$/
export const HARNESS_VERSION_RE = /^[A-Za-z0-9._+-]{1,40}$/
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/
/** Upload header carrying the body's sha256 (64 lowercase hex). */
export const HARNESS_SHA256_HEADER = 'x-content-sha256'

export function harnessKey(name: string): string {
	return `harness/${name}`
}

/** The pin stored in fleet:config, or null when unset or malformed. */
export function harnessPinFromConfig(config: { harness?: unknown }): HarnessPin | null {
	const h = config.harness as Partial<HarnessPin> | null | undefined
	if (!h || typeof h !== 'object') return null
	if (typeof h.name !== 'string' || !HARNESS_NAME_RE.test(h.name)) return null
	if (typeof h.sha256 !== 'string' || !SHA256_HEX_RE.test(h.sha256)) return null
	if (typeof h.version !== 'string' || !HARNESS_VERSION_RE.test(h.version)) return null
	return { name: h.name, sha256: h.sha256, version: h.version }
}

const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`

/**
 * Bash block for user-data, run under `set -euo pipefail`. It never ends the
 * script: the steps run in a subshell with errexit off that prints `ok` or the
 * failed step, and the whole assignment is `|| true`. Only after `cli
 * --version` exits 0 is CLAUDE_BIN appended; otherwise the install dir is
 * removed. One note goes to /box/report either way; a failed report is ignored.
 */
export function harnessInstallScript(
	pin: HarnessPin,
	opts: { baseUrl: string; boxToken: string; root?: string; downloadTimeout?: number },
): string {
	if (!harnessPinFromConfig({ harness: pin })) throw new Error('harness pin: invalid')
	const root = opts.root ?? ''
	const dir = `${root}/opt/hbar/${pin.sha256.slice(0, 12)}`
	const auth = `printf 'header = "Authorization: Bearer %s"\\n' ${q(opts.boxToken)}`
	const base = opts.baseUrl.replace(/\/+$/, '')
	const note = (msg: string) => `"{\\"note\\":\\"${msg}\\"}"`
	return [
		'# hbar harness (ISSUE-89): on any failure the image claude stays; the boot goes on.',
		`HBAR_DIR=${q(dir)}`,
		`HBAR_TGZ=${q(`${dir}.tgz`)}`,
		'HBAR_STEP=$( (',
		'set +e +o pipefail',
		'rm -rf "$HBAR_DIR" "$HBAR_TGZ"',
		`mkdir -p ${q(`${root}/opt/hbar`)} && chmod 755 ${q(`${root}/opt/hbar`)} &&`,
		`${auth} | curl -fsS --connect-timeout 20 --max-time ${opts.downloadTimeout ?? 180} -K - ${q(`${base}/box/harness`)} -o "$HBAR_TGZ" || { echo download; exit 0; }`,
		`echo ${q(`${pin.sha256}  `)}"$HBAR_TGZ" | sha256sum -c - >/dev/null || { echo sha256; exit 0; }`,
		'mkdir -p "$HBAR_DIR" && tar --no-same-owner -xzf "$HBAR_TGZ" -C "$HBAR_DIR" && [ -f "$HBAR_DIR/cli" ] && chmod -R a+rX "$HBAR_DIR" && chmod 755 "$HBAR_DIR" "$HBAR_DIR/cli" || { echo unpack; exit 0; }',
		'timeout 30 "$HBAR_DIR/cli" --version </dev/null >/dev/null || { echo start; exit 0; }',
		'echo ok',
		') ) || true',
		'rm -f "$HBAR_TGZ" || true',
		'if [ "$HBAR_STEP" = ok ]; then',
		// A box.env that cannot take the line means the runner cannot start hbar.
		`  echo "CLAUDE_BIN=$HBAR_DIR/cli" >> ${q(`${root}/etc/fermi/box.env`)} || HBAR_STEP=start`,
		'fi',
		'if [ "$HBAR_STEP" = ok ]; then',
		`  HBAR_NOTE=${note(`harness: hbar ${pin.version}`)}`,
		'else',
		'  rm -rf "$HBAR_DIR" || true',
		`  HBAR_NOTE=${note(`harness: claude (hbar ${pin.version} not installed: \${HBAR_STEP:-download})`)}`,
		'fi',
		`${auth} | curl -fsS --connect-timeout 10 --max-time 20 -K - -H 'content-type: application/json' --data-binary "$HBAR_NOTE" ${q(`${base}/box/report`)} >/dev/null || true`,
	].join('\n')
}
