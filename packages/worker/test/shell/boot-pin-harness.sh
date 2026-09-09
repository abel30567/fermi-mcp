#!/usr/bin/env bash
# Tamper harness for #34: the runner-fetch fragment must install a runner whose
# sha256 matches the pin, and must fail closed (non-zero, nothing installed)
# when the served file is tampered. Run from packages/worker:
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

echo 'console.log("runner ok")' > "$WORK/runner.mjs"
SHA=$(sha256sum "$WORK/runner.mjs" | cut -d' ' -f1)

# Emit the real fragment from the TS module (node >=23 strips types natively).
node --experimental-strip-types --no-warnings -e "
import('./src/lib/runner-pin.ts').then(m => {
  console.log(m.runnerFetchScript(
    { ref: 'testref', sha256: '$SHA' },
    { url: 'file://$WORK/runner.mjs', dest: '$WORK/installed.mjs' },
  ))
})" > "$WORK/fragment.sh" || { echo "FRAGMENT GENERATION FAILED"; exit 1; }

fail=0

# Case A: pristine file -> installs, exit 0.
bash -euo pipefail "$WORK/fragment.sh"
if [ $? -ne 0 ] || [ ! -f "$WORK/installed.mjs" ]; then
	echo "FAIL: pristine runner was not installed"; fail=1
else
	echo "ok: pristine runner installed"
fi

# Case B: tampered file -> must NOT install, non-zero exit.
rm -f "$WORK/installed.mjs"
echo 'console.log("evil")' > "$WORK/runner.mjs"
if bash -euo pipefail "$WORK/fragment.sh" 2>/dev/null; then
	echo "FAIL: tampered runner accepted (exit 0)"; fail=1
elif [ -f "$WORK/installed.mjs" ]; then
	echo "FAIL: tampered runner file was installed despite non-zero exit"; fail=1
else
	echo "ok: tampered runner rejected, nothing installed"
fi

exit $fail
