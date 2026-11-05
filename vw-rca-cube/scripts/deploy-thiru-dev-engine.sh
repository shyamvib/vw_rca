#!/usr/bin/env bash
# Deploy (or redeploy) Thiru's dev engine to 10.6.2.34. Walkthrough: HOSTING_THIRU_DEV.md, section 6.
#
#   vw-rca-cube/scripts/deploy-thiru-dev-engine.sh <ssh-user>               # deploy; first run also configures
#   vw-rca-cube/scripts/deploy-thiru-dev-engine.sh <ssh-user> --configure   # re-enter secrets / change passwords
#
# Configure step (first run, or --configure): asks for every secret with hidden input, checks the Cube secret
# and the Convex key before using them, sets the password hashes in your Convex (dev + prod), and writes
# ~/rca-engine-thiru/.env.dev on the server (mode 600). Secrets never go on a command line, into the repo or
# onto this Mac's disk. Later runs reuse the server's .env.dev and only ship the code committed on thiru_dev_main.
set -euo pipefail

SSH_USER="${1:?usage: deploy-thiru-dev-engine.sh <ssh-user> [--configure]}"
CONFIGURE="${2:-}"

HOST=10.6.2.34
TARGET="$SSH_USER@$HOST"
REMOTE_DIR=rca-engine-thiru
REF=thiru_dev_main
CUBE_URL=http://10.6.2.34:4002
CONVEX_DEPLOYMENT=tangible-leopard-228
CONVEX_URL="https://$CONVEX_DEPLOYMENT.convex.cloud"
VERCEL_ORIGIN=https://vw-rca-thiru-dev.vercel.app
COMPOSE="docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev"

ROOT="$(git rev-parse --show-toplevel)"
APP="$ROOT/vw-rca-cube"
mkdir -p "$HOME/.ssh"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%C" -o ControlPersist=15m)
rsh() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

ask_secret() { # ask_secret VAR "Prompt" [confirm]
  local a b
  while :; do
    read -rsp "$2: " a; echo
    [ -n "$a" ] || { echo "  (empty, try again)"; continue; }
    if [ "${3:-}" = confirm ]; then
      read -rsp "  Type it again: " b; echo
      [ "$a" = "$b" ] || { echo "  Did not match, try again."; continue; }
    fi
    break
  done
  printf -v "$1" '%s' "$a"
}

sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

# ---------------------------------------------------------------------------------------------------------
step "Connecting to $TARGET (you may be asked for your server password once)"
rsh 'docker compose version >/dev/null 2>&1 || exit 3; docker ps >/dev/null 2>&1 || exit 4' || {
  case $? in
    3) die "Docker Compose is not available for $SSH_USER on $HOST." ;;
    4) die "$SSH_USER cannot run docker on $HOST (needs to be in the 'docker' group; ask the server admin)." ;;
    *) die "Could not log in to $TARGET over SSH." ;;
  esac
}
echo "    connected; docker is available"

step "Checking free memory on the server (the engine is capped at 3 GB)"
rsh "free -h | sed -n '1,2p'" || true

if [ "$CONFIGURE" = "--configure" ] || ! rsh "test -f $REMOTE_DIR/.env.dev"; then
  step "Configure: enter your secrets (nothing you type is shown)"
  ask_secret CUBE_SECRET   "Cube API secret (from Shyam)"
  ask_secret CONVEX_KEY    "Convex PRODUCTION deploy key for vw-rca-thiru"
  ask_secret DASH_PW       "Dashboard (sign-in) password - choose a long one" confirm
  ask_secret ADMIN_PW      "Admin (Settings) password - different from the sign-in one" confirm

  case "$CONVEX_KEY" in
    "prod:$CONVEX_DEPLOYMENT|"*) ;;
    *) die "That deploy key is not for your project's production deployment ($CONVEX_DEPLOYMENT). Generate it at:
  https://dashboard.convex.dev/t/thirunarayanan-raman/vw-rca-thiru/$CONVEX_DEPLOYMENT/settings" ;;
  esac
  [ "$DASH_PW" != "$ADMIN_PW" ] || die "Use different passwords for sign-in and admin."

  step "Checking the Cube secret against $CUBE_URL"
  CUBE_SECRET="$CUBE_SECRET" CUBE_URL="$CUBE_URL" node -e '
    const c = require("crypto"), b = x => Buffer.from(x).toString("base64url"), n = Math.floor(Date.now() / 1000);
    const h = b(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b(JSON.stringify({ iat: n, exp: n + 300, app: "vw-rca" }));
    const s = c.createHmac("sha256", process.env.CUBE_SECRET).update(h + "." + p).digest("base64url");
    fetch(process.env.CUBE_URL + "/cubejs-api/v1/meta", { headers: { Authorization: h + "." + p + "." + s } })
      .then(r => { console.log("    Cube answered HTTP " + r.status); process.exit(r.status === 200 ? 0 : 1); })
      .catch(() => { console.log("    Cube is not reachable from this Mac (VPN?)"); process.exit(2); });
  ' || {
    [ $? -eq 2 ] && die "Cannot reach Cube from this Mac. Connect to the VPN and run again."
    die "Cube rejected that secret. Check it with Shyam and run again."
  }

  step "Setting the password hashes in your Convex (dev and prod)"
  DASH_HASH="$(sha "$DASH_PW")"; ADMIN_HASH="$(sha "$ADMIN_PW")"
  (
    cd "$APP"
    npx convex env set DASHBOARD_PASSWORD_SHA256 "$DASH_HASH" >/dev/null
    npx convex env set ADMIN_PASSWORD_SHA256 "$ADMIN_HASH" >/dev/null
    npx convex env set --prod DASHBOARD_PASSWORD_SHA256 "$DASH_HASH" >/dev/null
    npx convex env set --prod ADMIN_PASSWORD_SHA256 "$ADMIN_HASH" >/dev/null
  )
  echo "    done"

  step "Writing $REMOTE_DIR/.env.dev on the server (mode 600)"
  ADMIN_SECRET="$(openssl rand -hex 24)"
  rsh "mkdir -p $REMOTE_DIR && umask 077 && cat > $REMOTE_DIR/.env.dev && chmod 600 $REMOTE_DIR/.env.dev" <<EOF
# Written by scripts/deploy-thiru-dev-engine.sh on $(date -u +%Y-%m-%dT%H:%MZ). Re-run it with --configure to change.
CUBE_API_URL=$CUBE_URL
CUBE_API_SECRET=$CUBE_SECRET
CONVEX_URL=$CONVEX_URL
CONVEX_ADMIN_KEY=$CONVEX_KEY
DASHBOARD_PASSWORD_SHA256=$DASH_HASH
ADMIN_PASSWORD_SHA256=$ADMIN_HASH
ADMIN_SECRET=$ADMIN_SECRET
ALLOWED_ORIGINS=$VERCEL_ORIGIN
EOF
  unset CUBE_SECRET CONVEX_KEY DASH_PW ADMIN_PW ADMIN_SECRET
  echo "    done (ADMIN_SECRET is stored only there: ssh $TARGET \"grep ADMIN_SECRET $REMOTE_DIR/.env.dev\")"
else
  step "Reusing the existing $REMOTE_DIR/.env.dev on the server (run with --configure to change it)"
fi

# ---------------------------------------------------------------------------------------------------------
step "Packaging the engine from $REF"
git -C "$ROOT" fetch -q thiru "$REF" 2>/dev/null || true
if [ "$(git -C "$ROOT" rev-parse "$REF")" != "$(git -C "$ROOT" rev-parse "thiru/$REF" 2>/dev/null || echo none)" ]; then
  echo "    note: local $REF differs from thiru/$REF on GitHub; deploying the LOCAL branch"
fi
TMPD="$(mktemp -d)"
TGZ="$TMPD/rca-engine.tgz"
trap 'rm -rf "$TMPD"' EXIT
"$APP/scripts/build-engine-tarball.sh" "$REF" "$TGZ" | sed 's/^/    /'

step "Uploading and starting the containers (first build takes a few minutes)"
scp -q "${SSH_OPTS[@]}" "$TGZ" "$TARGET:$REMOTE_DIR/rca-engine.tgz"
rsh "cd $REMOTE_DIR && tar -xzf rca-engine.tgz && rm rca-engine.tgz && { $COMPOSE up -d --build > deploy.log 2>&1 || { tail -30 deploy.log; exit 1; }; } && tail -3 deploy.log" \
  || die "Container build/start failed (last lines above; full log in ~/$REMOTE_DIR/deploy.log on the server)."

step "Waiting for the public tunnel address"
URL=""
for _ in $(seq 1 40); do
  URL="$(rsh "docker logs rca-engine-thiru 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1" || true)"
  [ -n "$URL" ] && break
  sleep 3
done
[ -n "$URL" ] || die "No tunnel address after 2 minutes. Check: ssh $TARGET 'docker logs --tail 50 rca-engine-thiru'"
echo "    $URL"

step "Waiting for the data snapshot (first build from Cube takes about a minute)"
for _ in $(seq 1 60); do
  H="$(curl -s -m 10 "$URL/health" || true)"
  case "$H" in *'"ok":true'*|*'"lastBuild":{"ok":false'*) break ;; esac
  sleep 5
done
echo "    /health: $H"
case "$H" in
  *'"ok":true'*) ;;
  *) die "Engine is up but has no snapshot yet. Check: ssh $TARGET 'docker logs --tail 80 rca-engine-thiru'" ;;
esac

step "Checking that your Convex knows the new address"
ANNOUNCED="$(cd "$APP" && npx convex run --prod ops:serviceUrl 2>/dev/null | tr -d '"' || true)"
if [ "$ANNOUNCED" = "$URL" ]; then echo "    yes"; else echo "    Convex has: ${ANNOUNCED:-nothing} (expected $URL); it should update within a minute"; fi

printf '\nDone. Open %s and sign in with your work email and the sign-in password.\n' "$VERCEL_ORIGIN"
