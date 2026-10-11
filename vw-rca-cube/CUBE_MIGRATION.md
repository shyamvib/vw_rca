# vw-rca on Cube (replaces Power BI DAX)

## What changed
- `convex/cube.ts` (new): Cube REST client. Signs a short-lived HS256 JWT from
  `CUBE_API_SECRET`, calls `/cubejs-api/v1/load`, handles "Continue wait",
  retries transport errors, caps concurrency at 8, and pages past 50k rows.
  `ordersRows()` / `rows()` return rows keyed like the old DAX results, so all
  downstream aggregation (cohorts, baselines, flags, funnels) is unchanged.
- `convex/refresh.ts`: all 28 Power BI pulls (×2: live refresh + historical
  snapshot) now Cube queries. Same windows, same keys.
- `convex/families.ts`: all 15 live drill queries (family clinics, customer
  drill, clinic portfolio, unmapped tests, pair switch, provider search).
- `convex/clinicalTouch.ts`: 2-step Cube query (clinic → HubSpot ids → touchpoints).
- `convex/powerbi.ts`: Power BI transport removed; only row helpers remain.
- `cube/model/cubes/*.yml`: the Cube model this code expects (load it first).

## Setup
1. Load `cube/model/cubes/*.yml` on the Cube server (`BQ_DATASET` env set).
   Remove the old `orders.yml` duplicate if still loaded.
2. Convex env vars: `CUBE_API_URL` (stable host, no `/cubejs-api` suffix) and
   `CUBE_API_SECRET`.
3. Deploy; hit Refresh. The refresh log reads "Refreshing from Cube…".

## Model members the code needs (new vs the first draft)
rfm_orders: customer_name, customer_type, charge_method, hubspot_id,
hubspot_link, customer_signup_time, product_family, is_bundle,
header_bundle_blank; measures patients, bundle_orders, bundle_revenue,
first_order, last_order, first_signup, last_hubspot_link, deductions.
journey: engagement_id, last_touch. clinic_dimension: note (+ Thiru's rules).
portfolio_changes: 33-test whitelist, 28d vs prior 84d (inferred).

## Known gaps
- Portfolio Changes rules are inferred; counts differ from Power BI
  (STOPPED 1,149 vs 1,218, NEW 1,965 vs 2,325, DECLINING 417 vs 192).
- High Ticket Volume rebuilt per Thiru's rule but not yet reconciled (PBI 339).
- BigQuery column names for the new rfm_orders members come from the Power BI
  model (customer_name, charge_method, patient_id, consultation_fee, markup_fee,
  blood_draw_fee, hubspot_link, customer_signup_time); Cube will error at load
  if any differ in BigQuery.
- UI copy still says "Power BI" in two pages.

## Update 2026-10-10 — synced with latest live dashboard
- Rep View: Product Growth pillar (`convex/productGrowth.ts`, ported to Cube via `ordersRows`), new schema table `productEligible`, RepView UI/CSS updates.
- refresh.ts: OOM fix (release raw row arrays after use), per-clinic baseline perf fix, main window always rolls forward to latest data.
- families.ts: `periodRange` exported; dateUtils/index.html synced.
