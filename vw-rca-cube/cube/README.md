# vw-rca Cube model (draft)

Drop `model/cubes/*.yml` into your Cube `model/` folder and set env `BQ_DATASET=project.dataset`.

| File | Source | Notes |
|---|---|---|
| customer_rfm_segmented_orders.yml | BQ | cube `rfm_orders` — main RCA fact; adds order-level `product_family`, `is_bundle`, patients, bundle/fee measures for vw-rca |
| fact_order_tests_enriched.yml | BQ | test lines → families; bundle = bundle_name <> 'Non Bundle' |
| customers_bq.yml | BQ | merge with your existing `customers` cube |
| customer_journey_final.yml | BQ | touchpoints / tickets |
| dims.yml | BQ | hubspot_contacts, internal_user (rn=1), sales_commission |
| clinic_dimension.yml | **derived** | Buying Overdue (ratio ≥3, ≤365d) + High Ticket Volume (≥4 tickets/30d); emits `note` |
| portfolio_changes.yml | **derived** | NEW/STOPPED/DECLINING, rules inferred (not yet matching PBI) |

`rfm_orders.patients` = distinct patient_id (a measure, not a table).
Pre-aggregations: daily, partitioned by month, incremental refresh of last 7 days
→ requires a pre-aggregation store (Cube Store) to be running.
Join rule: orders.hubspot_id = bi_hubspot_contacts.contact_id. Never via customer_id.
