#!/usr/bin/env bash
# Add or update ONE Cube model file in the production Cube (cube-rca on 10.6.2.34), safely.
#
#   vw-rca-cube/scripts/deploy-cube-model.sh <ssh-user> vw-rca-cube/cube/model-vibrant/cubes/fz_scores.yml
#
# What it does, in order (stops at the first problem; production is untouched until step 4):
#   1. Checks the file is committed (what runs in production must be in git).
#   2. Compiles the server's CURRENT model folder + your file inside the running Cube container, with the
#      server's exact Cube version. A compile error here would otherwise break EVERY cube, not just yours.
#   3. Backs up the server's model folder to ~/cube-rca/model-backups/<timestamp>/ (outside model/, because Cube
#      loads every file under model/).
#   4. Copies the file in, restarts only the Cube API container, waits for /readyz.
#   5. If Cube does not come back, restores the backup and restarts again (automatic rollback).
# Afterwards: node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
set -euo pipefail

SSH_USER="${1:?usage: deploy-cube-model.sh <ssh-user> <path/to/model.yml>}"
FILE="${2:?usage: deploy-cube-model.sh <ssh-user> <path/to/model.yml>}"

HOST=10.6.2.34
CUBE_DIR=/home/shyam/cube-rca
MODEL_DIR="$CUBE_DIR/model"
CONTAINER=cube-rca-cube-rca-1
PORT=4002
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

step "Connecting to $SSH_USER@$HOST (you may be asked for the server password once)"
rsh "test -d $MODEL_DIR/cubes && docker inspect -f '{{.State.Running}}' $CONTAINER" | grep -q true \
  || die "$MODEL_DIR/cubes or a running $CONTAINER not found on $HOST"
rsh "curl -sf -o /dev/null http://localhost:$PORT/readyz" || die "Cube on $HOST:$PORT is not healthy right now (or curl is missing); not deploying"
echo "    Cube version: $(rsh "docker exec $CONTAINER node -p \"require('/cube/node_modules/@cubejs-backend/server-core/package.json').version\"" 2>/dev/null || echo unknown)"
if rsh "test -f $MODEL_DIR/cubes/$NAME"; then
  echo "    $NAME already exists on the server; differences (server → yours):"
  rsh "cat $MODEL_DIR/cubes/$NAME" | diff - "$FILE" | head -40 || true
  read -rp "    Replace it? [y/N] " a; [ "$a" = y ] || die "stopped"
fi

# ---------------------------------------------------------------------------------------------------------
step "2. Compiling server model + $NAME inside $CONTAINER (nothing changes yet)"
rsh "docker exec $CONTAINER sh -c 'rm -rf /tmp/model-check && cp -r /cube/conf/model /tmp/model-check'"
scp "${SSH_OPTS[@]}" -q "$FILE" "$SSH_USER@$HOST:/tmp/$NAME.$TS"
rsh "docker cp /tmp/$NAME.$TS $CONTAINER:/tmp/model-check/cubes/$NAME"
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
rsh "install -m 644 /tmp/$NAME.$TS $MODEL_DIR/cubes/$NAME && rm -f /tmp/$NAME.$TS && docker restart $CONTAINER >/dev/null"
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
