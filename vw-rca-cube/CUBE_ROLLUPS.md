# Phase 1 — Cube rollups (model-only, no app code changes)

Applies to both `cube/model` and `cube/model-vibrant`. Requires Cube Store (already in docker-compose).

## 1. Measure changes (`rfm_orders`)
`orders`, `va_orders`, `bundle_orders`: `count_distinct sample_id` → `type: count`.
Reason: count_distinct is non-additive, so Cube can't serve YTD / per-clinic / lifetime
queries from a day rollup. `sample_id` is the primary key; Cube de-dupes on it when the
`order_tests` join fans out.

**Check before deploying.** These must be equal, otherwise the fee join is fanning out:
```sql
SELECT COUNT(*), COUNT(DISTINCT o.sample_id)
FROM `vibrant-lab-datamodels`.business_intelligence.customer_rfm_segmented_orders_bq o
LEFT JOIN `vibrant-lab-datamodels`.business_intelligence.hs_customer_rfm_orders f USING (sample_id);
```

## 2. New pre-aggregations
| Rollup | Grain | Serves |
|---|---|---|
| `rfm_orders.rca_daily` | day × clinic, practice, sales_id, team_lead, state, country, charge_method, product_family, bundle flags, test type | daily/state/channel/identity, YTD + fwd-90 (lead & clinic), VA target, lifetime/last/first order, first signup, family series, familyStops, the ~100 month-sliced order-date-history queries |
| `rfm_orders.rca_clinic_patients_day` | day × clinic_id | clinicQuery (needs `patients`, exact match) |
| `rfm_orders.rca_total_patients_day` | day | pDaily (needs `patients`, exact match) |
| `rfm_orders.rca_hubspot_clinic` | day × hubspot_id, clinic_id | Ghosted-VIP hubspot→clinic map |
| `journey.rca_contact_touch_day` | day × contact_id, type, category | last touch, Call/Meeting dates, Clinical Activity dates, newClinicTouches |

Existing `daily_clinic` and `daily_touch` are kept.

Not rolled up (left on raw BigQuery): `customers` signups and the signup→first-order query
(customer-level rows, a rollup would just be a copy), `internal_user`, `sales_commission`,
`portfolio_changes` (small dimension tables).

## 3. How to verify locally
1. Run the SQL check above.
2. Restart cube-rca and let the first build finish (lifetime partitions from the earliest order).
3. Trigger Refresh. In Cube logs / Playground each query should show `usedPreAggregations`.
   Any query still hitting BigQuery shows which rollup it missed.
4. Compare headline revenue/orders, clinic counts and flags with the current snapshot. They should match exactly.
