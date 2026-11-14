#!/usr/bin/env bash
# Harness for ISSUE-89: the hbar install block from user-data must, against a
# local fake server and a fake `cli` in a temp root, add exactly one CLAUDE_BIN
# line on a good tarball and, on any failed step, add nothing, leave nothing
# under /opt/hbar, report the failed step, and let the boot script go on.
# Run from anywhere:
#   bash packages/worker/test/shell/boot-harness-install.sh
set -u
cd "$(dirname "$0")/../.."

PORT=${PORT:-8189}
TOKEN='box-test.supersecret'
VERSION='2.1.0+hbar.7'
WORK=$(mktemp -d)
SERVER_PID=''
cleanup() {
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
	rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/bin"
# macOS lacks sha256sum (and may lack timeout); shim them.
if ! command -v sha256sum >/dev/null 2>&1; then
	printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' > "$WORK/bin/sha256sum"
	chmod +x "$WORK/bin/sha256sum"
fi
if ! command -v timeout >/dev/null 2>&1; then
	printf '#!/bin/sh\nexec perl -e '"'"'alarm shift; exec @ARGV'"'"' "$@"\n' > "$WORK/bin/timeout"
	chmod +x "$WORK/bin/timeout"
fi
export PATH="$WORK/bin:$PATH"

# Fake Fermi: GET /box/harness per $WORK/mode (ok | 404 | hang), POST
# /box/report records the note and answers per $WORK/report_mode (ok | refuse).
cat > "$WORK/server.py" <<'PY'
import http.server, json, os, sys, time
work, token = sys.argv[2], sys.argv[3]
def read(name, default):
    try:
        return open(os.path.join(work, name)).read().strip()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def authed(self):
        if self.headers.get('Authorization') != 'Bearer ' + token:
            self.send_response(401); self.end_headers(); return False
        return True
    def do_GET(self):
        if self.path != '/box/harness' or not self.authed(): return
        mode = read('mode', 'ok')
        if mode == 'hang':
            time.sleep(60); return
        if mode == '404':
            self.send_response(404); self.end_headers(); return
        data = open(os.path.join(work, 'serve.bin'), 'rb').read()
        self.send_response(200)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_POST(self):
        if self.path != '/box/report' or not self.authed(): return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(os.path.join(work, 'notes'), 'a') as f:
            f.write(json.loads(body)['note'] + '\n')
        self.send_response(500 if read('report_mode', 'ok') == 'refuse' else 200)
        self.end_headers()
http.server.ThreadingHTTPServer.daemon_threads = True
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
python3 "$WORK/server.py" "$PORT" "$WORK" "$TOKEN" &
SERVER_PID=$!
for _ in $(seq 50); do
	curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
	sleep 0.1
done

# Tarball holding `cli` and vendor/, like the real hbar build. $1 = cli exit code.
make_tarball() {
	rm -rf "$WORK/build" && mkdir -p "$WORK/build/vendor"
	printf '#!/bin/sh\necho "hbar fake"\nexit %s\n' "$1" > "$WORK/build/cli"
	chmod 700 "$WORK/build/cli"
	echo vendored > "$WORK/build/vendor/lib.txt"
	tar -czf "$WORK/serve.bin" -C "$WORK/build" cli vendor
}

# Emit the real block from the TS module. $1 = pinned sha256.
block() {
	node --experimental-strip-types --no-warnings -e "
import('./src/lib/harness-pin.ts').then(m => {
  console.log(m.harnessInstallScript(
    { name: 'hbar-linux-x64.tar.gz', sha256: '$1', version: '$VERSION' },
    { baseUrl: 'http://127.0.0.1:$PORT/', boxToken: '$TOKEN', root: '$WORK/root', downloadTimeout: 3 },
  ))
})"
}

fail=0
bad() { echo "FAIL: $1: $2"; fail=$((fail + 1)); }

# $1 label, $2 pinned sha256, $3 expected note. Runs the block inside a
# set -euo pipefail script that has lines before and after it.
run_case() {
	local label=$1 sha=$2 want=$3 root="$WORK/root" before=$fail
	rm -rf "$root" "$WORK/notes" "$WORK/after"
	mkdir -p "$root/etc/fermi"
	printf 'BOX_ID=box-test\nROUTE=claude\n' > "$root/etc/fermi/box.env"
	{
		echo '#!/bin/bash'
		echo 'set -euo pipefail'
		block "$sha" || { echo "BLOCK GENERATION FAILED" >&2; exit 1; }
		echo "echo after > '$WORK/after'"
	} > "$WORK/userdata.sh"
	if ! bash "$WORK/userdata.sh" 2>/dev/null; then bad "$label" "script exited non-zero"; fi
	[ -f "$WORK/after" ] || bad "$label" "lines after the block did not run"
	local note
	note=$(cat "$WORK/notes" 2>/dev/null)
	[ "$note" = "$want" ] || bad "$label" "note was '$note', want '$want'"
	local bins
	bins=$(grep -c '^CLAUDE_BIN=' "$root/etc/fermi/box.env")
	if [ "$want" = "harness: hbar $VERSION" ]; then
		[ "$bins" = 1 ] || bad "$label" "$bins CLAUDE_BIN lines, want 1"
		local bin
		bin=$(sed -n 's/^CLAUDE_BIN=//p' "$root/etc/fermi/box.env")
		[ "$bin" = "$root/opt/hbar/${sha:0:12}/cli" ] || bad "$label" "CLAUDE_BIN=$bin"
		[ -x "$bin" ] || bad "$label" "$bin is not executable"
		[ "$(stat -f %Lp "$bin" 2>/dev/null || stat -c %a "$bin")" = 755 ] \
			|| bad "$label" "$bin is not mode 755"
		[ -r "$root/opt/hbar/${sha:0:12}/vendor/lib.txt" ] || bad "$label" "vendor/ not unpacked"
		[ ! -e "$root/opt/hbar/${sha:0:12}.tgz" ] || bad "$label" "tarball left behind"
	else
		[ "$bins" = 0 ] || bad "$label" "$bins CLAUDE_BIN lines, want 0"
		[ -z "$(ls -A "$root/opt/hbar" 2>/dev/null)" ] \
			|| bad "$label" "left under /opt/hbar: $(ls -A "$root/opt/hbar")"
	fi
	head -2 "$root/etc/fermi/box.env" | cmp -s - <(printf 'BOX_ID=box-test\nROUTE=claude\n') \
		|| bad "$label" "box.env lines before the block changed"
	[ "$fail" -eq "$before" ] && echo "ok: $label"
}

sha_of() { sha256sum "$1" | cut -d' ' -f1; }
not_installed() { echo "harness: claude (hbar $VERSION not installed: $1)"; }

for report in ok refuse; do
	echo "$report" > "$WORK/report_mode"
	sfx=" (report $report)"

	echo ok > "$WORK/mode"
	make_tarball 0
	run_case "good tarball$sfx" "$(sha_of "$WORK/serve.bin")" "harness: hbar $VERSION"

	run_case "wrong sha256$sfx" "$(printf '0%.0s' $(seq 64))" "$(not_installed sha256)"

	echo 404 > "$WORK/mode"
	run_case "404$sfx" "$(sha_of "$WORK/serve.bin")" "$(not_installed download)"

	echo ok > "$WORK/mode"
	head -c 4096 /dev/urandom > "$WORK/serve.bin"
	run_case "not a tarball$sfx" "$(sha_of "$WORK/serve.bin")" "$(not_installed unpack)"

	make_tarball 1
	run_case "cli --version exits 1$sfx" "$(sha_of "$WORK/serve.bin")" "$(not_installed start)"

	echo hang > "$WORK/mode"
	make_tarball 0
	run_case "server never answers$sfx" "$(sha_of "$WORK/serve.bin")" "$(not_installed download)"
done

echo "$fail failure(s)"
[ "$fail" -eq 0 ]
