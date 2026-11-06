#!/usr/bin/env bash
# Add or update ONE Cube model file in the production Cube on 10.6.2.34 (the one the dashboard uses, :4002), safely.
#
#   vw-rca-cube/scripts/deploy-cube-model.sh <ssh-user> vw-rca-cube/cube/model-vibrant/cubes/fz_scores.yml
#
# What it does, in order (stops at the first problem; production is untouched until step 4):
#   0. Finds the container that publishes port 4002 and its model folder from the container's own mounts (names on
#      the server have drifted from the docs: on 2026-11-05 `cube-rca-cube-rca-1` / ~/cube-rca/model held the
#      separate thiru_normalized_v2 Cube, not production). Refuses unless that folder defines `rfm_orders` on disk,
#      so it can never deploy to the wrong Cube or restart a Cube whose files no longer match what it is serving.
#   1. Checks the file is committed (what runs in production must be in git).
#   2. Compiles the server's CURRENT model folder + your file inside the running Cube container, with the
#      server's exact Cube version. A compile error here would otherwise break EVERY cube, not just yours.
#   3. Backs up the model folder to <its parent>/model-backups/<timestamp>/ (outside the model folder, because Cube
#      loads every file under it).
#   4. Copies the file in, restarts only the Cube API container, waits for /readyz.
#   5. If Cube does not come back, restores the backup and restarts again (automatic rollback).
# Afterwards: node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
set -euo pipefail

SSH_USER="${1:?usage: deploy-cube-model.sh <ssh-user> <path/to/model.yml>}"
FILE="${2:?usage: deploy-cube-model.sh <ssh-user> <path/to/model.yml>}"

HOST=10.6.2.34
PORT=4002          # the Cube the dashboard engines use (CUBE_API_URL=http://10.6.2.34:4002)
NAME="$(basename "$FILE")"
TS="$(date +%Y%m%d-%H%M%S)"

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
mkdir -p "$HOME/.ssh"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%C" -o ControlPersist=15m)
rsh() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "$@"; }

# ---------------------------------------------------------------------------------------------------------
step "1. Checking $FILE"
[ -f "$FILE" ] || die "no such file: $FILE"
case "$NAME" in *.yml|*.yaml) ;; *) die "expected a .yml/.yaml Cube model file" ;; esac
git ls-files --error-unmatch "$FILE" >/dev/null 2>&1 || die "$FILE is not committed; commit it first"
git diff --quiet HEAD -- "$FILE" || die "$FILE has uncommitted changes; commit them first"
echo "    committed at $(git log -1 --format='%h %s' -- "$FILE")"

step "0. Finding the Cube on $HOST:$PORT (you may be asked for the server password once)"
CONTAINER="$(rsh "docker ps --filter publish=$PORT --format '{{.Names}}'")"
[ -n "$CONTAINER" ] || die "no running container publishes port $PORT on $HOST"
[ "$(printf '%s\n' "$CONTAINER" | wc -l | tr -d ' ')" = 1 ] || die "more than one container publishes $PORT: $CONTAINER"
MODEL_DIR="$(rsh "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/cube/conf/model\"}}{{.Source}}{{end}}{{end}}' $CONTAINER")"
[ -n "$MODEL_DIR" ] || die "$CONTAINER has no bind mount at /cube/conf/model; deploy by hand with the admin"
CUBE_DIR="$(dirname "$MODEL_DIR")"
SUB=""; rsh "test -d $MODEL_DIR/cubes" && SUB="cubes/"
TARGET="$MODEL_DIR/$SUB$NAME"
rsh "grep -rqsE '^[[:space:]]*-?[[:space:]]*name:[[:space:]]*rfm_orders[[:space:]]*\$' $MODEL_DIR" || die "$MODEL_DIR does not define rfm_orders on disk, but the dashboard's Cube serves it.
       Either this is not the dashboard's model folder, or the running Cube is stale and a restart would break
       production. Stop and check with the Cube owner before any restart."
rsh "curl -sf -o /dev/null http://localhost:$PORT/readyz" || die "Cube on $HOST:$PORT is not healthy right now (or curl is missing); not deploying"
echo "    container : $CONTAINER (started $(rsh "docker inspect -f '{{.State.StartedAt}}' $CONTAINER"))"
echo "    model dir : $MODEL_DIR ($(rsh "find $MODEL_DIR -type f -name '*.y*ml' | wc -l" | tr -d ' ') model files)"
echo "    new file  : $TARGET"
echo "    Cube      : $(rsh "docker exec $CONTAINER node -p \"require('/cube/node_modules/@cubejs-backend/server-core/package.json').version\"" 2>/dev/null || echo unknown)"
if rsh "test -f $TARGET"; then
  echo "    $NAME already exists on the server; differences (server → yours):"
  rsh "cat $TARGET" | diff - "$FILE" | head -40 || true
fi
read -rp "    Is this the production Cube you meant to change? [y/N] " a; [ "$a" = y ] || die "stopped; nothing changed"

# ---------------------------------------------------------------------------------------------------------
step "2. Compiling server model + $NAME inside $CONTAINER (nothing changes yet)"
rsh "docker exec $CONTAINER sh -c 'rm -rf /tmp/model-check && cp -r /cube/conf/model /tmp/model-check'"
scp "${SSH_OPTS[@]}" -q "$FILE" "$SSH_USER@$HOST:/tmp/$NAME.$TS"
rsh "docker cp /tmp/$NAME.$TS $CONTAINER:/tmp/model-check/$SUB$NAME"
rsh "docker exec -i -w /cube $CONTAINER node -" <<'JS' || die "compile failed: production NOT changed (see errors above)"
const fs = require('fs'), path = require('path');
const { prepareCompiler } = require('@cubejs-backend/schema-compiler');
const root = '/tmp/model-check', files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p);
  else if (/\.(ya?ml|js)$/.test(f)) files.push({ fileName: path.relative(root, p), content: fs.readFileSync(p, 'utf8') }); } })(root);
const c = prepareCompiler({ localPath: () => root, dataSchemaFiles: async () => files },
                          { adapter: process.env.CUBEJS_DB_TYPE || 'bigquery' });
c.compiler.compile()
  .then(() => console.log(`    compiled OK: ${files.length} files`))
  .catch(e => { console.error(e.messages || e.message || e); process.exit(1); });
JS

# ---------------------------------------------------------------------------------------------------------
step "3. Backing up $MODEL_DIR to $CUBE_DIR/model-backups/$TS"
rsh "mkdir -p $CUBE_DIR/model-backups && cp -a $MODEL_DIR $CUBE_DIR/model-backups/$TS"
ROLLBACK="ssh $SSH_USER@$HOST 'rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR && docker restart $CONTAINER'"

step "4. Installing $NAME and restarting $CONTAINER (Cube is unavailable for ~10–30 s)"
rsh "install -m 644 /tmp/$NAME.$TS $TARGET && rm -f /tmp/$NAME.$TS && docker restart $CONTAINER >/dev/null"
ok=
for _ in $(seq 1 60); do
  if rsh "curl -sf -o /dev/null http://localhost:$PORT/readyz"; then ok=1; break; fi
  sleep 3
done
if [ -z "$ok" ]; then
  step "5. Cube did not come back: rolling back"
  rsh "rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR && docker restart $CONTAINER >/dev/null"
  die "rolled back to the backup. Logs: ssh $SSH_USER@$HOST 'docker logs --since 5m $CONTAINER'"
fi
echo "    Cube is ready"
echo "    recent errors in the Cube log (none is good):"
rsh "docker logs --since 2m $CONTAINER 2>&1 | grep -iE 'error|fail' | tail -10" || true

cat <<EOF

Done. The pre-aggregations build in the background on the next refresh cycle (a few minutes).
Check:     cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
Rollback:  $ROLLBACK
EOF
