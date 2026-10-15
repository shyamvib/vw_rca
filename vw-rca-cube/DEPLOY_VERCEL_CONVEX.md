# Deploy: Vercel (frontend) + Convex (app state) + analytics service on 10.6.2.34

```
browser ──► Vercel (static frontend)
   │            │
   │            └─ Convex cloud: logins, settings (window/target), plans, eligibility,
   │               insights, refresh log, and the service's current public URL
   └─ analytics service (docker `rca-engine` on 10.6.2.34, reached through a
      cloudflared quick tunnel) ──► Cube (cube-rca :4002) ──► BigQuery
```

Convex holds **app state only** (`convex/`). Everything computed from the data runs in the
analytics service (`engine/server.ts`, handlers in `analytics/`) against an in-memory
snapshot it rebuilds from Cube: nightly 13:00 UTC, on the Refresh button, and (insight
snapshots only) Monday 13:45 / the 1st 14:00 UTC.

## 1. Convex (production)
    export CONVEX_DEPLOY_KEY='prod:...'                 # production key
    npx convex env set VIKTOR_SPACES_ACCESS_MODE public
    npx convex env set DASHBOARD_PASSWORD_SHA256 <echo -n "pw" | shasum -a 256>
    npx convex env set ADMIN_PASSWORD_SHA256 <same, for the Settings/admin password>
    npx convex deploy
No Cube variables are needed in Convex any more.

## 2. Analytics service (10.6.2.34)
    cd /home/shyam/rca-engine        # source copied from this repo: analytics/ engine/*.ts engine/deploy package*.json
    cp engine/deploy/docker-compose.yml .
    # .env (chmod 600) -- see engine/deploy/env.example
    docker compose up -d --build
Own container, joins the `cube-rca_default` network to reach `cube-rca:4000`. It does not
touch the cube-rca / revops stacks. On every start the tunnel gets a new
`*.trycloudflare.com` URL; the service writes it to Convex (`ops:setServiceUrl`) and the
frontend looks it up (`ops:serviceUrl`), so nothing needs updating by hand. To use a stable
URL instead (named tunnel), build the frontend with `VITE_RCA_API_URL=https://...`.

    curl -s -XPOST <service-url>/admin/rebuild -H "x-admin-secret: $ADMIN_SECRET"   # force a rebuild
    curl -s <service-url>/health                                                    # snapshot info

The DASHBOARD_/ADMIN_PASSWORD_SHA256 values in the service `.env` must equal the Convex ones.

## 3. Vercel
Project settings: Framework Vite, Install `npm install --no-package-lock`,
Build `npx convex deploy --cmd 'npm run build'` (needs CONVEX_DEPLOY_KEY), Output `dist`.
Env (Production only): `CONVEX_DEPLOY_KEY`, `VITE_VIKTOR_SPACES_ACCESS_MODE=public`.
Leave Preview/Development without a Convex key (skip preview builds).

## Local test loop
Local Convex (`CONVEX_AGENT_MODE=anonymous npx convex dev`), then the service with
`CONVEX_URL`, `CONVEX_ADMIN_KEY` (from `.convex/local/default/config.json`), `CUBE_API_URL`,
`CUBE_API_SECRET`, `DASHBOARD_PASSWORD_SHA256`, `DATA_DIR`; `POST /admin/rebuild`;
`node engine/scripts/ui-smoke.mjs <app-url> <out-dir> <email> <password>` drives the real UI.
