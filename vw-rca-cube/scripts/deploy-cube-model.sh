#!/usr/bin/env bash
# Put Cube model files into the production Cube on 10.6.2.34 (the one the dashboard uses, :4002), safely.
#
#   # copy files onto the server's disk only (Cube keeps running untouched; the NEXT restart loads them):
#   vw-rca-cube/scripts/deploy-cube-model.sh <ssh-user> --no-restart <file.yml> [<file.yml> ...]
#   # copy and restart now (refused if the restart would drop any cube or view that is live today):
#   vw-rca-cube/scripts/deploy-cube-model.sh <ssh-user> <file.yml> [<file.yml> ...]
#
# Why this exists: Cube reads its model folder only when it starts, and keeps it in memory. On 2026-11-05 the
# production folder (~/cube-rca/model) no longer held the files the live Cube was serving (rfm_orders, customers,
# journey, ... and the RevOps views): a restart would have dropped them. Every step below guards against that.
#
# Steps (stops at the first problem; nothing on the server changes before step 3):
#   0. Finds the container that publishes :4002 and its model folder from the container's own mounts.
#   1. Checks every file is committed (what runs in production must be in git).
#   2. Compiles the server's folder + your files inside the running Cube container (exact server Cube version),
#      and lists every cube/view that folder would serve after a restart vs. what is live now.
#   3. Backs up the folder to <parent>/model-backups/<timestamp>/ (outside the folder: Cube loads all of it),
#      then copies the files in.
#   4. Only without --no-restart, and only if nothing live would disappear: restarts the Cube API container,
#      waits for /readyz, checks every previously live cube/view is still served, and restores the backup +
#      restarts again if not.
set -euo pipefail

usage="usage: deploy-cube-model.sh <ssh-user> [--no-restart] <file.yml> [<file.yml> ...]"
SSH_USER="${1:?$usage}"; shift
RESTART=1
if [ "${1:-}" = "--no-restart" ]; then RESTART=; shift; fi
[ $# -ge 1 ] || { echo "$usage" >&2; exit 2; }
FILES=("$@")

HOST=10.6.2.34
PORT=4002          # the Cube the dashboard engines use (CUBE_API_URL=http://10.6.2.34:4002)
TS="$(date +%Y%m%d-%H%M%S)"
APP="$(git rev-parse --show-toplevel)/vw-rca-cube"

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
mkdir -p "$HOME/.ssh"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%C" -o ControlPersist=15m)
rsh() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "$@"; }
live_names() { (cd "$APP" && node --env-file=.env.engine.local --import tsx scripts/cube-live-names.ts); }
count() { printf '%s\n' "$1" | grep -c . || true; }

# ---------------------------------------------------------------------------------------------------------
step "1. Checking ${#FILES[@]} file(s)"
NAMES=()
for f in "${FILES[@]}"; do
  [ -f "$f" ] || die "no such file: $f"
  n="$(basename "$f")"
  case "$n" in *.yml|*.yaml) ;; *) die "$f: expected a .yml/.yaml Cube model file" ;; esac
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 || die "$f is not committed; commit it first"
  git diff --quiet HEAD -- "$f" || die "$f has uncommitted changes; commit them first"
  echo "    $n  ($(git log -1 --format='%h' -- "$f"))"
  NAMES+=("$n")
done
LIVE="$(live_names)" || die "could not read the live Cube's cube list (needs vw-rca-cube/.env.engine.local)"
echo "    live Cube serves $(count "$LIVE") cubes/views right now"

step "0. Finding the Cube on $HOST:$PORT (you may be asked for the server password once)"
CONTAINER="$(rsh "docker ps --filter publish=$PORT --format '{{.Names}}'")"
[ -n "$CONTAINER" ] || die "no running container publishes port $PORT on $HOST"
[ "$(count "$CONTAINER")" = 1 ] || die "more than one container publishes $PORT: $CONTAINER"
MODEL_DIR="$(rsh "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/cube/conf/model\"}}{{.Source}}{{end}}{{end}}' $CONTAINER")"
[ -n "$MODEL_DIR" ] || die "$CONTAINER has no bind mount at /cube/conf/model; deploy by hand with the admin"
CUBE_DIR="$(dirname "$MODEL_DIR")"
SUB=""; rsh "test -d $MODEL_DIR/cubes" && SUB="cubes/"
rsh "curl -sf -o /dev/null http://localhost:$PORT/readyz" || die "Cube on $HOST:$PORT is not healthy right now (or curl is missing); not deploying"
echo "    container : $CONTAINER (started $(rsh "docker inspect -f '{{.State.StartedAt}}' $CONTAINER"))"
echo "    model dir : $MODEL_DIR ($(rsh "find $MODEL_DIR -type f -name '*.y*ml' | wc -l" | tr -d ' ') model files now)"
echo "    files go  : $MODEL_DIR/$SUB"
echo "    Cube      : $(rsh "docker exec $CONTAINER node -p \"require('/cube/node_modules/@cubejs-backend/server-core/package.json').version\"" 2>/dev/null || echo unknown)"
for i in "${!FILES[@]}"; do
  if rsh "test -f $MODEL_DIR/$SUB${NAMES[$i]}"; then
    if rsh "cat $MODEL_DIR/$SUB${NAMES[$i]}" | cmp -s - "${FILES[$i]}"; then
      echo "    ${NAMES[$i]}: already on the server, identical"
    else
      echo "    ${NAMES[$i]}: already on the server and DIFFERENT (server → yours):"
      rsh "cat $MODEL_DIR/$SUB${NAMES[$i]}" | diff - "${FILES[$i]}" | head -30 || true
    fi
  fi
done

# ---------------------------------------------------------------------------------------------------------
step "2. Compiling the folder + your files inside $CONTAINER (nothing changes yet)"
rsh "docker exec $CONTAINER sh -c 'rm -rf /tmp/model-check && cp -r /cube/conf/model /tmp/model-check && mkdir -p /tmp/model-check/$SUB'"
for i in "${!FILES[@]}"; do
  scp "${SSH_OPTS[@]}" -q "${FILES[$i]}" "$SSH_USER@$HOST:/tmp/${NAMES[$i]}.$TS"
  rsh "docker cp /tmp/${NAMES[$i]}.$TS $CONTAINER:/tmp/model-check/$SUB${NAMES[$i]}"
done
AFTER="$(rsh "docker exec -i -w /cube $CONTAINER node -" <<'JS'
const fs = require('fs'), path = require('path');
const { prepareCompiler } = require('@cubejs-backend/schema-compiler');
const root = '/tmp/model-check', files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p);
  else if (/\.(ya?ml|js)$/.test(f)) files.push({ fileName: path.relative(root, p), content: fs.readFileSync(p, 'utf8') }); } })(root);
const c = prepareCompiler({ localPath: () => root, dataSchemaFiles: async () => files },
                          { adapter: process.env.CUBEJS_DB_TYPE || 'bigquery' });
c.compiler.compile()
  .then(() => { console.error(`    compiled OK: ${files.length} files`); for (const n of c.cubeEvaluator.cubeNames()) console.log(n); })
  .catch(e => { console.error(e.messages || e.message || e); process.exit(1); });
JS
)" || die "compile failed: nothing on the server changed (see errors above)"

MISSING="$(comm -23 <(printf '%s\n' "$LIVE" | sort -u) <(printf '%s\n' "$AFTER" | sort -u))"
ADDED="$(comm -13 <(printf '%s\n' "$LIVE" | sort -u) <(printf '%s\n' "$AFTER" | sort -u))"
echo "    after a restart this folder would serve $(count "$AFTER") cubes/views (live now: $(count "$LIVE"))"
[ -z "$ADDED" ] || echo "    a restart would ADD $(count "$ADDED"): $(printf '%s ' $ADDED | cut -c1-300)"
if [ -n "$MISSING" ]; then
  echo "    a restart would DROP $(count "$MISSING") live cubes/views:"
  printf '%s\n' "$MISSING" | sed -n 1,12p | sed 's/^/      /'
  [ "$(count "$MISSING")" -le 12 ] || echo "      ..."
else
  echo "    a restart would keep every live cube/view"
fi

if [ -n "$RESTART" ] && [ -n "$MISSING" ]; then
  die "not restarting, and nothing changed: a restart would drop the live cubes/views listed above.
       Put their files back first (add them to this command), or agree with their owner.
       To only copy files without a restart, add --no-restart."
fi
read -rp "    Copy these file(s) into $MODEL_DIR/$SUB on $HOST? [y/N] " a; [ "$a" = y ] || die "stopped; nothing changed"

# ---------------------------------------------------------------------------------------------------------
step "3. Backing up $MODEL_DIR to $CUBE_DIR/model-backups/$TS, then copying the files in"
rsh "mkdir -p $CUBE_DIR/model-backups && cp -a $MODEL_DIR $CUBE_DIR/model-backups/$TS"
for n in "${NAMES[@]}"; do
  rsh "install -m 644 /tmp/$n.$TS $MODEL_DIR/$SUB$n && rm -f /tmp/$n.$TS"
done
echo "    on disk now in $MODEL_DIR/$SUB: $(rsh "ls $MODEL_DIR/$SUB" | tr '\n' ' ')"
UNDO_COPY="ssh $SSH_USER@$HOST 'rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR'"
ROLLBACK="ssh $SSH_USER@$HOST 'rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR && docker restart $CONTAINER'"

if [ -z "$RESTART" ]; then
  echo
  echo "Done (no restart). The live Cube is unchanged; the files above are what its NEXT restart will load."
  [ -z "$MISSING" ] || echo "Not yet safe to restart: the $(count "$MISSING") cubes/views listed as DROP above still have no file."
  echo "Undo the copy: $UNDO_COPY"
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------
[ -z "$MISSING" ] || die "files copied, but NOT restarting: a restart would drop the live cubes/views listed above.
       Put their files back first (rerun with them), or agree with their owner. Undo the copy with:
       $UNDO_COPY"
step "4. Restarting $CONTAINER (Cube is unavailable for ~10–30 s)"
rsh "docker restart $CONTAINER >/dev/null"
ok=
for _ in $(seq 1 60); do
  if rsh "curl -sf -o /dev/null http://localhost:$PORT/readyz"; then ok=1; break; fi
  sleep 3
done
if [ -z "$ok" ]; then
  step "Cube did not come back: rolling back"
  rsh "rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR && docker restart $CONTAINER >/dev/null"
  die "rolled back to the backup. Logs: ssh $SSH_USER@$HOST 'docker logs --since 5m $CONTAINER'"
fi
NOW="$(live_names)" || NOW=""
GONE="$(comm -23 <(printf '%s\n' "$LIVE" | sort -u) <(printf '%s\n' "$NOW" | sort -u))"
if [ -n "$GONE" ]; then
  step "Live cubes/views disappeared after the restart: rolling back"
  printf '%s\n' "$GONE" | sed -n 1,12p | sed 's/^/      /'
  rsh "rm -rf $MODEL_DIR && cp -a $CUBE_DIR/model-backups/$TS $MODEL_DIR && docker restart $CONTAINER >/dev/null"
  die "rolled back to the backup"
fi
echo "    Cube is ready and still serves every cube/view it served before ($(count "$NOW") now)"
echo
echo "Done. Pre-aggregations for new cubes build in the background over the next few minutes."
echo "Check:     cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts"
echo "Rollback:  $ROLLBACK"
