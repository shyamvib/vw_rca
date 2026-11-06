# CLAUDE.md

Guidance for Claude Code (and future sessions) working in this repo.

## How to work in this repo
Thiru is building on this dashboard and is new to software-engineering practice. Act as three advisors at once:
- **Architect / senior engineer** — build production-grade, not just working: small reviewable commits, tests or a verification step for every change, secrets out of code, changes that can merge back into `shyamvib/vw_rca` cleanly. Explain each step in plain language with the exact command and the file location.
- **Consultant** — name gaps, risks and trade-offs before being asked; recommend one option instead of listing many.
- **Executive advisor** — tie technical work to revenue impact; for goals, targets or growth plans use the `growth-review` skill (`.claude/skills/growth-review/`) and ground every number in data.

Never ask for secrets in chat and never write real values into committed files: route credentials through hidden prompts (`read -s`) or the relevant dashboard (Vercel, Convex, server `.env.dev`).

## Repo layout
- `vw-rca-cube/` — the app: Vite+React frontend, Convex (app-state backend), a Node "engine" (`engine/`, `analytics/`) that serves computed data from an in-memory snapshot rebuilt from Cube, and the Cube models (`cube/`). This is the only active project — treat it as the working directory for npm/convex/engine commands.
- Root-level `Revenue Shortfall Tree*.html`, `_ds/`, `support.js` — early static prototypes, not the live app.
- `BRANCHES.md` — what each branch on `origin` is for. It's a manual snapshot; re-run `git fetch` + a branch survey before trusting it on anything time-sensitive.

## Branch conventions
- `main` is production (Vercel + Convex cloud + `rca-engine` on 10.6.2.34).
- `thiru_dev_main` is Thiru's long-lived dev branch; Vercel deploys it. Keep it current with `git fetch origin && git merge origin/main`.
- **All of Thiru's new work is committed and pushed straight to `thiru_dev_main`. Do not create feature branches** (locally or on the fork): Vercel's production branch is `thiru_dev_main`, and any other pushed branch triggers a preview build that fails by design (the Convex deploy key is production-only).
- `thiru_dev_<name>` branches are Thiru's local copies of other people's unmerged branches, for experimenting without touching their branch.
- As of 2026-11-04, the `rvatthiru` GitHub account has **read-only** access to `shyamvib/vw_rca` (`pull: true, push: false`). Check current access (`gh api repos/shyamvib/vw_rca --jq .permissions`) before assuming a push will work. If it's still read-only, prepare commits locally and hand off to someone with write access, or work from a fork.

## Running your own copy (dev environment)
**Read `vw-rca-cube/LOCAL_DEV.md` first.** It's the source of truth for env vars and the Convex / engine / Vercel setup. Don't re-derive or duplicate it here — if this file and LOCAL_DEV.md disagree, LOCAL_DEV.md wins and this section should be fixed.

Thiru's hosted dev copy (Vercel + own Convex project `vw-rca-thiru` + engine running on Thiru's Mac via `vw-rca-cube/scripts/thiru-local-engine.sh` (launchd service, quick tunnel), reading only the shared Cube on 10.6.2.34; the Docker engine on 10.6.2.34 is a stopped fallback — never run both, each announces itself to Convex) is documented step by step in **`vw-rca-cube/HOSTING_THIRU_DEV.md`**.
- Compose: `vw-rca-cube/engine/deploy/docker-compose.dev.yml` (project `rca-thiru`, container `rca-engine-thiru`, volume `rca_engine_data_thiru`, `TUNNEL=1` — safe only because its `CONVEX_URL` is Thiru's own Convex); env template `engine/deploy/env.dev.example` (template only, never real values).
- Run it from the unpacked engine tarball: `docker compose -p rca-thiru -f engine/deploy/docker-compose.dev.yml --project-directory . --env-file .env.dev up -d --build`.
- It reaches the shared Cube through its **published host port** (`http://10.6.2.34:4002`), not production's Docker network name (`cube-rca:4000`).
- Git remotes: `origin` = `shyamvib/vw_rca` (read-only, pull from it), `thiru` = `thiruvibrant/vw_rca` (fork, push here; Vercel deploys `thiru_dev_main` from it). Commit identity in this repo: `thiruvibrant <thirunarayanan.r@vibrant-america.com>`.

**Hard rules** (from LOCAL_DEV.md, repeated here because getting these wrong affects production, not just your own copy):
- Never put a production `CUBE_API_SECRET`, `CONVEX_URL`, or Convex admin/deploy key in a dev `.env`.
- Never set `TUNNEL=1` with the **production** `CONVEX_URL` — the engine publishes its tunnel URL there, and every user's dashboard would start calling your machine.
- Never commit `.env*` files or the `/data` snapshot folder (clinic-level data) — both are git-ignored; keep it that way.

## Cube models
- Production Cube (`cube-rca`, shared, read-only for developers) is modeled in `vw-rca-cube/cube/model-vibrant/`.
- A second, independent Cube model under development (`thiru_normalized_v2_*`, a separate Cube instance) uses a different schema — an orders/clinics/providers star schema, not `rfm_orders`/`journey`/`customers`/`portfolio_changes`. It is **not** a drop-in replacement: `analytics/cube.ts` and roughly 8 handler files query the old names directly. Swapping to it means either Cube-side compatibility views (preferred — no app-code changes needed) or rewriting the query layer. Don't point a shared or production engine at it until a cube-by-cube migration has been validated against known-good numbers from the current Cube.

## Don't re-derive what's already documented
Before re-deriving deploy, Cube, or data-model mechanics from scratch, check:
- `vw-rca-cube/README.md`, `DEPLOY_VERCEL_CONVEX.md`, `LOCAL_DEV.md` — architecture and deploy
- `CUBE_MIGRATION.md`, `CUBE_ROLLUPS.md`, `cube/README.md` — Cube model and pre-aggregations
- `CLINIC_LIFECYCLE.md` — lifecycle/flag definitions
- `cube/FZ_SCORES.md` — FZ system-score cube (`fz_scores`): cross-sell target rules, deploy, validation
- `PROPOSAL_CUBE_FIRST_REFACTOR.md`, `PROPOSAL_DIGITALOCEAN_HOSTING.md` — proposed, not-yet-built architecture changes
