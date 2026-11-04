#!/usr/bin/env bash
# Build the analytics engine tarball from a commit: the same files the Docker image copies (analytics/, engine/, package files).
#   scripts/build-engine-tarball.sh [ref] [out.tgz]       default: HEAD, ./rca-engine.tgz
# Only committed files go in. engine/VERSION in the tarball is stamped with the commit (git export-subst), so the running
# service reports it on /health. Use this script rather than `git archive HEAD:vw-rca-cube ...`, which does not stamp it.
set -euo pipefail
REF="${1:-HEAD}"
OUT="$(cd "$(dirname "${2:-rca-engine.tgz}")" && pwd)/$(basename "${2:-rca-engine.tgz}")"
cd "$(git rev-parse --show-toplevel)"
if [ "$REF" = HEAD ] && ! git diff --quiet HEAD -- vw-rca-cube/analytics vw-rca-cube/engine vw-rca-cube/package.json vw-rca-cube/package-lock.json; then
  echo "warning: uncommitted changes in the engine files are NOT in this tarball (it is built from the commit)" >&2
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Archive from the repo root so the export-subst attribute applies, then repack with the files at the top level.
git archive "$REF" vw-rca-cube/.dockerignore vw-rca-cube/analytics vw-rca-cube/engine vw-rca-cube/package.json vw-rca-cube/package-lock.json | tar -x -C "$TMP"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$TMP/vw-rca-cube" .dockerignore analytics engine package.json package-lock.json
echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
echo "engine/VERSION: $(tar -xzOf "$OUT" engine/VERSION)"
