import assert from "node:assert/strict";
import { test } from "node:test";
import { buckets, buildTrend } from "../analytics/familyTrend.ts";

test("weeks start on Monday; the first and the current week are partial", () => {
  const w = buckets("2026-01-01", "2026-01-20", "week");
  assert.deepEqual(w.map(b => b.k), ["2025-12-29", "2026-01-05", "2026-01-12", "2026-01-19"]);
  assert.equal(w[0].start, "2026-01-01");
  assert.equal(w[0].partial, true);
  assert.equal(w[1].partial, false);
  assert.equal(w[3].end, "2026-01-20");
  assert.equal(w[3].partial, true);
});

test("months cover the year so far, the current one partial", () => {
  const m = buckets("2026-01-01", "2026-03-10", "month");
  assert.deepEqual(m.map(b => b.k), ["2026-01-01", "2026-02-01", "2026-03-01"]);
  assert.deepEqual(m.map(b => b.partial), [false, false, true]);
});

test("an order with two families counts under each, revenue split evenly", () => {
  const t = buildTrend(
    [
      { d: "2026-01-06", family: "Gut Zoomer, Hormone Zoomer", ord: 2, rev: 200 },
      { d: "2026-01-07", family: "Gut Zoomer", ord: 1, rev: 50 },
      { d: "2025-12-31", family: "Gut Zoomer", ord: 9, rev: 9 },
    ],
    "2026-01-01",
    "2026-01-20",
  );
  assert.deepEqual(t.series["Gut Zoomer"].wOrd, [0, 3, 0, 0]);
  assert.equal(t.series["Gut Zoomer"].wRev[1], 150);
  assert.equal(t.series["Hormone Zoomer"].mOrd[0], 2);
  assert.equal(t.series["Hormone Zoomer"].mRev[0], 100);
});
