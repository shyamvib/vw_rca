import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSaved } from "../convex/growth.ts";
import { annualFactor, DEFAULT_WEIGHTS, discover, priority, recommendation, regionOf, regionSplit, resolve, revenueScore, topQuartile, type ClinicLite, type Inputs } from "../src/lib/growthOpps.ts";

const row = (clinic: string, o: Partial<ClinicLite> = {}): ClinicLite => ({ clinic, name: `C${clinic}`, state: "CA", sales: "R", actual: 100, expected: 100, baseline: 1000, orders: 5, aov: 300, daysSinceTouch: null, ...o });
const inputs = (): Inputs => ({
  windowDays: 182,
  book: { opp: { atRisk: { n: 2, up: 500, ids: ["1", "2"] }, lowAov: { n: 3, up: 3000, ids: ["1", "2", "3"] } }, kpi: { churned: 4, churnedIds: ["7", "8"], reactivatedCount: 1 } },
  rows: [row("1"), row("2"), row("3"), row("7", { baseline: 2000 }), row("8", { baseline: 4000 })],
  lapsed: [{ clinic: "9", orders: 3, gzRevenue: 6000, otherOrders: 1, lastOrder: "2025-09-01" }, { clinic: "10", orders: 1, gzRevenue: 2000, otherOrders: 0, lastOrder: "2025-02-01" }],
});

test("the annual factor scales a window to a year", () => {
  assert.equal(annualFactor(365), 1);
  assert.ok(Math.abs(annualFactor(182) - 2.0055) < 0.001);
});

test("low-AOV and at-risk are sized from the scorecard's own indicator, annualized", () => {
  const ds = discover(inputs());
  const low = ds.find(d => d.id === "low-aov")!;
  assert.equal(low.n, 3);
  assert.ok(Math.abs(low.n * low.value - 3000 * annualFactor(182)) < 1e-6);
  const risk = ds.find(d => d.id === "at-risk")!;
  assert.equal(risk.source, "scorecard");
  assert.equal(risk.pillar, "Retention");
});

test("incremental revenue follows clinics × (target − current) × value, and the target is editable", () => {
  const d = discover(inputs()).find(x => x.id === "gz-lapsed")!;
  const base = resolve(d);
  assert.equal(base.incr, 2 * 0.15 * 4000);
  assert.equal(resolve(d, { tgt: 30 }).incr, 2 * 0.3 * 4000);
  assert.equal(base.source, "supporting");
});

test("reactivation uses the baseline of the churned clinics and the observed come-back rate", () => {
  const d = discover(inputs()).find(x => x.id === "reactivate")!;
  assert.equal(d.n, 2);
  assert.ok(Math.abs(d.cur - 20) < 1e-9); // 1 back of (1 back + 4 churned)
  assert.ok(Math.abs(d.value - 3000 * annualFactor(182)) < 1e-6);
  assert.equal(d.tgt, 30);
});

test("untouched counts only clinics with a touch date 45+ days old, in the top quartile by baseline", () => {
  const i = inputs();
  i.rows = [row("a", { baseline: 100, daysSinceTouch: 60 }), row("b", { baseline: 8000, daysSinceTouch: 60 }), row("c", { baseline: 6000, daysSinceTouch: null }), row("d", { baseline: 7000, daysSinceTouch: 10 }), row("e", { baseline: 9000, daysSinceTouch: 90 })];
  const d = discover(i).find(x => x.id === "untouched")!;
  assert.deepEqual([...d.clinicIds].sort(), ["b", "e"].sort());
});

test("state attainment takes the states furthest below goal", () => {
  const i = inputs();
  i.rows = [row("1", { state: "TX", expected: 500, actual: 100 }), row("2", { state: "FL", expected: 300, actual: 200 }), row("3", { state: "NY", expected: 100, actual: 300 })];
  const d = discover(i).find(x => x.id === "state-gap")!;
  assert.deepEqual([...d.clinicIds].sort(), ["1", "2"]);
  assert.ok(/TX/.test(d.segment));
});

test("scores, priority and the recommendation follow the weights as shares of their total", () => {
  const o = resolve(discover(inputs()).find(x => x.id === "gz-lapsed")!, { status: "Validated", fit: 5, time: 5, feas: 5, investment: 1000 });
  assert.equal(o.scores.prob, 4);
  assert.equal(o.bucket, "Core growth");
  assert.ok(o.ret !== null && o.ret > 0);
  const p = priority(o, DEFAULT_WEIGHTS);
  assert.ok(Math.abs(p - priority(o, { rev: 60, prob: 50, fit: 30, time: 30, feas: 30 })) < 1e-9);
  assert.equal(recommendation(4), "Prioritize");
  assert.equal(recommendation(3.4), "Validate");
  assert.equal(recommendation(2), "Park");
  assert.equal(revenueScore(450_000), 5);
  assert.equal(revenueScore(10_000), 1);
});

test("regions: US states and countries, and an opportunity split across them", () => {
  assert.deepEqual(regionOf({ state: "ca", country: "US" }), { kind: "us", code: "CA" });
  assert.deepEqual(regionOf({ state: "ON", country: "CA" }), { kind: "intl", code: "CA" });
  const rows = [row("1", { state: "TX" }), row("2", { state: "TX" }), row("3", { state: "FL" })];
  const o = resolve({ ...discover(inputs()).find(x => x.id === "low-aov")!, clinicIds: ["1", "2", "3"], n: 3, value: 1000, cur: 0, tgt: 100 });
  const m = regionSplit(o, rows);
  assert.equal(m.get("us:TX"), 2000);
  assert.equal(m.get("us:FL"), 1000);
  assert.equal(topQuartile([1, 2, 3, 4]), 4);
});

test("saved edits keep only known fields in range", () => {
  assert.deepEqual(cleanSaved({ tgt: 150, investment: -5, fit: 9, status: "Nope", owner: "  Sales ", junk: 1 }), { tgt: 100, investment: 0, fit: 5, owner: "Sales" });
  assert.deepEqual(cleanSaved({ status: "Validated", note: "x" }), { status: "Validated", note: "x" });
});
