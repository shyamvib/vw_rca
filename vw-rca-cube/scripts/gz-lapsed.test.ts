import assert from "node:assert/strict";
import { test } from "node:test";
import { lapsedOf } from "../analytics/gzLapsed.ts";
import { gzLapsedItem } from "../analytics/feedItems.ts";

test("clinics with Gut Zoomer last year and none this year, with orders and last date", () => {
  const out = lapsedOf(
    [
      { clinic: "1", date: "2025-03-02", n: 2 },
      { clinic: "1", date: "2025-09-14", n: 1 },
      { clinic: "2", date: "2025-06-01", n: 4 },
      { clinic: "3", date: "2025-07-07", n: 0 },
    ],
    new Set(["2"]),
  );
  assert.deepEqual(out, [{ clinic: "1", orders: 3, lastOrder: "2025-09-14" }]);
});

test("the feed item counts clinics that still order other tests apart from those gone entirely", () => {
  const rows = [
    { clinic: "1", name: "A", state: "CA", sales: "R1", orders: 5, lastOrder: "2025-09-14", otherOrders: 3, revenue: 4200, revenueThis: 300 },
    { clinic: "2", name: "B", state: "TX", sales: "R2", orders: 2, lastOrder: "2025-02-01", otherOrders: 0 },
  ];
  const it = gzLapsedItem(rows, 2026)!;
  assert.equal(it.focus, "gzlapsed");
  assert.match(it.q, /2025 but not in 2026/);
  assert.match(it.a, /2 clinics ordered Gut Zoomer in 2025 \(7 Gut Zoomer orders/);
  assert.match(it.a, /1 of them still order other tests this year; 1 have not ordered anything/);
  assert.match(it.a, /\$4K of revenue \(all products\) in 2025 and \$300 so far in 2026/);
  assert.match(it.detail ?? "", /^A \(R1, CA\)/); // biggest revenue first
  assert.equal(gzLapsedItem([], 2026), null);
});
