# CLAUDE.md

Guidance for Claude Code (and future sessions) working in this repo. Personal setup (your own dev branch, dev copy,
working style) goes in a git-ignored `CLAUDE.local.md` next to this file, not here.

Never ask for secrets in chat and never write real values into committed files: route credentials through hidden prompts (`read -s`) or the relevant dashboard (Vercel, Convex, server `.env`).

## Repo layout
- `vw-rca-cube/` — the app: Vite+React frontend, Convex (app-state backend), a Node "engine" (`engine/`, `analytics/`) that serves computed data from an in-memory snapshot rebuilt from Cube, and the Cube models (`cube/`). This is the only active project — treat it as the working directory for npm/convex/engine commands.
- Root-level `Revenue Shortfall Tree*.html`, `_ds/`, `support.js` — early static prototypes, not the live app.
- `.claude/skills/growth-review/` — skill for goals, targets, growth plans and gap analysis grounded in BigQuery and the dashboard's logic.

## Branches and deploys
- `main` is production: Vercel + Convex cloud + the `rca-engine` container on 10.6.2.34.
- Merging into `main` publishes the page on Vercel within minutes, but the production engine is deployed by hand (`vw-rca-cube/DEPLOY_VERCEL_CONVEX.md`). When a change adds or changes an engine function the page calls, **deploy the engine first, then merge** — a new page against an old engine shows an error.

## Running your own copy (dev environment)
**Read `vw-rca-cube/LOCAL_DEV.md` first.** It's the source of truth for env vars and the Convex / engine / Vercel setup. Don't re-derive or duplicate it here — if this file and LOCAL_DEV.md disagree, LOCAL_DEV.md wins and this section should be fixed. `vw-rca-cube/HOSTING_THIRU_DEV.md` is a worked example of a hosted dev copy (own Vercel + own Convex + an engine reading the shared Cube).

**Hard rules** (from LOCAL_DEV.md, repeated here because getting these wrong affects production, not just your own copy):
- Never put a production `CUBE_API_SECRET`, `CONVEX_URL`, or Convex admin/deploy key in a dev `.env`.
- Never set `TUNNEL=1` with the **production** `CONVEX_URL` — the engine publishes its tunnel URL there, and every user's dashboard would start calling your machine.
- Never commit `.env*` files or the `/data` snapshot folder (clinic-level data) — both are git-ignored; keep it that way.

## Cube models
- Production Cube (`cube-rca`, shared) is modeled in `vw-rca-cube/cube/model-vibrant/`. Deploy changes with `vw-rca-cube/scripts/deploy-cube-model.sh` (compiles inside the container, refuses a restart that would drop a live cube, backs up, rolls back) and check revenue afterwards with `scripts/revenue-reconcile.ts`.
- Rollups rebuild **all history once a day** (12:00 UTC, an hour before the engine's 13:00 UTC rebuild), not only the last few days: BigQuery removes and re-prices old orders, and partitions that are never rebuilt drift (2026-11-06: 2026 YTD was $574K too high).
- A second, independent Cube model under development (`thiru_normalized_v2_*`, a separate Cube instance) uses a different schema — an orders/clinics/providers star schema, not `rfm_orders`/`journey`/`customers`/`portfolio_changes`. It is **not** a drop-in replacement: `analytics/cube.ts` and roughly 8 handler files query the old names directly. Swapping to it means either Cube-side compatibility views (preferred — no app-code changes needed) or rewriting the query layer. Don't point a shared or production engine at it until a cube-by-cube migration has been validated against known-good numbers from the current Cube.

## Don't re-derive what's already documented
Before re-deriving deploy, Cube, or data-model mechanics from scratch, check:
- `vw-rca-cube/README.md`, `DEPLOY_VERCEL_CONVEX.md`, `LOCAL_DEV.md` — architecture and deploy
- `CUBE_MIGRATION.md`, `CUBE_ROLLUPS.md`, `cube/README.md` — Cube model and pre-aggregations
- `CLINIC_LIFECYCLE.md` — lifecycle/flag definitions
- `CAM_LOGINS.md` — client account manager logins (rep view only, limited to their reps; `engine/camGuard.ts` allows calls by name)
- `cube/FZ_SCORES.md` — FZ system-score cube (`fz_scores`): cross-sell target rules, deploy, validation
- `PROPOSAL_CUBE_FIRST_REFACTOR.md`, `PROPOSAL_DIGITALOCEAN_HOSTING.md` — proposed, not-yet-built architecture changes
