// Clinic-level FZ-score targets for one window and scope. Pure functions, no I/O (tests: scripts/fzTargets.test.ts).
//
// Input rows come from the `fzScores` snapshot table (one per FZ order × area; built from the `fz_scores` cube).
// Each row's trend / reason already describe every earlier test of that patient in that area, so for a window we
// only keep each patient's LATEST test per area. Output is clinic level: patient identifiers never leave here.
// Rules in plain words: cube/FZ_SCORES.md.

export type FzRow = {
  area: string;
  product: string;
  priceLow: number;
  priceHigh: number;
  clinic: string;
  /** FZ order day, YYYY-MM-DD. */
  day: string;
  sample: string;
  /** One-way hash of the patient id: only used to find each patient's latest test. Never returned. */
  pt: string;
  score: number;
  band: string;
  trend: string;
  reason: string | null;
  isTarget: boolean;
  targetsOnSample: number;
  isTop20: boolean;
  hadBefore: boolean;
  orderedAfter: boolean;
};

export type FzClinic = {
  clinic: string;
  isTop20: boolean;
  /** Patients with an FZ in the window. */
  scored: number;
  /** Patients with at least one area to pitch. */
  targetPatients: number;
  /** Patients with 2+ areas to pitch (cross-sell). */
  crossSell: number;
  products: { area: string; product: string; patients: number }[];
  low: number;
  high: number;
  likely: number;
  reasons: Record<string, number>;
  topReason: string;
};

export type FzProduct = {
  area: string;
  product: string;
  patients: number;
  clinics: number;
  low: number;
  high: number;
  likely: number;
  /** Share of comparable patients who ordered this product after their FZ (company-wide, all time). */
  rate: number;
};

export type FzResult = {
  totals: { scored: number; targetPatients: number; crossSell: number; clinics: number; low: number; high: number; likely: number };
  products: FzProduct[];
  clinics: FzClinic[];
};

/** Later test first: by day, then sample id (numeric when both are numbers). */
const later = (a: FzRow, b: FzRow) =>
  a.day !== b.day ? a.day > b.day : a.sample.length !== b.sample.length ? a.sample.length > b.sample.length : a.sample > b.sample;

/** Each patient's latest row per area among `rows`. */
function latestPerPatientArea(rows: FzRow[]): FzRow[] {
  const best = new Map<string, FzRow>();
  for (const r of rows) {
    const k = `${r.pt}|${r.area}`;
    const cur = best.get(k);
    if (!cur || later(r, cur)) best.set(k, r);
  }
  return [...best.values()];
}

/**
 * Per area: of patients who scored "Needs support" without having had the product before, the share who ordered it
 * after that FZ. Company-wide over all rows given (pass every row, not one rep's).
 */
export function conversionRates(rows: FzRow[]): Record<string, number> {
  const seen = new Map<string, { area: string; converted: boolean }>();
  for (const r of rows) {
    if (r.band !== "Needs support" || r.hadBefore) continue;
    const k = `${r.pt}|${r.area}`;
    const s = seen.get(k) ?? { area: r.area, converted: false };
    s.converted ||= r.orderedAfter;
    seen.set(k, s);
  }
  const n: Record<string, [number, number]> = {};
  for (const { area, converted } of seen.values()) {
    if (!n[area]) n[area] = [0, 0];
    const t = n[area];
    t[0] += converted ? 1 : 0;
    t[1] += 1;
  }
  return Object.fromEntries(Object.entries(n).map(([a, [c, d]]) => [a, d ? c / d : 0]));
}

/** Clinics to target in [window.start, window.end] (inclusive days), limited to `scope` clinics when given. */
export function fzTargets(
  rows: FzRow[],
  window: { start: string; end: string },
  scope: Set<string> | null,
  rates: Record<string, number>,
): FzResult {
  const inWin = rows.filter(r => r.day >= window.start && r.day <= window.end && (!scope || scope.has(r.clinic)));
  const kept = latestPerPatientArea(inWin);
  const targets = kept.filter(r => r.isTarget);

  const ptAreas = new Map<string, number>();
  for (const r of targets) ptAreas.set(r.pt, (ptAreas.get(r.pt) ?? 0) + 1);

  type Acc = FzClinic & { _scored: Set<string>; _targets: Set<string>; _cross: Set<string>; _prod: Map<string, FzClinic["products"][0]> };
  const byClinic = new Map<string, Acc>();
  const acc = (r: FzRow): Acc => {
    let c = byClinic.get(r.clinic);
    if (!c) {
      c = { clinic: r.clinic, isTop20: false, scored: 0, targetPatients: 0, crossSell: 0, products: [], low: 0, high: 0,
        likely: 0, reasons: {}, topReason: "", _scored: new Set(), _targets: new Set(), _cross: new Set(), _prod: new Map() };
      byClinic.set(r.clinic, c);
    }
    c.isTop20 ||= r.isTop20;
    return c;
  };
  for (const r of kept) acc(r)._scored.add(r.pt);

  const prodAcc = new Map<string, FzProduct & { _clinics: Set<string> }>();
  for (const r of targets) {
    const c = acc(r);
    const likely = (rates[r.area] ?? 0) * r.priceLow;
    c._targets.add(r.pt);
    if ((ptAreas.get(r.pt) ?? 0) >= 2) c._cross.add(r.pt);
    const p = c._prod.get(r.area) ?? { area: r.area, product: r.product, patients: 0 };
    p.patients += 1;
    c._prod.set(r.area, p);
    c.low += r.priceLow;
    c.high += r.priceHigh;
    c.likely += likely;
    if (r.reason) c.reasons[r.reason] = (c.reasons[r.reason] ?? 0) + 1;

    const t = prodAcc.get(r.area) ?? { area: r.area, product: r.product, patients: 0, clinics: 0, low: 0, high: 0, likely: 0,
      rate: rates[r.area] ?? 0, _clinics: new Set<string>() };
    t.patients += 1;
    t._clinics.add(r.clinic);
    t.low += r.priceLow;
    t.high += r.priceHigh;
    t.likely += likely;
    prodAcc.set(r.area, t);
  }

  const clinics: FzClinic[] = [...byClinic.values()]
    .filter(c => c._targets.size > 0)
    .map(({ _scored, _targets, _cross, _prod, ...c }) => ({
      ...c,
      scored: _scored.size,
      targetPatients: _targets.size,
      crossSell: _cross.size,
      products: [..._prod.values()].sort((a, b) => b.patients - a.patients || a.product.localeCompare(b.product)),
      topReason: Object.entries(c.reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "",
    }))
    .sort((a, b) => Number(b.isTop20) - Number(a.isTop20) || b.targetPatients - a.targetPatients || b.high - a.high || a.clinic.localeCompare(b.clinic));

  const products: FzProduct[] = [...prodAcc.values()]
    .map(({ _clinics, ...p }) => ({ ...p, clinics: _clinics.size }))
    .sort((a, b) => b.patients - a.patients || b.high - a.high || a.area.localeCompare(b.area));

  const sum = (k: "low" | "high" | "likely") => clinics.reduce((s, c) => s + c[k], 0);
  return {
    totals: {
      scored: new Set(kept.map(r => r.pt)).size,
      targetPatients: new Set(targets.map(r => r.pt)).size,
      crossSell: [...ptAreas.values()].filter(n => n >= 2).length,
      clinics: clinics.length,
      low: sum("low"),
      high: sum("high"),
      likely: sum("likely"),
    },
    products,
    clinics,
  };
}
