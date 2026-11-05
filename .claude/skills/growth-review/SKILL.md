---
name: growth-review
description: Gap analysis and growth plan for Vibrant's revenue, grounded in BigQuery and the RCA dashboard's logic. Use when asked for quarterly or annual goals, targets, growth plans, "where are we behind", gap analysis, or an executive/board-style business review.
---

# Growth review

Produce a business review a COO or CRO could act on: where revenue stands, why, and what to do next quarter and next year. Every number must come from a query you ran in this session or from the dashboard's own logic, never from memory.

## 1. Pin the frame before querying
State these at the top and ask only if the request leaves them genuinely ambiguous:
- Period under review and comparison (e.g. YTD vs same period last year, last quarter vs the one before).
- The target in force. The dashboard's default annual target is $130M (`vw-rca-cube/analytics/config.ts`); the live value is whatever Settings holds, so confirm it.
- Scope: company, team lead, rep, state, or product family.

## 2. Current state, from data
Source of truth: BigQuery `vibrant-lab-datamodels.business_intelligence` (`customer_rfm_segmented_orders_bq` for orders and revenue (`total`), `fact_orders_tests_enriched_bq` for product families). Revenue = `SUM(total)` by `DATE(order_date)` — the same definition Cube's `rfm_orders.revenue` uses.
- Headline: revenue, orders, AOV, active clinics, YTD vs target, projected close.
- Projection: reuse the dashboard's method (`analytics/refresh.ts` "4c. Year-end projection" + `analytics/projection.ts`): weekday run rate over the trailing 91 days × prior-year seasonal factor per remaining day. Don't invent a different forecast.
- Exclude today's partial day; say the data-through date.

## 3. Decompose the gap
Break the gap to target into drivers the business can act on, using the dashboard's own cuts:
- Volume vs price: orders × AOV.
- New vs existing vs returning vs churned clinics (`CLINIC_LIFECYCLE.md`).
- Team lead / rep, state, product family, bundle penetration, charge channel.
Rank drivers by dollar impact. Show the arithmetic so it reconciles to the total.

## 4. Recommendations
For each of the top 3–5 drivers:
- What to do, who owns it (team/role), the metric that proves it worked, and the target for next quarter and for the year.
- Size it: dollars recoverable, with the assumption stated (e.g. "win back 20% of the 150 churned clinics at their prior run rate").
- Confidence and the main risk.

## 5. Gaps in the data or the dashboard
Call out anything that limits the analysis (stale snapshot, unmapped product families, Cube model gaps, definitions that differ from Finance) and what it would take to fix — these feed the engineering roadmap.

## Output format
1. One-paragraph executive summary with the headline numbers and the single most important action.
2. Current state table.
3. Gap bridge (driver → $ impact), reconciling to the total gap.
4. Recommendations table (action, owner, metric, Q+1 target, FY target, $ sized, confidence).
5. Data caveats.
6. The SQL used, in an appendix, so anyone can rerun it.

When the review is for other people (leadership, a team), offer to publish it as a document or page rather than leaving it in the terminal.
