# Running your own copy (developers)

A developer runs a complete, independent stack and shares only Cube with everyone else:

```
your browser ─► your Vercel project (or `npm run dev`)
                    │  VITE_CONVEX_URL
                    ├─► your Convex deployment   logins, Settings, plans (own data, own keys)
                    └─► your engine (this repo)  serves your own snapshot
                            └─► Cube (shared, read-only) ─► BigQuery
```

Nothing you do here touches production, as long as you never use a production key (see "Rules" at the end).

Status: the engine start-up, `/health` and the version stamp were run for this doc. The Convex, Cube and Vercel steps follow the existing deploy notes in `DEPLOY_VERCEL_CONVEX.md` and have not been run end to end on a clean machine, so expect to fix small things and send them back as edits to this file.

## You need
- Node 22 and npm. `cloudflared` only if you want your Vercel project to reach an engine on your laptop (step 4).
- A snapshot (step 2). Either copy one from the production server, or build your own, which needs the Cube URL and API secret (ask whoever runs `cube-rca`; the Cube host is on the internal network, so be on the VPN or have a tunnel to it). Copying needs ssh to the server and no Cube access at all.
- Your own Convex account and, optionally, your own Vercel project.

## 1. Your own Convex
```bash
cd vw-rca-cube
npm ci
npx convex dev            # creates your own dev deployment, pushes convex/, writes VITE_CONVEX_URL into .env.local
```
Leave it running, or use `npx convex dev --once` to push and exit. Then set the deployment's env vars with test values, not production ones:
```bash
npx convex env set VIKTOR_SPACES_ACCESS_MODE public
npx convex env set DASHBOARD_PASSWORD_SHA256 "$(echo -n 'a-test-password' | shasum -a 256 | cut -d' ' -f1)"
npx convex env set ADMIN_PASSWORD_SHA256     "$(echo -n 'a-test-admin-password' | shasum -a 256 | cut -d' ' -f1)"
```
The engine needs this deployment's admin key to read your settings every minute. Get it from the Convex dashboard for your dev deployment (Settings, URL & Deploy Key). For a fully local Convex, run `CONVEX_AGENT_MODE=anonymous npx convex dev` instead and read the key from `.convex/local/default/config.json`.

A new Convex starts with a built-in window and a $130M target, so your numbers will not match production until you set your own in Settings (it asks for the admin password above).

## 2. Your own engine and snapshot

**Get a snapshot: copy one (quickest) or build one.**

*Option A: copy the production snapshot.* It is a folder of about 33 MB, in the server's Docker volume. On the server:
```bash
docker run --rm -v rca_engine_data:/data -v "$PWD":/out alpine tar czf /out/snapshot.tgz -C /data snapshot
```
Copy `snapshot.tgz` to your machine and unpack it so that `meta.json` ends up at `vw-rca-cube/data/snapshot/meta.json`:
```bash
mkdir -p vw-rca-cube/data && tar -xzf snapshot.tgz -C vw-rca-cube/data
```
You get production's data as of its last build (see `dataThrough` in `/health`), without touching Cube. It only reads a copy: nothing you do changes the server. Settings, logins and plans come from your own Convex, not from the snapshot, so they start empty. You only need the Cube lines below if you later want a fresher snapshot (Option B).

*Option B: build your own from Cube* (needs the Cube lines in the env file below, then the rebuild call).

Create `.env.engine.local` in `vw-rca-cube/` (it is git-ignored through `.env.*.local`):
```bash
CUBE_API_URL=https://<the shared cube host>      # Option B only; no trailing /cubejs-api
CUBE_API_SECRET=<the cube secret>                # Option B only
CONVEX_URL=https://<your-dev>.convex.cloud       # YOUR Convex, from .env.local
CONVEX_ADMIN_KEY=<your dev deployment's key>
DASHBOARD_PASSWORD_SHA256=<same hash you set in Convex>
ADMIN_PASSWORD_SHA256=<same hash you set in Convex>
ADMIN_SECRET=any-random-string                   # guards POST /admin/rebuild
DATA_DIR=./data                                  # your snapshot lives here (git-ignored)
PORT=8787
DISABLE_SCHEDULER=1                              # rebuild only when you ask (see below)
# TUNNEL=1                                       # only for step 4, and only with YOUR Convex
```
Start it. With a copied snapshot it loads in seconds; with Option B, call the rebuild once:
```bash
node --env-file=.env.engine.local --import tsx engine/server.ts
curl -XPOST localhost:8787/admin/rebuild -H "x-admin-secret: any-random-string"   # Option B only; takes about a minute
curl -s localhost:8787/health                    # ok:true once a snapshot is loaded
```
Notes:
- With `DISABLE_SCHEDULER` unset, the engine rebuilds by itself at start-up when it has no snapshot or the snapshot is older than the last 13:00 UTC refresh, and again each day after 13:00 UTC. That is what production does, and it needs Cube. With a copied snapshot and no Cube access, leave `DISABLE_SCHEDULER=1` set, or the engine will try to rebuild and fail (it keeps the copied snapshot).
- A copied snapshot goes stale. To refresh it, copy a new one or switch to Option B.
- Every Option B rebuild queries the shared Cube and, behind it, BigQuery. Rebuild when you need fresh data, not on every restart. A restart reloads the snapshot from `./data` in seconds without touching Cube.
- If Cube is unreachable, pages that only need the snapshot keep working; a rebuild fails and keeps the old snapshot.
- Settings you save (target, new-business goal, bundle penetration goal) reach the engine within a minute through the Convex bridge. A change of window or baseline needs a rebuild.

## 3. Run the front end locally
In `vw-rca-cube/.env.local` (written by `convex dev`) add:
```bash
VITE_RCA_API_URL=http://localhost:8787
```
```bash
npm run dev
```
Sign in with any work-domain address (@vibrant-wellness.com, @vibrant-america.com or @vibrant-wellness.co.uk) and the test password you hashed in step 1. To check the real UI against your engine: `node engine/scripts/ui-smoke.mjs <app-url> <out-dir> <email> <password>`.

## 4. Your own Vercel project (optional)
1. Create a project from your fork or branch. Framework Vite, Install `npm install --no-package-lock`, Build `npm run build`, Output `dist`. (Production uses `npx convex deploy --cmd 'npm run build'` with a production key; do not copy that. Push your Convex code with `npx convex dev --once` instead.)
2. Env: `VITE_CONVEX_URL=<your dev Convex URL>` and `VITE_VIKTOR_SPACES_ACCESS_MODE=public`.
3. Let the page find your engine, either way:
   - **Tunnel (simplest):** set `TUNNEL=1` in `.env.engine.local` and install `cloudflared`. The engine publishes its public address to your Convex and the page looks it up there, as in production.
   - **Fixed address:** set `VITE_RCA_API_URL` in Vercel to wherever your engine is reachable.
4. Add your Vercel address to the engine: `ALLOWED_ORIGINS=https://<your-project>.vercel.app`. Production's own preview addresses are allowed automatically; yours are not.

## Which code is running
```bash
curl -s <engine>/health        # {"code":{"commit":"0b23c30d90","date":"2026-11-04"}, ...}
```
`commit` is the git commit the engine was built from. A tarball or image built with the script below carries it; a plain checkout reports `"working tree"`, and `"unknown"` means the file is missing. To see what changed since a deployed commit:
```bash
git diff <commit> HEAD -- vw-rca-cube/analytics vw-rca-cube/engine
```
Build the tarball for a server (or to compare with one) from any commit:
```bash
vw-rca-cube/scripts/build-engine-tarball.sh [ref] [out.tgz]     # default: HEAD -> ./rca-engine.tgz
```
Use the script rather than a hand-typed `git archive HEAD:vw-rca-cube ...`: only the script stamps the commit.

To compare a server's files with a commit without changing the server (needs ssh; keep to `analytics/` and `engine/*.ts`, since the server folder also holds `.env`, compose files and the data volume):
```bash
mkdir /tmp/engine-expected && tar -xzf rca-engine.tgz -C /tmp/engine-expected
rsync -rnci shyam@10.6.2.34:/home/shyam/rca-engine/analytics/ /tmp/engine-expected/analytics/   # -n: dry run, lists differences only
```

## Rules
- Never put a production key or the production `CONVEX_URL` in your engine's env, and never set `TUNNEL=1` against production Convex: the engine publishes its address there and every user's dashboard would start calling your machine.
- The snapshot in `./data` holds clinic-level data. Having it on a developer machine is fine for this team. It is git-ignored; do not commit it or put it on a shared or public drive.
- Do not edit code on the production server. Change the repo, build the tarball with the script, and deploy that.

## Troubleshooting
- `no snapshot yet`: run the rebuild call in step 2.
- Rebuild fails: check `CUBE_API_URL` / `CUBE_API_SECRET` and that Cube is reachable from your machine. Admin detail: `curl -s localhost:8787/health -H "x-admin-secret: ..."`.
- Page says it cannot reach the service: `VITE_RCA_API_URL` (local) or `TUNNEL=1` and `cloudflared` (Vercel); also check `ALLOWED_ORIGINS`.
- A setting will not save, or saves but never shows: your Convex has not been pushed with the latest `convex/` (run `npx convex dev --once`), or the engine's `CONVEX_URL` / key point at a different deployment.
