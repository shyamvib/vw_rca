# FZ scores cube (`fz_scores`): cross-sell targets from Foundation Zoomer results

Phase 1 (2026-11-05): Cube model plus validation. Phase 2, not built yet, adds it to the Rep view (Scorecard →
Product Growth, Expansion → Cross-sell candidates, Stack mix).

## Why
Every Foundation Zoomer (FZ) order returns system scores. When a patient's score is low in an area, the clinic has
a reason to order that area's Zoomer. The same holds when a score sits just above the low zone while other areas
are weak, or when a re-test shows no improvement. This cube gives the dashboard one row per FZ order and area,
with the band, the trend over every test, and the reason the patient is or isn't a target.

| Area | FZ test (testId) | Product to promote | Potential revenue per patient (low–high) |
|---|---|---|---|
| Gut | GUT_HEALTH_FZ (10244) | Gut Zoomer, or Gut Baseline | $460–$550 |
| Neural | NEURAL_HEALTH_FZ (10243) | Neural Zoomer | $450 |
| Hormone | HORMONE_HEALTH_SCORE_FZ (10249) | Hormone Zoomer, or Hormone Baseline | $410–$500 |
| Nutrition | NUTRITION_HEALTH_FZ (10229) | Nutrient Zoomer, or Nutrient Baseline | $450–$600 |
| Immune | IMMUNE_HEALTH_FZ (10245) | Immune Zoomer | $400 |
| Cardio | CARDIO_HEALTH_FZ (10239) | Cardio Zoomer | $600 |

## Where things are
- Model: `cube/model-vibrant/cubes/fz_scores.yml`. It is a new file, and no existing cube was changed.
- Reference rules: `analytics/fzRules.ts`, with tests in `scripts/fzRules.test.ts` (`bun test scripts/fzRules.test.ts`).
  **A rule change must be made in both the YAML SQL and this file.**
- Validation: `scripts/fz-scores-check.ts`. It recomputes every Cube row in TypeScript and compares the two.
- Deploy: `scripts/deploy-cube-model.sh`. It compiles inside the server's Cube, backs up, installs, restarts, and
  rolls back on failure.

## Data
- **Scores** come from `lab_operations.test_result` UNION ALL `lab_operations.test_result_2_clean`, using the
  `latestTestValue` string. The two tables do not overlap.
- **A valid score** is a plain number from 0 to 100 after trimming. Negatives such as -100 are LIS error codes.
  When a sample and test have more than one row, the highest `latestTestHistoryId` wins, then the latest
  `updated`, then the highest `id`. These are the same rules as the earlier Python project.
- **Order data:** each score joins 1:1 on `sample_id` to `customer_rfm_segmented_orders_bq`, which supplies
  `patient_id`, `clinic_id`, `sales_id` and `order_date`. Samples with no order row are left out.
- **Privacy:** only `patient_id` and scores are exposed. No name, DOB, age or gender. `scripts/fz-scores-check.ts`
  fails if a member with such a name ever appears.

## Rules
- **Bands:** Needs support ≤ 65 < Moderate ≤ 87 < Optimal. Scores are decimals, so a 65.4 counts as Moderate.
- **History is "as of each test".** A patient's tests in one area are ordered by order day, then `sample_id`.
  Each row describes every test up to and including itself: `test_seq`, `prev_score`, `first_score`, `best_prior`,
  `zone_changes`, `steps_up` / `steps_down`, and `slope`. The slope is a least-squares fit in points per test
  over all tests so far, so the trend is never just first vs latest.
- **`trend`** takes the first rule that matches:

  | Trend | Rule |
  |---|---|
  | Single test | Only one test so far |
  | Worsening | In a worse band than the first test, or slope ≤ −3 |
  | Slipping | The last test dropped ≥ 3 points |
  | Improving | Slope ≥ +3 |
  | Changed, then returned | Back in the band it started in, after a band change |
  | No real change | None of the above |

  `not_improving` is true when there are 2+ tests and the trend is not Improving.
- **Which results count:** LIS rows flagged deleted (`isDeleted = 1`) or not approved (`isApproved != 1`) are
  left out (2026-11-06; 6 rows).
- **Product history:** any order for the patient (any clinic, any date) whose order-level `product_family` is the
  area's Zoomer family or its Baseline family. Matching is by name prefix, so "Neural Zoomer (DBS)" counts;
  "Nutrient Baseline" counts for Nutrition. Gut and Hormone Baseline are not separate families in the order data.
  This sets three flags, by order **day**:
  - `had_product_before`: ordered on an **earlier** day than this FZ;
  - `ordered_with_fz`: ordered the **same day** as this FZ, usually on the same order (2026-11-06);
  - `ordered_product_after`: ordered on a later day (the provider acted on the result).
- **`target_reason`** takes the first rule that matches. An Optimal score is never a target.

  | Reason | Rule |
  |---|---|
  | *(not a target)* | The Zoomer was ordered with the FZ (same day): the provider is already on it, and the score is from before the product, not after it |
  | After product – not improved | Had the product on an earlier order, and the area still needs support or is not improving. Otherwise a patient who had the product before is not a target. |
  | *(not a target)* | Ordered the product after this FZ |
  | Needs support | Score ≤ 65 |
  | Repeat test – not improving | Moderate, 2+ tests, not improving |
  | Borderline | Moderate ≤ 75, with 2+ other areas ≤ 65 on the same FZ |

- **`targets_on_sample`** counts the target areas on the same FZ order. A count of 2 or more is a cross-sell
  patient.
- **`is_top20_ytd`:** clinics are ranked by calendar-YTD revenue (sum of `total` in the same orders table). The
  top ceil(20%) by clinic count are in, with ties broken by `clinic_id`. In early January YTD is thin; revisit
  this then.

**Using it for a window (Phase 2):** take the FZ rows ordered in the window and keep each patient's latest row per
area. Its history fields already cover every earlier test.

## Pre-aggregations and cost
- `snapshot` (`original_sql`, every 6 h) materialises the whole SQL once into `prod_pre_aggregations` in BigQuery.
  This uses the same pattern as `portfolio_changes` and `clinic_dimension`. The scan of the LIS table (40M+ rows)
  happens once per refresh and never per query.
- `fz_rows` is a row-level rollup in Cube Store. It serves the engine's per-row pull.
- `fz_clinic_day` holds clinic × area × band × reason × day counts and the potential $. It serves aggregates.
- The full rebuild is intentional: about 15k rows, and "ordered product after" can change on old rows.
- Checked with Cube's compiler: the row pull uses `fz_rows`, aggregates use `fz_clinic_day`, and existing `rfm_orders`
  queries still use their own rollups.

## Deploy, check, roll back
```bash
cd ~/"Documents/RCA Dashboard"
# copy only (live Cube untouched; the next restart loads them):
vw-rca-cube/scripts/deploy-cube-model.sh shyam --no-restart vw-rca-cube/cube/model-vibrant/cubes/*.yml
# copy + restart (refused while a restart would drop any live cube/view):
vw-rca-cube/scripts/deploy-cube-model.sh shyam vw-rca-cube/cube/model-vibrant/cubes/*.yml
# wait a few minutes for the first pre-aggregation build, then:
cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
```
The script finds the production Cube by the port the dashboard uses (:4002) and reads its model folder from the
container's mounts (`cube-rca-cube-rca-1`, `~/cube-rca/model`). It shows what it found and what a restart would
add or drop, then asks before changing anything.

**Incident found 2026-11-05.** Production Cube (:4002, started 2026-10-28) was serving 9 RCA cubes and 45 RevOps
views from memory. Its model folder on disk held none of them, only `thiru_normalized_v2_*` and `fct_order.yml`,
so any restart would have dropped them. The 7 RCA files plus `fz_scores.yml` were copied back from git
(`--no-restart`, backup `~/cube-rca/model-backups/20261105-234849`). All 133 live member names were checked
identical to git first. Before any restart, still open:
- **the RevOps view files** (not in this repo; owner to be found);
- **moving `thiru_normalized_v2_*`, `fct_order.yml` and `views/`** to the :4003 Cube's folder. They are unused
  by the app and were not loaded by the live Cube.

This changes the shared production Cube. Tell Shyam first and do it at a quiet time, because Cube is down for
about 10–30 s during the restart. The script prints the exact rollback command, which restores the dated backup
in `~/cube-rca/model-backups/` and restarts Cube.

## Phase 2: in the Rep view (2026-11-06)
- **Engine.** `analytics/fzScores.ts` `build` runs at every daily snapshot build. It pulls all `fz_scores` rows
  into the `fzScores` table, replacing the patient id with a one-way hash at once. `clinics` takes
  `{periodId, sales}`. For the window and the rep or team it keeps each patient's latest test per area and
  aggregates per clinic in `analytics/fzTargets.ts`. It returns no patient id or hash.
- **Likely $** = target patients × price_low × the area's conversion rate. The rate is the share of patients who
  scored Needs support, had not had the product, and ordered it after the FZ; it is company-wide, all time.
- **Rep view → Scorecard:**
  - the **Stack mix** cell: patients with 2+ Zoomers to pitch; click it for the clinics;
  - **Product Growth**: "Products to promote from FZ scores";
  - **Expansion**: "Clinics to target from FZ scores", with search, product chips, Top 20% only and sortable
    columns, and an "Open in clinic list" button.
  
  All of these follow the selected window. Clinic level only.
- **Window = result date** (2026-11-06): "This week" means FZ results that came back from the lab this week. The
  date is `result_date`, i.e. `test_result.updated` of the chosen row, about 18 days after the order. It is not
  the order date: by order date October looked empty, by result date it has 294 FZ orders. If the cube has no
  `result_day` yet, the engine falls back to the order day.
  **Live on :4002 on 2026-11-06 at about 18:50 UTC** (deploy-cube-model.sh; backup `model-backups/20261106-110939`).
  After the engine rebuild, `fz-targets-check.ts` and `fz-scores-check.ts` both pass. Company-wide, 2026-Q4 by result
  date has 148 clinics, 242 patients to pitch and $287K–$320K potential; by order date it had none.
- **Top 20%** is company-wide: the top 20% of clinics by calendar-year revenue to date, from the cube. It is the
  same in every window and for every rep; the window only decides which FZ results count.
- **Rep view** also has an "FZ score targets" card above the matrix on every pillar, with a "See clinics" button,
  and a "+ N clinics from FZ scores" line in the Expansion × Cross-sell candidates cell. An empty window offers
  "Show all results on file".
- **Checks.** `scripts/fzTargets.test.ts` (15 tests) and `scripts/fz-targets-check.ts`. The second compares the
  engine handler with a recomputation from Cube for each scope × window and confirms no patient id or hash in any
  answer; all passed on 2026-11-06.

## v2: Foundation Zoomer → Cross-sell flow, sales wording, rule fixes (2026-11-06)
- **Rule fix, live on :4002 2026-11-06 at 13:45 server time** (deploy-cube-model.sh; backup `model-backups/20261106-134503`).
  Before, a Zoomer on the same order as the FZ counted as "had the product before", which made 688 of the 862
  "After product – not improved" flags. Now it is `ordered_with_fz` and never a target. Also: deleted / unapproved
  LIS results dropped, Baseline families count as the product. Result: After product 862 → 159, rows 23,098 →
  23,092, target rows 7,272 → 6,525 (see Validation results).
- **Counting unit for sales: an "FZ result"** = a patient's latest FZ in the window, in one area. The dashboard
  never says "patients". Per clinic and per Zoomer (`analytics/fzTargets.ts`):
  - *pointing to a Zoomer* (flagged) = still open + led to an order;
  - *led to an order* = not Optimal, no product before or with the FZ, and the Zoomer (or Baseline) ordered later;
  - *still open* = a target (`is_target`);
  - *at stake* = Baseline–Zoomer price per open result; *likely* = at the area's conversion rate;
  - *cross-sell* = FZ orders open in 2+ areas (kept in the data; on the page only as "one patient needs more than one
    of these" in the clinic note; the KPI was removed 2026-11-06 as unclear for sales).
  The clinic list also shows the company's follow-up rate in the same window.
- **Where it is in the Rep view:** Product families → **Foundation Zoomer** tile. Selecting it turns
  **Expansion × Cross-sell candidates** into the FZ clinic list: Zoomer buttons (counting clinics), Top 20% only,
  KPIs and a two-line note for what is picked, every clinic's usual columns plus "FZ open" and "At stake". Expanding
  a clinic shows a plain-language note (Why call / Suggest / Ask the provider), one chip per Zoomer, then the clinic
  card. Removed on 2026-11-06 at Thiru's request: the FZ score targets panel above the matrix, the "FZ targets · N
  clinics · $" line on the tile, the cross-sell KPI, and "Show all results on file".
- **Windows:** This · Last toggle on the Week, Month and Quarter tabs. The engine's `"all"` window means every FZ
  result (from 2026-02-20), not the dashboard's analysis window (from 2026-05-01). No "last year": there is no FZ
  data before 2026-02-20.
- **Numbers after the fix**, company-wide (`team:*`): Q3 317 clinics, 2,893 FZ results pointing to a Zoomer,
  39 led to an order, 2,854 open, $1.36M–$1.50M at stake; Q4 to date 142 clinics, 550 / 8 / 542, $259K–$286K.
  The sales story: about **1 in 75** FZ results that point to a Zoomer leads to one.

## Known issues
- **FZ system scores mostly stopped arriving from mid-September 2026 (upstream, in the LIS).** Gut scores per
  month were about 500 through August, then 201 in September, 63+71 in October and 3 in November. Over the same
  months Foundation Zoomer orders held steady: 661 in September, 624 in October. The drop is the same in
  ClickHouse `lis.test_result*` and in BigQuery, and no other result table or `zoomer_results` table holds the
  missing scores. So October/November windows show almost no targets. Raise it with the LIS / lab team.
- **The BigQuery copy of `test_result` was mid re-sync on 2026-11-05.** Airbyte reloaded it that day, and the
  gut-score rows grew from 1,703 to 2,628 within an hour, against 3,678 in the ClickHouse LIS replica. Counts will
  be low until the sync finishes. Compare with
  `SELECT COUNT(*) FROM lab_operations.test_result WHERE testId = 10244` on ClickHouse `lis.test_result` before
  treating numbers as final.
- Few patients have a repeat FZ so far (about 40 per area), so the repeat-test reasons are small today. They grow
  over time.
- "Baseline" products are not separate product families in BigQuery. They appear only as the low price.

## Validation results
**Live on production Cube :4002 since 2026-11-06 ~08:15 UTC.** The restart used
`--allow-drop revops_report_territory_`: the 45 old RevOps views on :4002 are superseded by the 44 on :4001,
where the 12 `pair_b_*_both/_primary` views are consolidated. All 9 RCA cubes are still served.

`scripts/fz-scores-check.ts`, 2026-11-06: **all checks passed**.
- 23,098 rows: 3,853 FZ orders, 3,758 patients, 611 clinics. The BigQuery sync has caught up; ClickHouse had
  about 3,900 gut samples with an order.
- One row per (sample, area); one order per sample; bands match the cut-offs; no Optimal row is a target.
- The SQL rules equal the TypeScript rules on **every** row: trend, not_improving, co_low_areas, target_reason
  and targets_on_sample.
- The row pull is served by `fz_rows`; the area/band totals from `fz_clinic_day` equal the row counts.
- No patient name, DOB, age or gender fields.
- First query after the restart waited about 10 min for the first build; after that, about 10 s.

All tests, every clinic, all dates (Phase 2 will apply the window and keep the latest test per patient):

| Area | Needs support | Moderate | Optimal | Targets | in top-20% clinics | Potential $ (low–high) |
|---|---|---|---|---|---|---|
| Gut | 1,228 | 2,377 | 247 | 1,482 | 1,309 | $682K–$815K |
| Neural | 959 | 1,926 | 966 | 1,259 | 1,109 | $567K |
| Hormone | 915 | 2,525 | 412 | 1,290 | 1,148 | $529K–$645K |
| Nutrition | 751 | 2,065 | 1,036 | 1,032 | 904 | $464K–$619K |
| Immune | 563 | 1,587 | 1,701 | 706 | 626 | $282K |
| Cardio | 1,165 | 2,077 | 598 | 1,503 | 1,323 | $902K |

- **Target reasons:** Needs support 4,702 · Borderline 1,554 · After product – not improved 862 · Repeat
  test – not improving 154.
- **Cross-sell:** 1,696 of 3,853 FZ orders have 2 or more target areas.
- **Potential $ is the ceiling.** It assumes every target orders. Phase 2 adds realistic conversion rates
  (organic and peer).

**After the v2 rule fix (2026-11-06, live on :4002):** `fz-scores-check.ts` all passed: 23,092 rows, 3,852 FZ
orders; SQL rules = TypeScript rules (now including `ordered_with_fz`) on every row.

| Area | Needs support | Moderate | Optimal | Targets | in top-20% clinics | Potential $ (low–high) |
|---|---|---|---|---|---|---|
| Gut | 1,228 | 2,376 | 247 | 1,123 | 991 | $517K–$618K |
| Neural | 959 | 1,926 | 965 | 1,203 | 1,059 | $541K |
| Hormone | 915 | 2,524 | 412 | 1,223 | 1,091 | $501K–$612K |
| Nutrition | 751 | 2,065 | 1,035 | 864 | 758 | $389K–$518K |
| Immune | 563 | 1,587 | 1,700 | 649 | 572 | $260K |
| Cardio | 1,164 | 2,077 | 598 | 1,463 | 1,287 | $878K |

- **Target reasons:** Needs support 4,677 · Borderline 1,536 · After product – not improved 159 · Repeat test – not
  improving 153.
- **Cross-sell:** 1,595 of 3,852 FZ orders have 2 or more target areas.
- `fz-targets-check.ts` (engine snapshot vs Cube, same-order rule on): all passed for 35 scope × window answers
  (3 reps, a team, the company × all results, this/last quarter, month and week); no patient id or hash in any
  answer.
