#!/bin/zsh
# Install the Fermi WhatsApp bridge: copies the package to ~/fermi-daemon/wa-bridge,
# installs prod deps, and loads the com.fermi.wa-bridge LaunchAgent. Safe to re-run.
# Requires the base daemon (daemon/install.sh) to have created ~/fermi-daemon/.env first.
set -eu

SCRIPT_DIR="${0:A:h}"
DAEMON_HOME="$HOME/fermi-daemon"
ENV_FILE="$DAEMON_HOME/.env"
BRIDGE_HOME="$DAEMON_HOME/wa-bridge"
AUTH_DIR="$DAEMON_HOME/wa-auth"
PLIST_DEST="$HOME/Library/LaunchAgents/com.fermi.wa-bridge.plist"

# --- prerequisites ------------------------------------------------------------
command -v node >/dev/null || {
	echo "error: node not found on PATH (need Node >= 22.18 for native TS type-stripping)" >&2
	exit 1
}
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' || {
	echo "error: Node >= 22.18 required (found $(node --version)); TS files run without a build step." >&2
	exit 1
}

if [[ ! -f "$ENV_FILE" ]]; then
	echo "error: $ENV_FILE not found — run the base daemon installer first:" >&2
	echo "  $SCRIPT_DIR/../../daemon/install.sh" >&2
	exit 1
fi

# --- WA_WEBHOOK_SECRET: ensure it exists in .env ------------------------------
if ! grep -q '^WA_WEBHOOK_SECRET=' "$ENV_FILE"; then
	secret="${WA_WEBHOOK_SECRET:-}"
	if [[ -z "$secret" ]]; then
		secret="$(openssl rand -hex 32)"
	fi
	printf 'WA_WEBHOOK_SECRET=%s\n' "$secret" >>"$ENV_FILE"
	echo "added WA_WEBHOOK_SECRET to $ENV_FILE"
	echo
	echo "  IMPORTANT: set the SAME value as a Wrangler secret on the Worker:"
	echo "    (cd packages/worker && wrangler secret put WA_WEBHOOK_SECRET)"
	echo "  (paste the value from $ENV_FILE when prompted — not shown here)"
	echo
else
	echo "keeping existing WA_WEBHOOK_SECRET in $ENV_FILE"
fi

# --- copy package + install prod deps -----------------------------------------
mkdir -p "$BRIDGE_HOME" "$DAEMON_HOME/logs"
# --exclude node_modules so re-runs don't wipe installed deps before npm install.
rsync -a --delete --exclude 'node_modules' \
	"$SCRIPT_DIR/package.json" "$SCRIPT_DIR/tsconfig.json" "$SCRIPT_DIR/src" "$BRIDGE_HOME/"
(cd "$BRIDGE_HOME" && npm install --omit=dev --silent)

# --- LaunchAgent --------------------------------------------------------------
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE_BIN|g" -e "s|__NODE_DIR__|$NODE_DIR|g" \
	"$SCRIPT_DIR/com.fermi.wa-bridge.plist" >"$PLIST_DEST"
launchctl bootout "gui/$UID/com.fermi.wa-bridge" 2>/dev/null || true

if [[ -f "$AUTH_DIR/creds.json" ]]; then
	launchctl bootstrap "gui/$UID" "$PLIST_DEST"
	echo "installed: LaunchAgent com.fermi.wa-bridge (paired, running)"
	echo "  logs:      $DAEMON_HOME/logs/wa-bridge.log"
	echo "  restart:   launchctl kickstart -k gui/\$UID/com.fermi.wa-bridge"
	echo "  uninstall: launchctl bootout gui/\$UID/com.fermi.wa-bridge && rm $PLIST_DEST"
else
	echo "installed plist but NOT started — this device is not paired yet."
	echo
	echo "  Pair it now (dedicated WhatsApp number, in E.164 digits without '+'):"
	echo "    cd $BRIDGE_HOME && npm run pair -- <E164-digits>"
	echo "  On your phone: WhatsApp > Settings > Linked Devices > Link a device"
	echo "  > Link with phone number instead, then enter the code shown."
	echo "  Once you see 'connected as …', press Ctrl-C and start the agent:"
	echo "    launchctl bootstrap gui/\$UID $PLIST_DEST"
fi
