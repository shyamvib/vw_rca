#!/usr/bin/env bash
# Run Thiru's dev engine on this Mac (all compute local; only the shared Cube on 10.6.2.34 is used remotely).
# Walkthrough: HOSTING_THIRU_DEV.md, section 6a.
#
#   scripts/thiru-local-engine.sh setup <ssh-user>   # once: copy secrets from the server engine, stop that engine
#   scripts/thiru-local-engine.sh start              # install + start the background service (survives logout/reboot)
#   scripts/thiru-local-engine.sh stop               # stop it (the shared dashboard goes offline)
#   scripts/thiru-local-engine.sh status             # is it up, which address does Convex have
#   scripts/thiru-local-engine.sh logs               # follow the engine log
#
# The service runs under launchd with KeepAlive (restarts on crash) inside `caffeinate -is`, which stops the Mac
# idle-sleeping. Closing the lid still sleeps it (unless on power with an external display), and the dashboard is then
# offline for everyone until the Mac wakes.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP/.env.engine.local"               # git-ignored (.env*)
DATA_DIR="$HOME/.rca-engine-thiru/data"         # clinic-level snapshot: outside the repo
LOG="$HOME/Library/Logs/rca-engine-thiru.log"
LABEL=com.thiruvibrant.rca-engine
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
NODE="$(command -v node || true)"
CLOUDFLARED="$(command -v cloudflared || true)"
VERCEL_ORIGIN=https://vw-rca-thiru-dev.vercel.app

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
setup)
  SSH_USER="${2:?usage: thiru-local-engine.sh setup <ssh-user>}"
  [ -n "$CLOUDFLARED" ] || die "cloudflared is not installed: brew install cloudflared"
  echo "==> Copying your engine settings from 10.6.2.34 into $ENV_FILE (nothing is shown)"
  umask 077
  ssh "$SSH_USER@10.6.2.34" 'cat rca-engine-thiru/.env.dev' \
    | grep -vE '^(ALLOWED_ORIGINS|TUNNEL|DATA_DIR|CLOUDFLARED_BIN|PORT)=' > "$ENV_FILE.tmp"
  grep -q '^CUBE_API_SECRET=.' "$ENV_FILE.tmp" || { rm -f "$ENV_FILE.tmp"; die "copied file has no CUBE_API_SECRET"; }
  grep -q '^CONVEX_URL=https://tangible-leopard-228' "$ENV_FILE.tmp" || { rm -f "$ENV_FILE.tmp"; die "CONVEX_URL is not your project"; }
  cat >> "$ENV_FILE.tmp" <<EOF
# Added by thiru-local-engine.sh for running on this Mac
TUNNEL=1
CLOUDFLARED_BIN=$CLOUDFLARED
DATA_DIR=$DATA_DIR
ALLOWED_ORIGINS=$VERCEL_ORIGIN,http://localhost:5173
EOF
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  echo "    done"
  echo "==> Stopping the engine on the server so only one engine announces itself to Convex"
  ssh "$SSH_USER@10.6.2.34" 'docker stop rca-engine-thiru >/dev/null && echo "    stopped rca-engine-thiru (data volume and .env.dev kept for fallback)"'
  echo "Next: $0 start"
  ;;
start)
  [ -f "$ENV_FILE" ] || die "run '$0 setup <ssh-user>' first"
  [ -n "$NODE" ] || die "node is not installed"
  [ -x "$APP/node_modules/.bin/tsx" ] || die "dependencies missing: (cd '$APP' && npm install --no-package-lock)"
  mkdir -p "$DATA_DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-is</string>
    <string>$NODE</string><string>--env-file=$ENV_FILE</string><string>--import</string><string>tsx</string>
    <string>engine/server.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "==> Started. Waiting for the public address..."
  for _ in $(seq 1 30); do
    URL="$(grep -o 'tunnel up: https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 | cut -d' ' -f3)"
    [ -n "$URL" ] && curl -s -m 5 "$URL/health" | grep -q '"code"' && break
    sleep 3
  done
  echo "    engine: ${URL:-not up yet, see: $0 logs}"
  echo "    share:  $VERCEL_ORIGIN"
  ;;
stop)
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && echo "stopped" || echo "not running"
  ;;
status)
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^\s*(state|pid) =' || echo "service not loaded"
  echo "local /health: $(curl -s -m 5 http://localhost:8787/health || echo 'no answer')"
  echo "Convex has:    $(cd "$APP" && npx convex run --prod ops:serviceUrl 2>/dev/null | tr -d '"')"
  ;;
logs)
  tail -n 50 -f "$LOG"
  ;;
*)
  sed -n '2,13p' "$0"; exit 1 ;;
esac
