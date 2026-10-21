# Proposal: host Cube and the analytics engine on DigitalOcean

Status: proposal, nothing built. Written 2026-10-20. Prices and plan names below are estimates to be checked on
DigitalOcean's pricing page before ordering.

## 1. Why move

Today Cube (`cube-rca`, Cube Store) and the analytics engine (`rca-engine`) run on a shared lab server
(10.6.2.34) next to unrelated stacks (`revops`, `zd-*`, `cube` dev stacks, ClickHouse). The engine is reached from
the internet through a Cloudflare **quick tunnel**, and a second quick tunnel exposes Cube.

| Problem today | Effect |
|---|---|
| Quick tunnels: new random address on every restart, no uptime guarantee, no rate limits | Pages fail until the frontend re-resolves the address; hard to tell the sales team "it is at this URL" |
| Cube is reachable from the internet through its own tunnel (nothing in the app uses it) | The Cube API secret is the only thing protecting all order data |
| Shared server, many services on `0.0.0.0` (Cube 4000-4003, 15432, ClickHouse 18123/19000, 8080, 8090, 6791) | Our exposure depends on a firewall we do not manage |
| One box on a lab network, no replica, no managed backups | A server problem is a dashboard outage |
| Our deploys depend on the permission checks and on copying a tarball by hand | Slow, easy to get wrong |

Goal: one small, dedicated, internet-facing environment that we own, with a fixed address, TLS, a firewall that
exposes only 443, and nothing else reachable.

## 2. Target architecture

```
 browser ──► Vercel (static frontend)            Convex cloud (logins, settings, plans)
    │                                                   ▲
    │ https://api.<company-domain>/rpc                  │ session checks, settings sync (as today)
    ▼                                                   │
 DigitalOcean Cloud Firewall: allow 443 (and 80 for certificate renewal) only
    ▼
 ┌─────────────────────── one Droplet (Docker Compose) ────────────────────────┐
 │  caddy        TLS (automatic certificates), reverse proxy, request limits    │
 │    └──► rca-engine   :8787  (internal only)  snapshot volume /data           │
 │            └──► cube      :4000  (internal only, no published port)          │
 │                    └──► cubestore (pre-aggregations, volume)                 │
 └───────────────────────────────────────────────────────────────────────────────┘
                              │ outbound only
                              ▼
                       BigQuery (read-only service account)
```

Rules: only Caddy publishes ports. Cube and Cube Store live on an internal Docker network and are never
published, so the Cube API is not reachable from the internet at all. The engine talks to Cube by service name,
exactly as it does now (`CUBE_API_URL=http://cube:4000`).

## 3. Hosting options considered

| Option | What it is | Verdict |
|---|---|---|
| **A. One Droplet + Docker Compose** | Everything above on one VM | **Recommended.** Cube Store is stateful and wants a disk; Compose keeps the same setup we run today. |
| B. App Platform (managed containers) for the engine, Droplet for Cube | Managed deploys and TLS for the engine only | Reasonable later. Splits the system across two places and the engine needs fast access to Cube. |
| C. DigitalOcean Kubernetes | Cluster, replicas, rolling updates | Overkill for about 30 users. |
| D. Two Droplets behind a Load Balancer | Engine replicas for availability | An upgrade path from A (see section 8), not a first step. |

## 4. Sizing (starting point)

- Engine: process plus 33 MB snapshot; the current container limit is 3 GB, in practice it needs far less. The
  rebuild runs as a child process and briefly needs more.
- Cube API plus Cube Store with the existing pre-aggregations (daily rollup by clinic, journey touches, etc.).
- Start with a general-purpose Droplet of about **4 vCPU / 8 GB RAM / 80-160 GB SSD**, then adjust after a week of
  monitoring. A separate block-storage volume (20-50 GB) for `/data` and Cube Store makes snapshots and resizing
  simpler. Rough running cost: tens of dollars a month for the Droplet plus a few for the volume and backups.
- Load measured on a temporary copy of the engine (25 concurrent clients, heaviest page): about 31 requests per
  second at roughly 0.8 s each on 8 cores. About 30 reps are far below that.

## 5. Security design

- **Network:** DigitalOcean Cloud Firewall allows inbound 443 and 80 from anywhere; SSH (22) only from the office
  or a VPN address. Everything else denied. Cube, Cube Store and the engine have no published ports.
- **TLS and name:** a company subdomain (for example `api.<company-domain>`) pointing at the Droplet; Caddy gets and
  renews certificates by itself. The frontend is built with `VITE_RCA_API_URL=https://api.<company-domain>`, so the
  quick-tunnel address lookup in Convex is no longer needed.
- **CORS:** `ALLOWED_ORIGINS` set to the production frontend; the engine already also allows this project's
  per-deployment Vercel addresses.
- **Limits at the edge:** Caddy request size and rate limits in addition to the engine's own checks (400/403/413,
  allowlisted function names, throttle on team-password guesses).
- **Secrets:** `.env` files with mode 600 on the Droplet, never in git. BigQuery uses a dedicated **read-only**
  service account scoped to the one dataset; the key file is mounted read-only into the Cube container.
  New secrets for this move (Cube API secret, admin secret) are generated fresh, so the old ones are retired.
- **Host hygiene:** non-root deploy user, SSH keys only, automatic security updates, unattended `docker` log
  rotation, DigitalOcean monitoring agent.
- **Data handling:** the snapshot and Cube Store hold lab order data. Before moving, confirm with compliance
  whether this data is PHI under your policies and whether a business associate agreement with DigitalOcean is
  required or available. If it is, that decides whether this proposal can proceed.

## 6. Migration plan (parallel run, instant rollback)

1. **Provision:** Droplet, firewall, domain record, Caddy, Docker. Nothing public except 443.
2. **Cube:** copy the `cube/model-vibrant/cubes/` model **for this app only** (not the colleague's `revops` models),
   set the new secrets and BigQuery service account, start Cube and let the pre-aggregations build. Confirm every
   query reports `usedPreAggregations` (see `CUBE_ROLLUPS.md`).
3. **Engine:** build the image from this repo (`engine/deploy`), point it at the new Cube, run
   `POST /admin/rebuild`.
4. **Parity check:** compare the new snapshot with the current server's snapshot with the existing comparison
   scripts (headline revenue and orders, clinic counts, scorecard cells, lifecycle counts). They must match.
5. **Smoke tests:** run the resilience script used on 2026-10-20 (malformed requests, Cube down, failed rebuild,
   load, password-guess throttle) against the new engine, and the UI smoke script
   (`engine/scripts/ui-smoke.mjs`) against a preview frontend.
6. **Cutover:** set `VITE_RCA_API_URL` to the new address and redeploy the frontend. Convex needs no change.
   Keep the old server running for a week as the rollback (revert the variable and redeploy).
7. **Decommission:** stop the old engine and, importantly, the old Cube tunnel; delete the old Cube secret.

## 7. Operations

- **Deploys:** the server pulls from git (read-only deploy key) and runs `docker compose up -d --build`; rollback is
  checking out the previous commit. This replaces the tarball copy and removes the dependency on someone running
  commands by hand.
- **Backups:** weekly Droplet snapshots plus a snapshot of the data volume. The snapshot itself is rebuildable from
  Cube in about a minute, and Cube Store from BigQuery, so backups matter mostly for configuration and secrets.
- **Monitoring and alerts:** DigitalOcean uptime check on `/health`; an alert if the snapshot `builtAt` is older
  than 26 hours (a missed daily refresh); alerts on CPU, memory and disk.
- **Refresh schedule:** unchanged (13:00 UTC daily); the scheduler now rebuilds on start when the snapshot predates
  the last slot.
- **Logs:** Docker json logs with rotation, plus Caddy access logs, kept for incident review.

## 8. Availability upgrade path

Because the engine only reads its snapshot, a second engine instance is easy: a second Droplet (or container)
loads the same snapshot and a DigitalOcean Load Balancer sends traffic to both, with `/health` checks. Cube stays
on one node until the load justifies more. The snapshot can be published to Spaces (object storage) by the
builder so replicas load it at start instead of each rebuilding.

## 9. Risks and open questions

| Risk or question | Mitigation or owner |
|---|---|
| PHI or compliance review (BAA, region, access controls) | Compliance sign-off before any data moves |
| BigQuery egress and query cost from outside GCP | Pre-aggregations keep BigQuery reads small; check the current monthly query volume |
| Latency Droplet to BigQuery | Only the daily rebuild and rollup builds use it, not user clicks |
| Single Droplet is a single point of failure | Section 8; the previous server stays as warm standby during the first weeks |
| Domain, DNS and Cloudflare/Vercel changes need IT | IT |
| Who owns the Droplet and its patching | Name an owner before cutover |
| Cube version and model drift from the lab server | Pin the Cube image version; deploy the model from git |

## 10. Effort

Roughly two to three working days: one day to provision, harden and bring up Cube and the engine; one day for the
parity and resilience checks; a short cutover with a week of parallel running. The compliance question is the
only item that can change the timeline.
