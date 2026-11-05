# Hosting your own copy of the RCA dashboard (Thiru's dev environment)

Step-by-step guide to a complete, independent copy of the dashboard on Vercel. Use it to change and test things before they go to `main`, and to share them with others. It builds on [LOCAL_DEV.md](LOCAL_DEV.md), which explains the moving parts. This guide is the concrete recipe for one setup: the engine runs in Docker on 10.6.2.34 and is reached through a Cloudflare quick tunnel.

Nothing here touches production, as long as you follow the [rules](#11-rules).

---

## 1. What runs where

```
 viewer's browser
     │
     ▼
 Vercel  (your project, free tier) ── React app built from thiruvibrant/vw_rca, branch thiru_dev_main
     │                       │
     │                       └──► Convex  project "vw-rca-thiru" (production: tangible-leopard-228)
     │                              logins, Settings, plans, insights, and the engine's current address
     ▼
 https://<random>.trycloudflare.com      (Cloudflare quick tunnel: free, no account)
     │
     ▼
 10.6.2.34  Docker container "rca-engine-thiru"
     serves every chart from an in-memory snapshot; rebuilds it daily at 13:00 UTC
     │
     ▼
 Cube (shared with production, read-only)  http://10.6.2.34:4002 ──► BigQuery
```

| Piece | What it does | Where | Cost |
|---|---|---|---|
| **Frontend** | The pages people see | Vercel | Free (Hobby) |
| **Convex** | Small app data (logins, settings, plans) and the engine's current public address. Nothing computed from orders. | Convex cloud | Free |
| **Engine** | Builds a snapshot from Cube and answers every dashboard request from memory | Docker on 10.6.2.34 | — |
| **Quick tunnel** | Gives the engine a public HTTPS address without opening a port. The address changes on each restart; the engine reports the new one to Convex and the dashboard picks it up automatically. | Cloudflare | Free, no account |
| **Cube** | Semantic layer over BigQuery, shared with production, read-only | 10.6.2.34:4002 | — |

## 2. Accounts and values

| Account | Used for |
|---|---|
| GitHub **`thiruvibrant`** | The fork `thiruvibrant/vw_rca`; Vercel deploys from it |
| **thirunarayanan.r@vibrant-america.com** | Convex, Vercel |
| Your SSH login on **10.6.2.34** | Running the engine |
| From **Shyam** | The shared Cube API secret, and an OK for one extra daily rebuild against it |

**Which secret goes where.** Never put any of these in a file in the repo, including `env.dev.example`, which is only a template. Never paste them into chat either.

| Value | Vercel → Settings → Environment Variables (Production) | Server `~/rca-engine-thiru/.env.dev` |
|---|---|---|
| Convex production deploy key | `CONVEX_DEPLOY_KEY` | `CONVEX_ADMIN_KEY` |
| Convex production URL `https://tangible-leopard-228.convex.cloud` | (set automatically by the build) | `CONVEX_URL` |
| Dashboard password hash | — | `DASHBOARD_PASSWORD_SHA256` |
| Admin password hash | — | `ADMIN_PASSWORD_SHA256` |
| `public` | `VITE_VIKTOR_SPACES_ACCESS_MODE` | — |
| Cube API secret (from Shyam) | — | `CUBE_API_SECRET` |
| Random string (`openssl rand -hex 24`) | — | `ADMIN_SECRET` |
| Your Vercel address | — | `ALLOWED_ORIGINS` |

The password hashes also live in Convex. They were set with `npx convex env set`, and both places must match.

## 3. Code: fork and branches  ✅ done

- `origin` is `shyamvib/vw_rca`. Read the team's changes from it.
- `thiru` is `thiruvibrant/vw_rca`. Push your work here; Vercel deploys `thiru_dev_main` from it.

| Task | Commands |
|---|---|
| Pick up the team's latest `main` | `git fetch origin && git checkout thiru_dev_main && git merge origin/main && git push thiru thiru_dev_main` |
| Start a change | `git checkout -b thiru_dev_<topic> thiru_dev_main` … commit … merge into `thiru_dev_main` when it works |
| Send a change to the team | Push the branch to `thiru`, then `gh pr create --repo shyamvib/vw_rca --base main` |

## 4. Convex  ✅ done

- Project **`vw-rca-thiru`**: dev deployment `basic-hippopotamus-466`, production deployment `tangible-leopard-228`.
- Functions are deployed to both. `VIKTOR_SPACES_ACCESS_MODE=public` and both password hashes are set on both.
- The production deploy key was generated in the Convex dashboard (production deployment → Settings → URL & Deploy Key).

You need a new deploy key only if you lose this one. Generate it in the same place and update Vercel and `.env.dev`.

## 5. Vercel

1. Log in to vercel.com with your work email. Under **Account Settings → Authentication**, connect the GitHub account **thiruvibrant**.
2. Go to **Add New → Project** and import `thiruvibrant/vw_rca`.
3. Before the first deploy, set:

   | Setting | Value |
   |---|---|
   | Framework Preset | Vite |
   | Root Directory | `vw-rca-cube` |
   | Install Command | `npm install --no-package-lock` |
   | Build Command | `npx convex deploy --cmd 'npm run build'` |
   | Output Directory | `dist` |

4. Add environment variables, **Production** only:

   | Name | Value |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | Your production deploy key (`vw-rca-thiru`, never Shyam's) |
   | `VITE_VIKTOR_SPACES_ACCESS_MODE` | `public` |

   Don't set `VITE_RCA_API_URL`. With a quick tunnel, the dashboard finds the engine through Convex.
5. Deploy. Then open **Settings → Git → Production Branch**, set it to `thiru_dev_main`, and redeploy. From now on, every push to `thiru_dev_main` on the fork redeploys the site.
6. Note your address, for example `https://vw-rca-thiru.vercel.app`. It goes into the engine's `ALLOWED_ORIGINS` in step 6.

The site loads now, but shows "cannot reach the service" until the engine is running.

## 6. Engine on 10.6.2.34

**Quick way: one script does all of 6a–6e.** From the repo root on your Mac (on the VPN):
```bash
vw-rca-cube/scripts/deploy-thiru-dev-engine.sh <your-ssh-user>
```
- **Asks for:** the Cube secret, your Convex production deploy key, and the two passwords. Typing is hidden.
- **Checks:** the Cube secret against Cube, and that the key belongs to your own project, before using either.
- **Sets:** the password hashes in your Convex.
- **Writes:** `.env.dev` on the server (mode 600).
- **Deploys:** the engine from `thiru_dev_main`, then waits until the dashboard has data.

Later runs reuse the server's `.env.dev` and only ship new code. Add `--configure` to change secrets or passwords. The manual steps below show what the script does.

You need the Cube secret from Shyam and your Vercel address.

**a. Check there is room** on the server:
```bash
free -h; df -h /; docker stats --no-stream
```
The engine is capped at 3 GB of memory. Make sure free memory is comfortably above that.

**b. Build the engine package** on your Mac, from the repo root. It contains exactly what is committed on the branch and stamps the commit hash, so `/health` can show which code is running.
```bash
cd "/Users/thirunarayanan.r/Documents/RCA Dashboard"
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
Fill it in from the table in section 2. Save with Ctrl-O, Enter, Ctrl-X.

**d. Start it:**
```bash
docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev up -d --build
docker logs -f rca-engine-thiru
```
In the logs, look for:
- `tunnel up: https://<random>.trycloudflare.com`. That is your engine's public address, and it is already reported to your Convex.
- On first start there is no snapshot, so the engine builds one from Cube straight away, which takes about a minute.

Press Ctrl-C to stop following the logs; the container keeps running.

**e. Check it:**
```bash
curl -s https://<random>.trycloudflare.com/health
```
You want `"ok":true`, a `dataThrough` date of yesterday or today, and `code.commit` matching your branch.

Production's `rca-engine` and `cube-rca` are never touched. Your container has its own name, `rca-engine-thiru`, and its own data volume.

## 7. Verify end to end

- [ ] Open your Vercel address and sign in with your `@vibrant-america.com` email and your **dashboard** test password.
- [ ] Overview, Rep View and Projection show numbers.
- [ ] Settings (asks for the **admin** password): set your yearly target. The Projection reflects it within about a minute.
- [ ] Production's dashboard still loads normally.

## 8. Sharing the dashboard with others

Once section 7 passes, the dashboard can be shared. People need three things:

1. **The Vercel address.** It stays the same; only the engine's tunnel address changes, and that is handled for them.
2. **A work email.** Only `@vibrant-america.com`, `@vibrant-wellness.com` and `@vibrant-wellness.co.uk` addresses can sign in.
3. **A password**, in one of two forms:
   - **Shared:** give them the dashboard password. Keep the admin password to yourself, because it changes Settings for everyone.
   - **Per rep:** create one under **Settings → Rep logins** (asks for the admin password). Each person gets their own login, scoped to their own book. This is better for a wider audience, because you can remove one person without changing everyone's password.

Before sharing beyond a few colleagues:
- **The address can briefly fail.** If the engine restarts, the tunnel address changes. The dashboard picks up the new one within about a minute, but open pages may show an error until then. Quick tunnels also have no uptime guarantee and are meant for testing.
- **It is your copy, not production.** Numbers can differ: your Settings (target, window) start at defaults, and your data builds at its own time. Label it as a dev or preview copy when you share it.
- **Vercel's free Hobby plan is for non-commercial use.** For anything people rely on, move the project to a Pro or company Vercel team.
- **Make the address permanent later.** Use a named tunnel on your domain (section 12) so restarts don't change it.

## 9. Day to day

| I want to… | Do this |
|---|---|
| Ship a **frontend or Convex** change | Commit, then `git push thiru thiru_dev_main`. Vercel rebuilds it and also deploys the Convex functions. |
| Ship an **engine** change (`analytics/`, `engine/`) | Commit, then rebuild the package and copy it over (6b). Unpack it over `~/rca-engine-thiru`, which keeps `.env.dev`. Then run the `docker compose … up -d --build` line from 6d. |
| Get fresh data now | `curl -XPOST <engine-address>/admin/rebuild -H "x-admin-secret: <ADMIN_SECRET>"` |
| Find the current engine address | `docker logs rca-engine-thiru 2>&1 \| grep "tunnel up" \| tail -1` |
| See logs | `docker logs --tail 200 rca-engine-thiru` |
| Stop it | `docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev down` (keeps the data) |
| Know which code is live | `curl <engine-address>/health` → `code.commit`, then `git diff <commit> thiru_dev_main -- vw-rca-cube/analytics vw-rca-cube/engine` |

The engine refreshes itself daily at 13:00 UTC, the same as production.

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Site says it **cannot reach the service** | Check these in order:<br>1. The engine isn't running: `docker ps`.<br>2. The engine's `CONVEX_URL` isn't `tangible-leopard-228`, so it announced its address somewhere else.<br>3. The browser console shows a CORS error: `ALLOWED_ORIGINS` doesn't exactly match your Vercel address. Fix it, then rerun the `up -d` line. |
| No `tunnel up:` line in the logs | The server can't reach Cloudflare. Check that outbound HTTPS from the server is allowed. |
| `/health` says **no snapshot** / rebuild failed | Get admin detail with `curl <engine>/health -H "x-admin-secret: …"`. Usually `CUBE_API_SECRET` is wrong, or Cube isn't reachable from the container. Test with `docker exec rca-engine-thiru node -e "fetch('http://10.6.2.34:4002/readyz').then(r=>console.log(r.status))"`; it should print 200. |
| **Sign-in fails** | The hash in Convex and in `.env.dev` must come from the same password. Use a work-domain email. |
| A **setting won't save**, or never shows | Check the Vercel build log for `convex deploy`. Then check that the engine's `CONVEX_URL` and key are for `tangible-leopard-228`. |
| **Vercel build fails** at install | Check the log for an npm package error. A newly published dependency can briefly be broken upstream: wait and redeploy rather than pinning it. |
| Engine build fails at `npm ci` | `package.json` and `package-lock.json` don't match. The engine image installs strictly from the lock file. Never edit `package.json` without updating the lock with the same npm version. |

## 11. Rules

- **Never use a production key, URL or password hash.** That includes Shyam's `CONVEX_URL`, deploy keys or production passwords, anywhere in your copy. This matters most here: your engine runs a quick tunnel and publishes its address to whichever Convex it points at. Pointed at production, every user's dashboard would start calling your engine.
- **Real values go only in Vercel's settings and the server's `.env.dev`.** Never put them in files in the repo or in chat.
- **Leave Jira and Slack variables unset.** Otherwise "Raise a question" files real tickets.
- **Treat the engine address and passwords as sensitive.** The engine is public on the internet and serves clinic-level data, protected only by your passwords. Use long passwords and share them only with the people who need them.
- **Don't edit code on the server.** Change the repo, rebuild the package, and redeploy.

## 12. Later

**A permanent engine address (named tunnel).** You need a domain on your Cloudflare account.
1. In Cloudflare, go to Zero Trust → Networks → Tunnels and create a tunnel. Give it the public hostname `rca-dev.<domain>` pointing to `http://engine:8787`.
2. Add a `cloudflare/cloudflared` service to the compose file running `tunnel run`, with that tunnel's token.
3. Set `TUNNEL: "0"` on the engine.
4. In Vercel, set `VITE_RCA_API_URL=https://rca-dev.<domain>` and redeploy.

**Your own Cube (`thiru_normalized_v2`, :4003).** The engine asks Cube for the production model's names (see `analytics/cube.ts`). Your model is a different schema, so the plan is compatibility views on :4003 that expose the old names on top of `thiru_normalized_v2_*`, one cube at a time:

| Old name the engine asks for | Build it from |
|---|---|
| `rfm_orders` (orders, revenue, patients, product_family, team_lead, state, charge_method, hubspot_id, first/last order, VA, bundle, deductions) | `thiru_normalized_v2_orders` + clinics, sales_reps, providers |
| `order_tests.test_name` | `thiru_normalized_v2_order_lines` + tests |
| `customers` (signup time, name, credential, state) | `thiru_normalized_v2_providers` |
| `journey` (touchpoints, activity type, last touch) | `thiru_normalized_v2_engagements` / `engagement_activity` |
| `internal_user` | `thiru_normalized_v2_sales_reps` |
| `portfolio_changes` (NEW / STOPPED / DECLINING) | No counterpart yet. Needs design. |
| `sales_commission` | No counterpart yet. |

Before switching:
1. Give the :4003 Cube an API secret and turn off dev mode. Today its API is open to anyone on the network.
2. Add pre-aggregations for the high-volume shapes: day × clinic, team lead, state, product family and charge method. **Don't** pre-aggregate:
   - row-level drills;
   - small dimension tables;
   - percentile or median baselines, which belong in BigQuery tables.
3. Check that YTD revenue, clinic counts and family totals match the current snapshot for the same `dataThrough`.

Then set `CUBE_API_URL=http://10.6.2.34:4003` and the new secret in `.env.dev`, run `up -d`, and trigger a rebuild.
