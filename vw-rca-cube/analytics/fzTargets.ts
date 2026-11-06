// Clinic-level FZ-score cross-sell numbers for one window and scope. Pure functions, no I/O (tests: scripts/fzTargets.test.ts).
//
// Input rows come from the `fzScores` snapshot table (one per FZ order × area; built from the `fz_scores` cube).
// Each row's trend / reason already describe every earlier test of that patient in that area, so for a window we
// only keep each patient's LATEST FZ per area. The counting unit shown to sales is an "FZ result": that latest FZ
// order's score in one area. Output is clinic level: patient identifiers never leave this file.
// Rules in plain words: cube/FZ_SCORES.md.

export type FzRow = {
  area: string;
  product: string;
  priceLow: number;
  priceHigh: number;
  clinic: string;
  /** FZ order day, YYYY-MM-DD (decides test order). */
  day: string;
  /** Day the score was finalised in the LIS, YYYY-MM-DD (decides the window: "results that came back"). */
  resultDay: string;
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
  /** The area's Zoomer/Baseline was ordered on an earlier day than this FZ. */
  hadBefore: boolean;
  /** The area's Zoomer/Baseline was ordered the same day as this FZ (already ordering; never a target). */
  withFz?: boolean;
  /** The area's Zoomer/Baseline was ordered on a later day than this FZ. */
  orderedAfter: boolean;
};

/** One Zoomer's numbers (for a clinic, or for the whole scope). */
export type FzLine = {
  area: string;
  product: string;
  /** FZ results that pointed to this Zoomer: still open + already followed up. */
  flagged: number;
  /** Of those, the provider went on to order the Zoomer (or Baseline). */
  followed: number;
  /** Still open: pointed to the Zoomer and none ordered yet. */
  open: number;
  /** Revenue if every open result turned into an order: Baseline price … Zoomer price. */
  low: number;
  high: number;
  /** Revenue at the share of similar results that already turned into an order (`rate`). */
  likely: number;
};

export type FzPair = { areas: [string, string]; products: [string, string]; n: number };

export type FzClinic = {
  clinic: string;
  isTop20: boolean;
  /** FZ orders in the window (latest per patient). */
  fzOrders: number;
  /** Of those, FZ orders with at least one open area (a Zoomer to suggest). */
  openOrders: number;
  flagged: number;
  followed: number;
  open: number;
  /** FZ orders with 2+ open areas: pitch more than one Zoomer. */
  crossSell: number;
  products: FzLine[];
  /** Most common open pairs on the same FZ order (largest first, at most 3). */
  pairs: FzPair[];
  low: number;
  high: number;
  likely: number;
  reasons: Record<string, number>;
  topReason: string;
};

export type FzProduct = FzLine & {
  clinics: number;
  /** Share of comparable results that turned into an order of this product (company-wide, all time). */
  rate: number;
};

export type FzTotals = {
  fzOrders: number;
  flagged: number;
  followed: number;
  open: number;
  crossSell: number;
  clinics: number;
  topClinics: number;
  low: number;
  high: number;
  likely: number;
};

export type FzResult = { totals: FzTotals; products: FzProduct[]; clinics: FzClinic[] };

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

/** A non-Optimal result with no product before or with the FZ, after which the provider ordered the product. */
export const isFollowed = (r: FzRow) => r.band !== "Optimal" && !r.hadBefore && !r.withFz && r.orderedAfter;

/**
 * Per area: of patients who scored "Needs support" without having had the product before (or with the FZ), the
 * share who ordered it after that FZ. Company-wide over all rows given (pass every row, not one rep's).
 */
export function conversionRates(rows: FzRow[]): Record<string, number> {
  const seen = new Map<string, { area: string; converted: boolean }>();
  for (const r of rows) {
    if (r.band !== "Needs support" || r.hadBefore || r.withFz) continue;
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

const emptyLine = (r: FzRow): FzLine => ({ area: r.area, product: r.product, flagged: 0, followed: 0, open: 0, low: 0, high: 0, likely: 0 });

function addTo(l: FzLine, r: FzRow, rates: Record<string, number>) {
  if (r.isTarget) {
    l.open += 1;
    l.flagged += 1;
    l.low += r.priceLow;
    l.high += r.priceHigh;
    l.likely += (rates[r.area] ?? 0) * r.priceLow;
  } else if (isFollowed(r)) {
    l.followed += 1;
    l.flagged += 1;
  }
}

const byFlagged = (a: FzLine, b: FzLine) => b.open - a.open || b.flagged - a.flagged || a.product.localeCompare(b.product);

/**
 * Clinics with FZ results to follow up, from results that came back in [window.start, window.end] (inclusive days,
 * by resultDay), limited to `scope` clinics when given. `window` null = every result on file.
 */
export function fzTargets(
  rows: FzRow[],
  window: { start: string; end: string } | null,
  scope: Set<string> | null,
  rates: Record<string, number>,
): FzResult {
  const inWin = rows.filter(r => (!window || (r.resultDay >= window.start && r.resultDay <= window.end)) && (!scope || scope.has(r.clinic)));
  const kept = latestPerPatientArea(inWin);

  // Open areas per patient's latest FZ (for cross-sell).
  const openAreas = new Map<string, FzRow[]>();
  for (const r of kept) if (r.isTarget) openAreas.set(r.pt, [...(openAreas.get(r.pt) ?? []), r]);

  type Acc = { c: FzClinic; orders: Set<string>; openPts: Set<string>; lines: Map<string, FzLine>; pairs: Map<string, FzPair> };
  const byClinic = new Map<string, Acc>();
  const acc = (r: FzRow): Acc => {
    let a = byClinic.get(r.clinic);
    if (!a) {
      a = {
        c: { clinic: r.clinic, isTop20: false, fzOrders: 0, openOrders: 0, flagged: 0, followed: 0, open: 0, crossSell: 0, products: [],
          pairs: [], low: 0, high: 0, likely: 0, reasons: {}, topReason: "" },
        orders: new Set(), openPts: new Set(), lines: new Map(), pairs: new Map(),
      };
      byClinic.set(r.clinic, a);
    }
    a.c.isTop20 ||= r.isTop20;
    return a;
  };
  const prod = new Map<string, FzLine & { _clinics: Set<string> }>();

  for (const r of kept) {
    const a = acc(r);
    a.orders.add(r.pt);
    if (!r.isTarget && !isFollowed(r)) continue;
    const line = a.lines.get(r.area) ?? emptyLine(r);
    addTo(line, r, rates);
    a.lines.set(r.area, line);
    const p = prod.get(r.area) ?? { ...emptyLine(r), _clinics: new Set<string>() };
    addTo(p, r, rates);
    if (r.isTarget) p._clinics.add(r.clinic);
    prod.set(r.area, p);
    if (r.isTarget) a.openPts.add(r.pt);
    if (r.isTarget && r.reason) a.c.reasons[r.reason] = (a.c.reasons[r.reason] ?? 0) + 1;
  }

  let crossSellTotal = 0;
  for (const list of openAreas.values()) {
    if (list.length < 2) continue;
    crossSellTotal += 1;
    const a = acc(list[0]);
    a.c.crossSell += 1;
    const s = [...list].sort((x, y) => x.area.localeCompare(y.area));
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i].area}|${s[j].area}`;
        const p = a.pairs.get(k) ?? { areas: [s[i].area, s[j].area] as [string, string], products: [s[i].product, s[j].product] as [string, string], n: 0 };
        p.n += 1;
        a.pairs.set(k, p);
      }
  }

  const clinics: FzClinic[] = [...byClinic.values()]
    .map(({ c, orders, openPts, lines, pairs }) => {
      const products = [...lines.values()].sort(byFlagged);
      const sum = (k: keyof Pick<FzLine, "flagged" | "followed" | "open" | "low" | "high" | "likely">) => products.reduce((s, l) => s + l[k], 0);
      return {
        ...c,
        fzOrders: orders.size,
        openOrders: openPts.size,
        flagged: sum("flagged"),
        followed: sum("followed"),
        open: sum("open"),
        low: sum("low"),
        high: sum("high"),
        likely: sum("likely"),
        products,
        pairs: [...pairs.values()].sort((x, y) => y.n - x.n || x.areas.join().localeCompare(y.areas.join())).slice(0, 3),
        topReason: Object.entries(c.reasons).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? "",
      };
    })
    .filter(c => c.open > 0)
    .sort((a, b) => Number(b.isTop20) - Number(a.isTop20) || b.open - a.open || b.high - a.high || a.clinic.localeCompare(b.clinic));

  const products: FzProduct[] = [...prod.values()]
    .map(({ _clinics, ...p }) => ({ ...p, clinics: _clinics.size, rate: rates[p.area] ?? 0 }))
    .sort(byFlagged);

  const sum = (k: "flagged" | "followed" | "open" | "low" | "high" | "likely") => products.reduce((s, p) => s + p[k], 0);
  return {
    totals: {
      fzOrders: new Set(kept.map(r => r.pt)).size,
      flagged: sum("flagged"),
      followed: sum("followed"),
      open: sum("open"),
      crossSell: crossSellTotal,
      clinics: clinics.length,
      topClinics: clinics.filter(c => c.isTop20).length,
      low: sum("low"),
      high: sum("high"),
      likely: sum("likely"),
    },
    products,
    clinics,
  };
}
