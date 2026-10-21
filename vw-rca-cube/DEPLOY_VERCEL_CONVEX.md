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

## How the analytics service works (no database of its own)

```
 browser ──/rpc──► Cloudflare quick tunnel ──► rca-engine (one Node process)
                                                 │ in-memory tables (MemDb), read-only
                                                 │ same handler code that used to run in Convex
                                                 │ every 60 s: settings pulled from Convex
                                                 │ per rep request: session checked against Convex
                                                 ▼
                                        /data/snapshot  (Docker volume, ~33 MB)
                                        one folder per table, documents.jsonl

 Rebuild (daily 13:00 UTC, the Refresh button, POST /admin/rebuild):
   builder child process ──► Cube ──► BigQuery
   runs the refresh logic, writes a NEW snapshot folder, swaps it in only on success, reloads memory
```

- **The snapshot** is a folder of JSON-lines files, one per table (`clinicMeta` about 7,000 clinics,
  `clinicPeriod` about 82,000 rows). On start the engine loads it into `engine/memdb.ts`, an in-memory
  stand-in for Convex's `ctx.db`, so the existing query handlers run unchanged. The service only reads;
  there are no per-request writes.
- **Where things live:** orders and everything computed from them are in the snapshot (source of truth:
  Cube / BigQuery). Logins, sessions, the access log, settings (target, new-business goal, window), clinic
  plans, product-eligible marks and insights are in Convex.
- **Convex bridge:** every 60 s the engine copies the yearly target, the new-business goal, the
  product-eligible marks and the clinic plans from Convex into memory. Window or baseline changes only take
  effect at the next rebuild. A rep session (`rs:` token) is checked against Convex on each request (cached
  30 s) and mirrored into memory, including the all-reps flag (`allReps`) for rep-view-only logins.
- **Restarts and failures:** the engine starts from the volume in seconds and needs neither Cube nor Convex
  to start. If Cube is down, snapshot pages keep working and Cube-backed calls answer 503; a failed rebuild
  keeps the old snapshot. A snapshot older than the last 13:00 UTC slot is rebuilt on start, so a restart
  cannot hide a missed daily refresh. The rebuild trims the latest order date only when it is today
  (Pacific); otherwise data runs through yesterday.
- **Limits:** one process on one server (3 GB memory limit), no replica. If the volume were lost, a
  rebuild from Cube (about a minute) restores it.

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

### Raise a question -> Jira (optional)
The Business Feed "Raise a question" button creates a Jira issue through the engine (`analytics/jira.ts`), with the asker, their
scope and, from a card, the card's question and fact attached. Open to team, rep and manager logins (10 questions an hour per
person). Setup, on the server:

    # 1. In Jira: pick the project; the account below needs "Create issues" there. That account creates its own API token at
    #    https://id.atlassian.com/manage-profile/security/api-tokens (any project member can; no Jira admin needed unless your
    #    organization has blocked API tokens). Do not paste the token anywhere except the server .env.
    # 2. Add to /home/shyam/rca-engine/.env (see engine/deploy/env.example): JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN,
    #    JIRA_PROJECT_KEY (optional JIRA_ISSUE_TYPE, default Task, and JIRA_LABELS).
    # 3. Restart: cd /home/shyam/rca-engine && docker compose up -d --build
    # 4. Check the credentials (creates nothing; shows the account, project and issue types):
    docker exec rca-engine node -e 'fetch("http://localhost:8787/admin/jira-check",{headers:{"x-admin-secret":process.env.ADMIN_SECRET}}).then(r=>r.json()).then(console.log)'

**Request portal (Jira Service Management).** To file into a portal such as
`https://vibrantamerica.atlassian.net/servicedesk/customer/portal/39`, set `JIRA_SERVICE_DESK_ID=39` (and no
`JIRA_PROJECT_KEY`) plus `JIRA_REQUEST_TYPE_ID`. Leave the request type empty first and run the check: it lists the service
desk's request types with their ids, and for the one you pick says whether it needs anything besides summary and description.
Requests are created through the Service Management API, so they appear in the portal with its workflow and SLAs. The account
behind the token must be able to create requests in that portal (a portal customer or an agent); `JIRA_RAISE_ON_BEHALF=1` files
each one as the asker (their login email), which needs an agent account: the engine looks the person up by email, creates a portal
customer if they have none, and if filing as them is refused it files under the token account with the asker named in the text.

If Jira is not configured the button falls back to the Slack relay (`RAISE_QUESTION_WEBHOOK_URL`), and to an error message if
neither is set. When both are set, Jira gets the issue and Slack gets a copy with the issue key.

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

## Exposure and hardening
- Public by design: the Vercel frontend, Convex cloud, and the engine through its quick tunnel. Everything
  on the engine needs a password or rep token in `args.password`; `/admin/rebuild` needs `x-admin-secret`.
- The engine answers clean 4xx for bad requests, never leaks handler error text, allows only
  `module:function` names, throttles guesses at the team password (60 refusals a minute per client address,
  then 429; rep tokens are not counted), and `/health` shows only build time and data-through date
  (row counts and build errors need the admin secret).
- CORS allows `ALLOWED_ORIGINS` plus this project's per-deployment Vercel addresses
  (`vw-<hash>-vbw.vercel.app`).
- Quick tunnels get a new address on every restart (the frontend re-resolves it and retries once). A named
  tunnel with a fixed address is the proper fix for production.
- The cube-rca stack has its own quick tunnel container (`cube-rca-tunnel-rca-1`) that exposes the Cube API;
  nothing in this app uses it. See `CLINIC_LIFECYCLE.md` section 15 for the open follow-ups (stop it, rotate
  the Cube secret, named tunnel, live chaos run, server ports).

## Proposals (not built)
- `PROPOSAL_DIGITALOCEAN_HOSTING.md`: host Cube and the analytics engine on one DigitalOcean Droplet behind Caddy, with only 443 open.
- `PROPOSAL_CUBE_FIRST_REFACTOR.md`: move the dashboard logic into the warehouse and Cube so the engine can be retired (phased, with parity gates).
