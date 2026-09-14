#!/bin/zsh
# Install the Fermi Slack bridge: copies the package to ~/fermi-daemon/sl-bridge,
# installs prod deps, and loads the com.fermi.sl-bridge LaunchAgent. Safe to re-run.
# Requires the base daemon (daemon/install.sh) to have created ~/fermi-daemon/.env first.
set -eu

SCRIPT_DIR="${0:A:h}"
DAEMON_HOME="$HOME/fermi-daemon"
ENV_FILE="$DAEMON_HOME/.env"
BRIDGE_HOME="$DAEMON_HOME/sl-bridge"
PLIST_DEST="$HOME/Library/LaunchAgents/com.fermi.sl-bridge.plist"

# --- prerequisites ------------------------------------------------------------
command -v node >/dev/null || {
	echo "error: node not found on PATH (need Node >= 22.18 for native TS type-stripping)" >&2
	exit 1
}
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' || {
	echo "error: Node >= 22.18 required (found $(node --version)); TS files run without a build step." >&2
	exit 1
}

if [[ ! -f "$ENV_FILE" ]]; then
	echo "error: $ENV_FILE not found — run the base daemon installer first:" >&2
	echo "  $SCRIPT_DIR/../../daemon/install.sh" >&2
	exit 1
fi

# --- SLACK_BRIDGE_SECRET: ensure it exists in .env ----------------------------
if ! grep -q '^SLACK_BRIDGE_SECRET=' "$ENV_FILE"; then
	secret="${SLACK_BRIDGE_SECRET:-}"
	if [[ -z "$secret" ]]; then
		secret="$(openssl rand -hex 32)"
	fi
	printf 'SLACK_BRIDGE_SECRET=%s\n' "$secret" >>"$ENV_FILE"
	echo "added SLACK_BRIDGE_SECRET to $ENV_FILE"
	echo
	echo "  IMPORTANT: set the SAME value as a Wrangler secret on the Worker:"
	echo "    (cd packages/worker && wrangler secret put SLACK_BRIDGE_SECRET)"
	echo "  (paste the value from $ENV_FILE when prompted — not shown here)"
	echo
else
	echo "keeping existing SLACK_BRIDGE_SECRET in $ENV_FILE"
fi

# --- SLACK_BOT_TOKEN / SLACK_APP_TOKEN: must be present before connect --------
if ! grep -q '^SLACK_BOT_TOKEN=' "$ENV_FILE"; then
	echo
	echo "  REMINDER: the bridge needs the bot token. Add it to $ENV_FILE:"
	echo "    SLACK_BOT_TOKEN=xoxb-<your Slack bot token>"
	echo "  Also set it as a Wrangler secret so the Worker can send replies:"
	echo "    (cd packages/worker && wrangler secret put SLACK_BOT_TOKEN)"
	echo
fi
if ! grep -q '^SLACK_APP_TOKEN=' "$ENV_FILE"; then
	echo
	echo "  REMINDER: Socket Mode needs an app-level token. Add it to $ENV_FILE:"
	echo "    SLACK_APP_TOKEN=xapp-<token with connections:write>"
	echo "  (Slack app → Basic Information → App-Level Tokens — see README.md)"
	echo
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
	"$SCRIPT_DIR/com.fermi.sl-bridge.plist" >"$PLIST_DEST"
launchctl bootout "gui/$UID/com.fermi.sl-bridge" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_DEST"

echo "installed: LaunchAgent com.fermi.sl-bridge (running)"
echo "  logs:      $DAEMON_HOME/logs/sl-bridge.log"
echo "  restart:   launchctl kickstart -k gui/\$UID/com.fermi.sl-bridge"
echo "  uninstall: launchctl bootout gui/\$UID/com.fermi.sl-bridge && rm $PLIST_DEST"
