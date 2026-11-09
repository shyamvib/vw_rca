// Run with: node --experimental-strip-types --test scripts/fzAgenda.test.ts   (or: bun test scripts/fzAgenda.test.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFzFamily, fzCrossSell, fzWhitespace, isFzFamily, suggestOf } from "../src/lib/fzAgenda.ts";

const line = (product: string, open: number, likely = 0) => ({ product, open, likely });

test("Foundation Zoomer is recognised however it is spelled, and nothing else is", () => {
  for (const f of ["Foundation Zoomer", "foundation zoomer", "FoundationZoomer", "Foundation  Zoomer 2"]) assert.equal(isFzFamily(f), true, f);
  for (const f of ["Hormone Zoomer", "Gut Zoomer", "Total Tox", "", undefined]) assert.equal(isFzFamily(f), false, String(f));
  assert.equal(findFzFamily(["Gut Zoomer", "Foundation Zoomer"]), "Foundation Zoomer");
  assert.equal(findFzFamily(["Gut Zoomer"]), undefined);
});

test("the Zoomer to pitch is the one with the most open results, then the biggest likely revenue", () => {
  assert.equal(suggestOf({ products: [line("Gut Zoomer", 1, 900), line("Neural Zoomer", 3, 100), line("Immune Zoomer", 0, 5000)] }), "Neural Zoomer");
  assert.equal(suggestOf({ products: [line("Gut Zoomer", 2, 100), line("Neural Zoomer", 2, 300)] }), "Neural Zoomer");
  assert.equal(suggestOf({ products: [line("Gut Zoomer", 0, 100)] }), null);
  assert.equal(suggestOf({ products: [] }), null);
});

test("cross-sell lists every clinic, biggest likely revenue first, and names the top three with their Zoomer", () => {
  const clinic = (id: string, name: string, likely: number, products = [line("Gut Zoomer", 1, likely)]) => ({ clinic: id, name, likely, open: 1, products });
  const r = fzCrossSell({
    ready: true,
    totals: { clinics: 4, likely: 1000, low: 5000, high: 9000 },
    clinics: [clinic("c1", "Alpha", 100), clinic("c2", "Bravo", 500), clinic("c3", "Charlie", 300), clinic("c4", "Delta", 100, [])],
  });
  assert.equal(r.n, 4);
  assert.equal(r.up, 1000);
  assert.equal(r.low, 5000);
  assert.equal(r.high, 9000);
  assert.deepEqual(r.ids, ["c2", "c3", "c1", "c4"]); // ties keep alphabetical order
  assert.deepEqual(r.names.map(x => x.name), ["Bravo → Gut Zoomer", "Charlie → Gut Zoomer", "Alpha → Gut Zoomer"]);
  assert.deepEqual(r.names.map(x => x.v), [500, 300, 100]);
});

test("whitespace is only clinics marked eligible for Foundation Zoomer that never ordered it", () => {
  const clinics = [
    { clinic: "a", name: "A", life: { "Foundation Zoomer": 2 } },   // already orders it
    { clinic: "b", name: "B", life: {} },                            // never ordered it
    { clinic: "c", name: "C", life: { "Foundation Zoomer": 0 } },    // zero orders counts as never
    { clinic: "d", name: "D", life: {} },                            // marked for another family only
  ];
  const elig = [
    { clinic: "a", family: "Foundation Zoomer" },
    { clinic: "b", family: "Foundation Zoomer" },
    { clinic: "b", family: "Foundation Zoomer" },                    // a duplicate mark counts once
    { clinic: "c", family: "Foundation Zoomer" },
    { clinic: "d", family: "Hormone Zoomer" },
    { clinic: "zz", family: "Foundation Zoomer" },                   // not in the book's product data: still never ordered
  ];
  const r = fzWhitespace(elig, clinics);
  assert.deepEqual(r.ids, ["b", "c", "zz"]);
  assert.deepEqual(r.names.map(x => x.name), ["B", "C", "zz"]);
});

test("the Overview opens the FZ list only for the Foundation Zoomer cross-sell cell, with data", async () => {
  const { fzListSel } = await import("../src/lib/fzAgenda.ts");
  const fz = { ready: true, clinics: [{ clinic: "c1" }, { clinic: "c2" }] };
  const ok = fzListSel("Cross-sell candidates", "Foundation Zoomer", true, fz);
  assert.deepEqual(ok?.ids, ["c1", "c2"]);
  assert.equal(ok?.fz, true);
  assert.equal(ok?.label, "FZ score targets");
  assert.equal(fzListSel("Product whitespace", "Foundation Zoomer", true, fz), null);           // another cell
  assert.equal(fzListSel("Cross-sell candidates", "Hormone Zoomer", true, fz), null);            // another family
  assert.equal(fzListSel("Cross-sell candidates", "Foundation Zoomer", false, fz), null);        // family not selected
  assert.equal(fzListSel("Cross-sell candidates", "Foundation Zoomer", true, undefined), null);  // still loading
  assert.equal(fzListSel("Cross-sell candidates", "Foundation Zoomer", true, { ready: false }), null);
  assert.equal(fzListSel("Cross-sell candidates", "Foundation Zoomer", true, { ready: true, clinics: [] }), null); // nothing to list
});
