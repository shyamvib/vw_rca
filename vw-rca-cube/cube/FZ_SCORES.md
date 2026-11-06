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
- **Product history:** any order for the patient (any clinic, any date) whose order-level `product_family`
  contains the area's family. Matching is by name prefix, so "Neural Zoomer (DBS)" counts. This sets
  `had_product_before` (on or before this FZ order day; the same order counts) and `ordered_product_after`
  (the patient already converted).
- **`target_reason`** takes the first rule that matches. An Optimal score is never a target.

  | Reason | Rule |
  |---|---|
  | After product – not improved | Had the product before, and the area still needs support or is not improving. Otherwise a patient who had the product before is not a target. |
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
vw-rca-cube/scripts/deploy-cube-model.sh shyam vw-rca-cube/cube/model-vibrant/cubes/fz_scores.yml
# wait a few minutes for the first pre-aggregation build, then:
cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
```
This changes the shared production Cube. Tell Shyam first and do it at a quiet time, because Cube is down for
about 10–30 s during the restart. The script prints the exact rollback command, which restores the dated backup
in `~/cube-rca/model-backups/` and restarts Cube.

## Known issues
- **The BigQuery copy of `test_result` was mid re-sync on 2026-11-05.** Airbyte reloaded it that day, and the
  gut-score rows grew from 1,703 to 2,628 within an hour, against 3,678 in the ClickHouse LIS replica. Counts will
  be low until the sync finishes. Compare with
  `SELECT COUNT(*) FROM lab_operations.test_result WHERE testId = 10244` on ClickHouse `lis.test_result` before
  treating numbers as final.
- Few patients have a repeat FZ so far (about 40 per area), so the repeat-test reasons are small today. They grow
  over time.
- "Baseline" products are not separate product families in BigQuery. They appear only as the low price.

## Validation results
<!-- filled in after the first deploy by scripts/fz-scores-check.ts -->
Pre-deploy, run directly in BigQuery on 2026-11-05 against the partial sync:
- No duplicate (sample, area) keys.
- About 2,520 rows per area.
- Gut bands were 31% Needs support, 62% Moderate and 7% Optimal. The earlier ClickHouse report had 32%, 61% and 6%.
