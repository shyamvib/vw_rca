// Revenue reconciliation: what Cube's pre-aggregations serve vs what BigQuery holds right now, month by month.
//
//   cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/revenue-reconcile.ts [from YYYY-MM-DD]
//
// Why: the rollups only see BigQuery as of their last build. If old months are not rebuilt, orders that BigQuery later
// removes or re-prices stay in the dashboard (found 2026-11-06: 2026 YTD $574K / 864 orders too high). The daily full
// refresh (cube/model-vibrant/cubes/customer_rfm_segmented_orders.yml) fixes that; this script proves it.
// "Live" = the same cube asked with `payment_status`, a dimension no rollup has, so Cube runs it on BigQuery.
// Prints aggregates only. Exit 1 when any month differs by more than $500 or 0.05%, whichever is larger.
import { load } from "../analytics/cube";

const from = process.argv[2] ?? "2023-01-01";
const to = new Date(Date.now() - 864e5).toISOString().slice(0, 10); // through yesterday: today is still filling up
const td = [{ dimension: "rfm_orders.order_date", granularity: "month" as const, dateRange: [from, to] as [string, string] }];
const M = ["rfm_orders.orders", "rfm_orders.revenue"];
const month = (r: Record<string, unknown>) => String(r["rfm_orders.order_date.month"]).slice(0, 7);

const t0 = Date.now();
const rolled = await load({ measures: M, timeDimensions: td });
const tRoll = Date.now() - t0;
const t1 = Date.now();
const live = await load({ measures: M, dimensions: ["rfm_orders.payment_status"], timeDimensions: td });
const tLive = Date.now() - t1;

const sum = (rows: Record<string, unknown>[]) => {
  const m = new Map<string, [number, number]>();
  for (const r of rows) {
    const t = m.get(month(r)) ?? [0, 0];
    t[0] += Number(r["rfm_orders.orders"]);
    t[1] += Number(r["rfm_orders.revenue"]);
    m.set(month(r), t);
  }
  return m;
};
const a = sum(rolled);
const b = sum(live);
let bad = 0;
let dOrders = 0;
let dRev = 0;
console.log(`month     dashboard (Cube)            BigQuery now               difference`);
for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
  const [ao, ar] = a.get(k) ?? [0, 0];
  const [bo, br] = b.get(k) ?? [0, 0];
  const off = Math.abs(ar - br) > Math.max(500, 0.0005 * br);
  if (off) bad++;
  dOrders += ao - bo;
  dRev += ar - br;
  const f = (o: number, r: number) => `${String(o).padStart(7)}  $${r.toFixed(0).padStart(11)}`;
  console.log(`${k}  ${f(ao, ar)}   ${f(bo, br)}   ${ao - bo >= 0 ? "+" : ""}${ao - bo} orders, ${ar - br >= 0 ? "+" : ""}$${(ar - br).toFixed(0)}${off ? "   <-- off" : ""}`);
}
console.log(`\ntotal difference ${from}..${to}: ${dOrders >= 0 ? "+" : ""}${dOrders} orders, ${dRev >= 0 ? "+" : ""}$${dRev.toFixed(0)}`);
console.log(`query time: dashboard rollup ${tRoll} ms, live BigQuery ${tLive} ms`);
console.log(bad ? `FAIL  ${bad} month(s) differ (more than $500 or 0.05%)` : "PASS  every month matches BigQuery");
process.exit(bad ? 1 : 0);
