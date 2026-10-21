# Proposal: Cube-first architecture (retire the analytics engine)

Status: proposal, nothing built. Written 2026-10-20. This is the "Phase 2" direction discussed when the engine was
introduced: move the dashboard's logic into Cube and the warehouse so the browser can query Cube directly, and the
engine shrinks to a thin sign-in layer or disappears.

## 1. Where we are

```
 BigQuery ─► Cube (raw facts + rollups) ─► builder (Node, ~50 s nightly) ─► snapshot (memory + files)
                                                                               │
 browser ──────────────── rca-engine serves every click from the snapshot ◄────┘
 Convex: logins, settings, plans (app state only)
```

Cube returns totals of raw facts (orders, revenue, patients by clinic, day, state, product family). Everything that
gives those numbers meaning is TypeScript that runs in the builder and the engine, about **17,500 lines** in
`analytics/` and `engine/`:

| Logic | Where it lives today | Size / notes |
|---|---|---|
| Rolling baselines per clinic and period, best 91 days, goal factors and the new-business goal | `refresh.ts`, `baseline.ts`, `topDown.ts`, `dateUtils.ts` | `refresh.ts` alone is 4,400 lines |
| Lifecycle: new / existing / returning / churned, own-pattern churn threshold, own-history baseline | `lifecycleRules.ts`, `refresh.ts` | pure functions, easy to test |
| Cohorts, health flags, new-clinic funnel, stuck clinics | `flags.ts`, `newClinicFunnel.ts`, `clinics.ts` | |
| Scorecard cells, dials, contributor lists, tenure cuts | `repView.ts`, `RepView.tsx` | numbers in `repView.ts`, presentation in the frontend |
| Product families, expectations, portfolio, product growth | `families.ts`, `productGrowth.ts`, Cube `portfolio_changes` | status model is already in Cube |
| Projection, business feed, insights | `projection.ts`, `feed.ts`, `insights.ts` | |
| Rep and team scoping, session checks | `gated.ts`, `repAuth.ts` | enforcement is in the engine |

The engine exists because Cube's REST API cannot compute this: a dashboard load would otherwise need the roughly 40
queries a rebuild sends (25-60 seconds), and the baselines are percentile maths that Cube does not do on the fly.

## 2. Target architecture

```
 BigQuery ──► scheduled SQL / dbt models (baselines, lifecycle, goal tables)  ◄── the heavy maths moves here
      │
      └──► Cube: cubes + views over those tables, pre-aggregations, row-level rules (queryRewrite)
                    ▲
 browser ── short-lived Cube token (signed after Convex login; claims: rep, role, team lead)
 Vercel static frontend
 Convex: logins, settings, plans  (+ one action that signs the Cube token)
```

- **Heavy maths in the warehouse, not in Node.** Rolling 13-week percentiles, typical gaps between orders,
  first-order dates, own-history baselines, churn thresholds and portfolio statuses become tables or views in
  BigQuery (scheduled queries or dbt), refreshed nightly. Percentiles and medians are not additive, so Cube cannot
  derive them from rollups; they must be precomputed at clinic x day grain.
- **Cube as the semantic layer.** Cubes and views expose clinic-period facts joined to those baseline tables, with
  pre-aggregations so a click is answered from Cube Store in milliseconds.
- **Row-level security in Cube.** `queryRewrite` reads the token's claims and adds the rep or team-lead filter to
  every query, replacing the engine's scoped / gated functions. An all-reps login is a claim, not an engine patch.
- **Settings as query inputs.** The yearly target and new-business goal live in Convex. Goal factors are simple
  multiplications on the baseline, so they are applied in the frontend (or passed as a security-context value),
  not stored in the warehouse.
- **UI-side logic stays in the frontend.** Ranking actions, plan likelihoods, contributor splits and wording are
  presentation logic over Cube results; most of it is already in `RepView.tsx`.
- **Thin token service.** A Convex action (or a tiny endpoint) signs the token after login. This is the only
  server code left; the engine, snapshot, builder and in-memory database are retired.

## 3. What gets better

| Today | Cube-first |
|---|---|
| Nightly snapshot, data is up to a day old until the next rebuild | Data as fresh as the warehouse and rollup schedule; no rebuild step to miss |
| Business rules in 17,500 lines of TypeScript in one service | Metrics defined once in SQL / Cube, usable by any tool (BI, notebooks, other dashboards) |
| One process on one server serves everyone | Cube scales independently, rollups are shared and cached |
| Failure modes of a custom in-memory store | Standard components with documentation and community |
| Engine, builder, snapshot and tunnel to operate | Cube and the warehouse only |

## 4. What gets harder or riskier

- **Rewrite scale and parity.** The logic has been reconciled through many rounds (goal tie-outs, lifecycle counts,
  scorecard cells). Re-expressing it in SQL means re-proving every number. Every phase needs a side-by-side
  comparison against the current snapshot (the comparison scripts already used for deploys are the starting point).
- **Query count and latency.** A page needs many measures. Without care it becomes dozens of Cube calls per view.
  Views, batching and cached rollups are required, and cold queries against raw BigQuery must be avoided.
- **Logic that is awkward in SQL.** Time-boxed rules (own-pattern churn, best 91-day window selection, weekday
  weighting of goals, projections) are doable but harder to read, test and change than TypeScript.
- **Testing.** Today the rules are plain functions with offline tests. In SQL, tests need dbt tests or a fixture
  dataset and a harness.
- **Cost.** More BigQuery computation (scheduled models) and a bigger Cube Store. Likely small at this data size,
  but measure before committing.
- **Security shifts.** Row-level rules move into `queryRewrite`; a mistake there exposes other reps' data, so it
  needs its own test suite (the same style of checks used on the engine).

## 5. Phased plan (each phase ships and is compared before the next)

| Phase | Work | Exit check |
|---|---|---|
| 0 (done) | Cube model and rollups (`CUBE_ROLLUPS.md`), portfolio status in Cube | rollups used by every query |
| 1 | Move **baselines and lifecycle** to warehouse tables: clinic baseline (best 91 days, own-history), typical gap, churn threshold, first order, new / existing / returning | table values equal the snapshot's `clinicMeta` for all ~7,000 clinics |
| 2 | Expose them in Cube views; move **scorecard numbers and dials** (existing, new, combined; retention, NRR, churn, repeat) to Cube queries; frontend reads them directly | headline and cell values equal the engine for this week, month and quarter |
| 3 | Token service and `queryRewrite` row-level security; run rep, team-lead and all-reps logins against Cube | security test suite: a rep token never returns another rep's rows |
| 4 | Move **Rep view**: touch effort, plan pools, product statuses and lists, funnel | rep book and plan numbers equal the engine for a sample of reps |
| 5 | Move feed and insights; switch the frontend off the engine | one week in parallel with identical numbers |
| 6 | Retire the engine, builder, snapshot and quick tunnel | rollback kept for two weeks |

Parity gates are the point: after each phase the engine is still running, and any difference blocks the phase.

## 6. Effort and recommendation

A rough estimate is **three to five months** of part-time work, dominated by phases 1, 2 and 4 (re-expressing and
re-proving the metric logic), not by Cube configuration. The engine works and is tested, so this is a decision about
long-term shape, not an urgent fix.

I would start it only if at least one of these is true:
1. Other tools or teams need the same metric definitions (a real shared semantic layer).
2. Fresher-than-daily data matters.
3. Operating the engine and builder becomes a burden, or the user base outgrows one node.

Otherwise the cheaper middle path is to keep the engine and improve its hosting first (see
`PROPOSAL_DIGITALOCEAN_HOSTING.md`), and move individual pieces into Cube when each is touched anyway. Phase 1 on
its own is useful either way: baselines and lifecycle as warehouse tables remove most of the 4,400-line refresh.

## 7. Open questions

- Is the warehouse permitted to hold scheduled models for this app (a dedicated dataset and a service account that
  may write to it)?
- Who maintains the SQL models after the move (dbt skills, review process)?
- Does the sales team need data fresher than daily, which changes the value of this work?
- Which other consumers of these metrics exist (finance, operations dashboards) and would they adopt the Cube
  definitions?
- Cube hosting for the production path: the DigitalOcean proposal or another host.
