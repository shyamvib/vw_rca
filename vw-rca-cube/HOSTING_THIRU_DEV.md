# Hosting your own copy of the RCA dashboard (Thiru's dev environment)

This is a step-by-step guide to running a complete, independent copy of the dashboard on Vercel. You can change and test things there before they go to `main`. It builds on [LOCAL_DEV.md](LOCAL_DEV.md), which explains the moving parts. This guide is the concrete recipe for one setup: the engine runs in Docker on 10.6.2.34, behind a named Cloudflare tunnel on your own domain.

Nothing here touches production, as long as you follow the [rules](#9-rules) at the end.

---

## 1. What runs where

```
 your browser
     │
     ▼
 Vercel (your project, free tier) ── static React app built from thiruvibrant/vw_rca, branch thiru_dev_main
     │                       │
     │                       └──► Convex (your project "vw-rca-thiru")
     │                              logins, Settings, plans, insights
     ▼
 https://rca-dev.<your-domain>          (Cloudflare named tunnel, free tier)
     │
     ▼
 10.6.2.34  Docker project "rca-thiru"
   ├─ rca-engine-thiru   the analytics engine: serves every chart from an in-memory snapshot
   └─ rca-tunnel-thiru   cloudflared: connects the engine out to Cloudflare (no open ports)
     │
     ▼
 Cube (shared, read-only)  http://10.6.2.34:4002 ──► BigQuery
```

| Piece | What it does | Where it lives | Cost |
|---|---|---|---|
| **Frontend** | The pages you see | Vercel | Free (Hobby) |
| **Convex** | Small app data: logins, settings, plans, insights. Also stores nothing computed from orders. | Convex cloud | Free |
| **Engine** | Rebuilds a snapshot from Cube daily at 13:00 UTC; answers every dashboard request from memory | Docker on 10.6.2.34 | — |
| **Tunnel** | Gives the engine a fixed public HTTPS address without opening any port on the server | Cloudflare | Free |
| **Cube** | The semantic layer over BigQuery. Shared with production, read-only. | 10.6.2.34:4002 | — |

Production runs the same pieces under different names. This copy shares only Cube with it.

## 2. Accounts

| Account | Use it for |
|---|---|
| GitHub **`thiruvibrant`** | Your fork `thiruvibrant/vw_rca`; Vercel deploys from it |
| **thirunarayanan.r@vibrant-america.com** | Convex, Vercel, Cloudflare logins |
| SSH user on **10.6.2.34** | Running the engine containers |
| From **Shyam** | The shared Cube API secret (`CUBEJS_API_SECRET` of `cube-rca`) and an OK for one extra daily rebuild against it |

## 3. Code: fork and branches

You can't push to `shyamvib/vw_rca` directly, so you work in a fork and send changes back as pull requests.

```bash
gh auth login                                   # choose GitHub.com, log in in the browser as thiruvibrant
cd "RCA Dashboard"                              # this clone
gh repo fork shyamvib/vw_rca --remote --remote-name thiru
git push -u thiru thiru_dev_main
```

Your remotes:
- `origin` is `shyamvib/vw_rca`. Read from it to pick up the team's changes.
- `thiru` is `thiruvibrant/vw_rca`. Push your work here; Vercel deploys from it.

| Task | Commands |
|---|---|
| Pick up the team's latest `main` | `git fetch origin && git checkout thiru_dev_main && git merge origin/main && git push thiru thiru_dev_main` |
| Start a change | `git checkout -b thiru_dev_<topic> thiru_dev_main` … commit … merge into `thiru_dev_main` when it works |
| Send a change to the team | Push the branch to `thiru` and open a pull request into `shyamvib/vw_rca:main` (`gh pr create --repo shyamvib/vw_rca --base main`) |

## 4. Convex (your own project)

Run these from `vw-rca-cube/` on your Mac:
```bash
npm ci
npx convex login                     # browser login with your work email
npx convex dev --once                # first run: choose "create a new project", name it vw-rca-thiru
npx convex deploy                    # pushes the same functions to the project's production deployment
```

Pick two **test** passwords. Never use production's passwords. One is for signing in, the other is the admin password for Settings. Set them on the production deployment:
```bash
npx convex env set --prod VIKTOR_SPACES_ACCESS_MODE public
npx convex env set --prod DASHBOARD_PASSWORD_SHA256 "$(printf '%s' 'YOUR-TEST-PASSWORD' | shasum -a 256 | cut -d' ' -f1)"
npx convex env set --prod ADMIN_PASSWORD_SHA256     "$(printf '%s' 'YOUR-ADMIN-PASSWORD' | shasum -a 256 | cut -d' ' -f1)"
```

Then open the Convex dashboard → `vw-rca-thiru` → **Production** → Settings → **URL & Deploy Key** and copy two values:
- **Deployment URL**, `https://<name>.convex.cloud`. It goes to the engine as `CONVEX_URL`.
- **Production deploy key**. It goes to the engine as `CONVEX_ADMIN_KEY` and to Vercel as `CONVEX_DEPLOY_KEY`.

A new Convex starts with a built-in window and a $130M target. Set your own in the dashboard's Settings after step 7.

## 5. Cloudflare named tunnel

Your domain must already use Cloudflare's nameservers. Its status is "Active" in the Cloudflare dashboard.

1. Open Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → **Cloudflared**, and name it `rca-thiru`.
2. On the install screen choose **Docker**. Copy only the long token after `--token` (it starts with `eyJ`). It goes in `.env.dev` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. Under **Public Hostname**, add one:
   - Subdomain: `rca-dev`, Domain: your domain
   - Service type: **HTTP**, URL: **`engine:8787`**
4. Save. The tunnel shows "Inactive" until the containers start in step 6.

Your engine's address will be **`https://rca-dev.<your-domain>`**.

## 6. Engine on 10.6.2.34

**a. Check there is room.** On the server:
```bash
free -h; df -h /; docker stats --no-stream
```
The engine is capped at 3 GB of memory and the tunnel at 256 MB. Make sure free memory is comfortably above 3.5 GB.

**b. Build the engine package** on your Mac, from the repo root. The script packages exactly what is committed on the branch and stamps the commit hash, so `/health` can tell you which code is running.
```bash
vw-rca-cube/scripts/build-engine-tarball.sh thiru_dev_main ~/rca-engine-thiru.tgz
scp ~/rca-engine-thiru.tgz <you>@10.6.2.34:~/
```

**c. Unpack and configure** on the server:
```bash
mkdir -p ~/rca-engine-thiru && tar -xzf ~/rca-engine-thiru.tgz -C ~/rca-engine-thiru
cd ~/rca-engine-thiru
cp engine/deploy/env.dev.example .env.dev && chmod 600 .env.dev
nano .env.dev
```

Fill in `.env.dev`:

| Variable | Value |
|---|---|
| `CLOUDFLARE_TUNNEL_TOKEN` | Token from step 5 |
| `CUBE_API_URL` | `http://10.6.2.34:4002` (already filled in) |
| `CUBE_API_SECRET` | From Shyam |
| `CONVEX_URL` | Your deployment URL from step 4 |
| `CONVEX_ADMIN_KEY` | Your production deploy key from step 4 |
| `DASHBOARD_PASSWORD_SHA256` | The same hash you set in Convex |
| `ADMIN_PASSWORD_SHA256` | The same hash you set in Convex |
| `ADMIN_SECRET` | Output of `openssl rand -hex 24` (keep it; you need it for manual rebuilds) |
| `ALLOWED_ORIGINS` | Leave the placeholder for now; set it in step 7 |

**d. Start it:**
```bash
docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev up -d --build
docker logs -f rca-engine-thiru
```
On first start there is no snapshot, so the engine builds one from Cube straight away, which takes about a minute. Press Ctrl-C to stop following the logs; the containers keep running.

**e. Check it:**
```bash
curl -s https://rca-dev.<your-domain>/health
```
You want `"ok":true`, a `dataThrough` date of yesterday or today, and `code.commit` matching `git rev-parse --short=10 thiru_dev_main`.

These containers have their own names, `rca-engine-thiru` and `rca-tunnel-thiru`. Production's `rca-engine` and `cube-rca` are never touched.

## 7. Vercel

1. Log in to vercel.com with your work email. Under **Account Settings** → **Authentication**, connect the GitHub account **thiruvibrant**.
2. Go to **Add New** → **Project** and import `thiruvibrant/vw_rca`.
3. Set these before the first deploy:

   | Setting | Value |
   |---|---|
   | Framework | Vite |
   | Root Directory | `vw-rca-cube` |
   | Install Command | `npm install --no-package-lock` |
   | Build Command | `npx convex deploy --cmd 'npm run build'` |
   | Output Directory | `dist` |

4. Add environment variables, scoped to **Production** only:

   | Name | Value |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | Your project's production deploy key from step 4. **Never Shyam's.** |
   | `VITE_VIKTOR_SPACES_ACCESS_MODE` | `public` |
   | `VITE_RCA_API_URL` | `https://rca-dev.<your-domain>` |

   The build pushes your `convex/` functions to your Convex and fills in `VITE_CONVEX_URL` automatically.
5. Go to **Settings** → **Git** → **Production Branch** and set it to `thiru_dev_main`, then redeploy. Every push to `thiru_dev_main` on `thiruvibrant/vw_rca` now redeploys the site.
6. Copy your site address, for example `https://vw-rca-thiru.vercel.app`. On the server, put it in `.env.dev` as `ALLOWED_ORIGINS`, then apply it:
   ```bash
   docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev up -d
   ```

## 8. Verify end to end

- [ ] `curl https://rca-dev.<your-domain>/health` returns `ok:true` with a recent `dataThrough`.
- [ ] The Vercel site loads. You can sign in with your work email (`@vibrant-america.com`) and your **test** password.
- [ ] Overview, Rep View and Projection show numbers.
- [ ] Settings → set your target. The Projection reflects it within about a minute.
- [ ] Production's dashboard still loads, and its `/health` is unchanged.

## 9. Day to day

| I want to… | Do this |
|---|---|
| Ship a **frontend or Convex** change | Commit, then `git push thiru thiru_dev_main`. Vercel rebuilds automatically. |
| Ship an **engine** change (`analytics/`, `engine/`) | Commit, then rebuild the tarball and copy it to the server (step 6b). Unpack it over `~/rca-engine-thiru`; this keeps `.env.dev`. Then `docker compose … up -d --build`. |
| Get fresh data now | `curl -XPOST https://rca-dev.<your-domain>/admin/rebuild -H "x-admin-secret: <ADMIN_SECRET>"` |
| See logs | `docker logs --tail 200 rca-engine-thiru` and `docker logs --tail 50 rca-tunnel-thiru` |
| Stop everything | `docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev down`. This keeps the data volume. |
| Know which code is live | `curl …/health` → `code.commit`, then `git diff <commit> thiru_dev_main -- vw-rca-cube/analytics vw-rca-cube/engine` |

The engine refreshes itself daily at 13:00 UTC, the same as production.

## 10. Rules

- **Never use a production key, URL or password hash.** That includes Shyam's `CONVEX_URL`, deploy key, or production password hashes, anywhere in your copy.
- **Never set `TUNNEL=1` in your engine.** The quick tunnel announces its address to whichever Convex the engine points at.
- **Leave Jira and Slack variables unset.** Otherwise "Raise a question" files real tickets.
- **Treat your engine URL as sensitive.** It is public on the internet and serves clinic-level data, protected only by your test password. Use a long password, and don't share it widely.
- **Never commit `.env*` files or the data volume.**
- **Vercel's free Hobby plan is for non-commercial use only.** It is fine for a personal dev copy. Move to a team or Pro plan before other people rely on this site.
- **Don't edit code on the server.** Change the repo, rebuild the tarball, and redeploy.

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `https://rca-dev…` gives **502 / 1033** | The tunnel or engine isn't running, or the public hostname isn't `engine:8787`. Check `docker ps`, the tunnel logs, and the hostname in Cloudflare. |
| Site says it **cannot reach the service** | `VITE_RCA_API_URL` is wrong. It is fixed at build time, so redeploy Vercel after changing it. Or the browser console shows a CORS error, which means `ALLOWED_ORIGINS` doesn't exactly match your Vercel address (step 7.6). |
| `/health` says **no snapshot** / rebuild failed | Admin detail: `curl …/health -H "x-admin-secret: …"`. Usually `CUBE_API_SECRET` is wrong, or Cube isn't reachable from the container: `docker exec rca-engine-thiru node -e "fetch('http://10.6.2.34:4002/readyz').then(r=>console.log(r.status))"` should print 200. |
| **Sign-in fails** | The password hash in Convex and in `.env.dev` must be the same, for the same password. |
| A **setting won't save** or never shows up | Your Convex functions weren't deployed (check the Vercel build log for `convex deploy`), or the engine's `CONVEX_URL`/key point at another deployment. |
| Numbers differ from production | Your Settings (window, target) start at defaults. Your snapshot may also have been built at a different time. Compare `dataThrough` on both `/health` pages. |

## 12. Later: switching to your own Cube (`thiru_normalized_v2`, :4003)

The engine asks Cube for the production model's names: `rfm_orders`, `order_tests`, `journey`, `customers`, `portfolio_changes`, `internal_user` and `sales_commission` (see `analytics/cube.ts`). Your `thiru_normalized_v2_*` model is a different schema (orders, order lines, clinics, providers, sales reps, tests, engagements), so the engine can't use it as-is.

The recommended path needs no change to the dashboard code: add **compatibility views** on the :4003 Cube that expose the old names on top of your new cubes. Do it one cube at a time:

| Old name the engine asks for | Build it from |
|---|---|
| `rfm_orders` (orders, revenue, patients, product_family, team_lead, state, charge_method, hubspot_id, first/last order, VA, bundle, deductions) | `thiru_normalized_v2_orders` + clinics, sales_reps, providers |
| `order_tests.test_name` | `thiru_normalized_v2_order_lines` + tests |
| `customers` (signup time, name, credential, state) | `thiru_normalized_v2_providers` |
| `journey` (touchpoints, activity type, last touch) | `thiru_normalized_v2_engagements` / `engagement_activity` |
| `internal_user` | `thiru_normalized_v2_sales_reps` |
| `portfolio_changes` (NEW / STOPPED / DECLINING per clinic and test) | **No counterpart yet.** Needs design. |
| `sales_commission` | **No counterpart yet.** |

Before switching:
1. Give the :4003 Cube an API secret and turn off dev mode. Today its API is open to anyone on the network.
2. Add pre-aggregations for the high-volume shapes: day × clinic, team lead, state, product family and charge method, with orders, revenue and bundle measures. **Don't** pre-aggregate:
   - row-level drills (provider search, customer lists);
   - small dimension tables;
   - percentile or median baselines, which can't be rolled up and belong in BigQuery tables.
3. Validate the numbers. Compare your new snapshot's YTD revenue, clinic counts and family totals with the current one for the same `dataThrough`.

Then switch: set `CUBE_API_URL=http://10.6.2.34:4003` and the new `CUBE_API_SECRET` in `.env.dev`, run `docker compose … up -d`, and trigger a rebuild.
