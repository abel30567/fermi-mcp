#!/usr/bin/env bash
# Tamper harness for #34 / MCP-22: the runner-fetch fragment must install every
# manifest file whose sha256 matches the pin, and must fail closed (non-zero,
# nothing installed) when any one served file is tampered or missing. A legacy
# single-file pin must still install. Run from packages/worker:
#   bash test/shell/boot-pin-harness.sh
set -u
cd "$(dirname "$0")/../.."

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# macOS lacks sha256sum; shim it onto shasum.
if ! command -v sha256sum >/dev/null 2>&1; then
	mkdir -p "$WORK/bin"
	printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' > "$WORK/bin/sha256sum"
	chmod +x "$WORK/bin/sha256sum"
	export PATH="$WORK/bin:$PATH"
fi

FILES="box-runner.mjs harness/claude.mjs lib/report.mjs"
SRC="$WORK/src"
DEST="$WORK/opt"

serve_pristine() {
	local p
	rm -rf "$SRC"
	for p in $FILES; do
		mkdir -p "$SRC/$(dirname "$p")"
		echo "console.log('$p ok')" > "$SRC/$p"
	done
}

# Emit the real fragment from the TS module (node >=23 strips types natively).
# $1 = JSON pin literal.
fragment() {
	node --experimental-strip-types --no-warnings -e "
import('./src/lib/runner-pin.ts').then(m => {
  console.log(m.runnerFetchScript($1, { baseUrl: 'file://$SRC', destDir: '$DEST' }))
})"
}

# Fail closed: non-zero exit AND no manifest file installed.
expect_refused() {
	rm -rf "$DEST"
	if bash -euo pipefail "$WORK/fragment.sh" 2>/dev/null; then
		echo "FAIL: $1 accepted (exit 0)"; fail=1; return
	fi
	local p
	for p in $FILES; do
		if [ -f "$DEST/$p" ]; then
			echo "FAIL: $1: $p installed despite non-zero exit"; fail=1; return
		fi
	done
	echo "ok: $1 rejected, nothing installed"
}

fail=0
serve_pristine
MANIFEST=""
for f in $FILES; do
	MANIFEST="$MANIFEST'$f': '$(sha256sum "$SRC/$f" | cut -d' ' -f1)',"
done
fragment "{ ref: 'testref', files: { $MANIFEST } }" > "$WORK/fragment.sh" \
	|| { echo "FRAGMENT GENERATION FAILED"; exit 1; }

# Case A: pristine manifest -> every file installed at its relative path, exit 0.
rm -rf "$DEST"
if ! bash -euo pipefail "$WORK/fragment.sh"; then
	echo "FAIL: pristine manifest was not installed"; fail=1
else
	for f in $FILES; do
		if ! cmp -s "$SRC/$f" "$DEST/$f"; then echo "FAIL: $f not installed intact"; fail=1; fi
	done
	[ $fail -eq 0 ] && echo "ok: pristine manifest installed ($FILES)"
fi

# Case B: tamper any one file -> refuse.
for f in $FILES; do
	serve_pristine
	echo 'console.log("evil")' >> "$SRC/$f"
	expect_refused "tampered $f"
done

# Case C: omit any one file -> refuse.
for f in $FILES; do
	serve_pristine
	rm -f "$SRC/$f"
	expect_refused "missing $f"
done

# Case D: legacy single-file pin {ref, sha256} -> box-runner.mjs installed.
serve_pristine
LEGACY_SHA=$(sha256sum "$SRC/box-runner.mjs" | cut -d' ' -f1)
fragment "m.runnerPinFromConfig({ runner_ref: 'testref', runner_sha256: '$LEGACY_SHA' })" \
	> "$WORK/fragment.sh" || { echo "FRAGMENT GENERATION FAILED"; exit 1; }
rm -rf "$DEST"
if bash -euo pipefail "$WORK/fragment.sh" && cmp -s "$SRC/box-runner.mjs" "$DEST/box-runner.mjs"; then
	echo "ok: legacy single-file pin installed box-runner.mjs"
else
	echo "FAIL: legacy single-file pin did not boot"; fail=1
fi

# Case E: legacy pin, tampered runner -> refuse.
echo 'console.log("evil")' >> "$SRC/box-runner.mjs"
expect_refused "legacy pin, tampered box-runner.mjs"

exit $fail
