# Temporary deploy: Vercel (frontend) + Convex cloud (backend) + Cube on 10.6.2.34

Cube: `/home/shyam/cube-rca` on 10.6.2.34 (cube-rca :4002, cubestore-rca, tunnel-rca).
Model: `cube/model-vibrant/cubes/` (server copy: real BigQuery table names, TIMESTAMP casts;
`hubspot_link` is NULL and `deductions` is 0 because those BigQuery columns do not exist).
Tunnel is a quick tunnel: URL changes whenever `tunnel-rca` restarts -> update CUBE_API_URL in Convex.

## Convex (production deployment)
    npm install --no-package-lock
    npx convex env set VIKTOR_SPACES_ACCESS_MODE public
    npx convex env set CUBE_API_URL https://<tunnel-host>.trycloudflare.com
    npx convex env set CUBE_API_SECRET <secret from /home/shyam/cube-rca/.env>
    npx convex env set DASHBOARD_PASSWORD_SHA256 <sha256 of the new dashboard password>
    npx convex deploy
Then open the dashboard and press Refresh once (heavy: many Cube queries).

## Vercel
Project settings: Framework Vite, Install `npm install --no-package-lock` (package-lock.json is stale; bun.lock is real),
Build `npx convex deploy --cmd 'npm run build'` (needs CONVEX_DEPLOY_KEY), Output `dist`.
Env: VITE_CONVEX_URL, VITE_VIKTOR_SPACES_ACCESS_MODE=public (production + preview).
