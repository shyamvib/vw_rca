import { describe, expect, test } from "bun:test";
import { conversionRates, fzTargets, type FzRow } from "../analytics/fzTargets";

let seq = 0;
const row = (o: Partial<FzRow> & Pick<FzRow, "pt" | "clinic" | "day">): FzRow => ({
  resultDay: o.day,
  area: "Gut", product: "Gut Zoomer", priceLow: 460, priceHigh: 550,
  sample: String(++seq), score: 50, band: "Needs support", trend: "Single test",
  reason: "Needs support", isTarget: true, targetsOnSample: 1, isTop20: false,
  hadBefore: false, withFz: false, orderedAfter: false,
  ...o,
});
const W = { start: "2026-07-01", end: "2026-09-30" };
const notTarget = { reason: null, isTarget: false };

describe("window and latest test per patient", () => {
  test("rows outside the window are ignored", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-06-30" }), row({ pt: "b", clinic: "1", day: "2026-10-01" })], W, null, {});
    expect(r.totals.fzOrders).toBe(0);
    expect(r.clinics).toEqual([]);
  });
  test("window edges are inclusive", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-07-01" }), row({ pt: "b", clinic: "1", day: "2026-09-30" })], W, null, {});
    expect(r.totals.open).toBe(2);
  });
  test("no window = every result on file", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-02-20" }), row({ pt: "b", clinic: "1", day: "2026-11-05" })], null, null, {});
    expect(r.totals.open).toBe(2);
  });
  test("only the latest test per patient and area counts (its fields carry the history)", () => {
    const r = fzTargets([
      row({ pt: "a", clinic: "1", day: "2026-07-05", sample: "10" }),
      row({ pt: "a", clinic: "1", day: "2026-08-20", sample: "11", score: 90, band: "Optimal", ...notTarget }),
    ], W, null, {});
    expect(r.totals.fzOrders).toBe(1);
    expect(r.totals.open).toBe(0);
  });
  test("same-day repeat: higher sample_id is the later test", () => {
    const r = fzTargets([
      row({ pt: "a", clinic: "1", day: "2026-08-01", sample: "200", band: "Optimal", ...notTarget }),
      row({ pt: "a", clinic: "1", day: "2026-08-01", sample: "199" }),
    ], W, null, {});
    expect(r.totals.open).toBe(0);
  });
});

describe("window is the result date, not the order date", () => {
  test("ordered before the window, result came back inside it → counted", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-06-20", resultDay: "2026-07-08" })], W, null, {});
    expect(r.totals.open).toBe(1);
  });
  test("ordered inside the window, result came back after it → not counted yet", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-09-25", resultDay: "2026-10-12" })], W, null, {});
    expect(r.totals.fzOrders).toBe(0);
  });
  test("latest test is still decided by test order (order day, then sample)", () => {
    const r = fzTargets([
      row({ pt: "a", clinic: "1", day: "2026-07-01", resultDay: "2026-08-30", sample: "1" }),
      row({ pt: "a", clinic: "1", day: "2026-08-01", resultDay: "2026-08-20", sample: "2", band: "Optimal", ...notTarget }),
    ], W, null, {});
    expect(r.totals.open).toBe(0);
  });
});

describe("scope", () => {
  test("only clinics in the rep's book", () => {
    const r = fzTargets([row({ pt: "a", clinic: "1", day: "2026-08-01" }), row({ pt: "b", clinic: "2", day: "2026-08-01" })], W, new Set(["2"]), {});
    expect(r.clinics.map(c => c.clinic)).toEqual(["2"]);
  });
});

describe("flagged = open + followed up", () => {
  const rows = [
    row({ pt: "a", clinic: "1", day: "2026-08-01" }), // open
    row({ pt: "b", clinic: "1", day: "2026-08-01", ...notTarget, orderedAfter: true }), // low, then ordered the Zoomer
    row({ pt: "c", clinic: "1", day: "2026-08-01", band: "Moderate", score: 80, ...notTarget, orderedAfter: true }), // moderate, then ordered
    row({ pt: "d", clinic: "1", day: "2026-08-01", ...notTarget, withFz: true }), // Zoomer on the same order: neither
    row({ pt: "e", clinic: "1", day: "2026-08-01", band: "Optimal", score: 92, ...notTarget, orderedAfter: true }), // optimal: neither
    row({ pt: "f", clinic: "1", day: "2026-08-01", ...notTarget, hadBefore: true, band: "Moderate", score: 70, orderedAfter: true }), // had it before: neither
  ];
  const r = fzTargets(rows, W, null, {});
  test("per clinic and per product", () => {
    const c = r.clinics[0];
    expect(c).toMatchObject({ fzOrders: 6, flagged: 3, followed: 2, open: 1 });
    expect(c.products).toEqual([{ area: "Gut", product: "Gut Zoomer", flagged: 3, followed: 2, open: 1, low: 460, high: 550, likely: 0 }]);
    expect(r.products[0]).toMatchObject({ flagged: 3, followed: 2, open: 1, clinics: 1 });
  });
  test("totals", () => {
    expect(r.totals).toMatchObject({ fzOrders: 6, flagged: 3, followed: 2, open: 1, clinics: 1 });
  });
  test("a clinic whose flagged results were all followed up is not listed", () => {
    const only = fzTargets([row({ pt: "b", clinic: "9", day: "2026-08-01", ...notTarget, orderedAfter: true })], W, null, {});
    expect(only.clinics).toEqual([]);
    expect(only.totals).toMatchObject({ flagged: 1, followed: 1, open: 0, clinics: 0 });
  });
});

describe("clinic rows", () => {
  const rows = [
    row({ pt: "a", clinic: "1", day: "2026-08-01", area: "Gut", product: "Gut Zoomer", priceLow: 460, priceHigh: 550, targetsOnSample: 2 }),
    row({ pt: "a", clinic: "1", day: "2026-08-01", area: "Cardio", product: "Cardio Zoomer", priceLow: 600, priceHigh: 600, reason: "Borderline", targetsOnSample: 2 }),
    row({ pt: "b", clinic: "1", day: "2026-08-02", area: "Gut", product: "Gut Zoomer" }),
    row({ pt: "c", clinic: "1", day: "2026-08-03", area: "Gut", product: "Gut Zoomer", band: "Moderate", ...notTarget }),
    row({ pt: "d", clinic: "2", day: "2026-08-03", area: "Neural", product: "Neural Zoomer", priceLow: 450, priceHigh: 450, isTop20: true }),
  ];
  const r = fzTargets(rows, W, null, { Gut: 0.1, Cardio: 0, Neural: 0.5 });
  const c1 = r.clinics.find(c => c.clinic === "1")!;

  test("orders, products, cross-sell pairs, money", () => {
    expect(c1.fzOrders).toBe(3);
    expect(c1.open).toBe(3);
    expect(c1.crossSell).toBe(1);
    expect(c1.products.map(p => [p.product, p.open])).toEqual([["Gut Zoomer", 2], ["Cardio Zoomer", 1]]);
    expect(c1.pairs).toEqual([{ areas: ["Cardio", "Gut"], products: ["Cardio Zoomer", "Gut Zoomer"], n: 1 }]);
    expect(c1.low).toBe(460 * 2 + 600);
    expect(c1.high).toBe(550 * 2 + 600);
    expect(c1.likely).toBeCloseTo(2 * 0.1 * 460, 6);
    expect(c1.reasons).toEqual({ "Needs support": 2, Borderline: 1 });
    expect(c1.topReason).toBe("Needs support");
  });
  test("top-20% clinics sort first, then by open results", () => {
    expect(r.clinics.map(c => c.clinic)).toEqual(["2", "1"]);
  });
  test("product totals", () => {
    const gut = r.products.find(p => p.area === "Gut")!;
    expect(gut).toMatchObject({ open: 2, clinics: 1, low: 920, high: 1100, rate: 0.1 });
    expect(r.products.map(p => p.area)).toEqual(["Gut", "Cardio", "Neural"]);
  });
  test("totals", () => {
    expect(r.totals).toMatchObject({ fzOrders: 4, open: 4, crossSell: 1, clinics: 2, topClinics: 1 });
  });
  test("no patient identifiers anywhere in the output", () => {
    const json = JSON.stringify(r);
    for (const pt of ["\"a\"", "\"b\"", "\"c\"", "\"d\""]) expect(json.includes(pt)).toBe(false);
    expect(json.includes("\"pt\"")).toBe(false);
    expect(json.includes("patient")).toBe(false);
  });
});

describe("conversionRates", () => {
  test("share of needs-support results without the product before who ordered it after", () => {
    const rates = conversionRates([
      row({ pt: "a", clinic: "1", day: "2026-01-01", orderedAfter: true, ...notTarget }),
      row({ pt: "b", clinic: "1", day: "2026-01-01" }),
      row({ pt: "c", clinic: "1", day: "2026-01-01" }),
      row({ pt: "d", clinic: "1", day: "2026-01-01" }),
      row({ pt: "e", clinic: "1", day: "2026-01-01", hadBefore: true, reason: "After product – not improved" }),
      row({ pt: "g", clinic: "1", day: "2026-01-01", withFz: true, ...notTarget }),
      row({ pt: "f", clinic: "1", day: "2026-01-01", band: "Moderate", ...notTarget, orderedAfter: true }),
    ]);
    expect(rates.Gut).toBeCloseTo(1 / 4, 6);
  });
  test("a patient counts once even with several low tests", () => {
    const rates = conversionRates([
      row({ pt: "a", clinic: "1", day: "2026-01-01" }),
      row({ pt: "a", clinic: "1", day: "2026-03-01", orderedAfter: true, ...notTarget }),
    ]);
    expect(rates.Gut).toBe(1);
  });
});
