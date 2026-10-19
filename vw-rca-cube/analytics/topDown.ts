/**
 * Top-down plan allocation [Shyam, 2026-10-12]: company rolling P75 is the
 * one plan, split overall → geography (state/country) → rep×geo; a rep's
 * expected = sum of their rep×geo cells, a lead = sum of their reps. So
 * states add up to overall AND reps add up to overall. Clinic P75 is kept
 * separate (clinic rows only, not scaled to these totals).
 */
import { geoKeyOf } from "./geoKey";
import { dow, rollingBaseline, type baselinePlan } from "./dateUtils";
import { newShareOver } from "./baseline";

type Kind = "all" | "quarter" | "month" | "week" | "day";
type Def = { id: string; kind: Kind; days: string[] };
type Day = { clinic: string; date: string; revenue: number; orders: number };
type Idty = { state: string; country: string; sales: string; teamLead: string };

export type GeoAlloc = {
  periodId: string;
  geo: string;
  sales: string; // "" = geography total row
  expectedRevenue: number;
  expectedOrders: number;
  actualRevenue?: number; // geo total rows only (state chart actuals)
  geoJson?: string;
};

export function topDownAllocate(args: {
  defs: Def[];
  planOf: Map<string, ReturnType<typeof baselinePlan>>;
  days: Day[];
  identity: Map<string, Idty | undefined>;
  /** Each clinic's mean daily run rate by weekday over the baseline window (clinicMeta rev / ord). */
  rates: Array<{ clinic: string; rev: number[]; ord: number[] }>;
  /** The company daily series the headline uses (dailyTotals). The goal must come from the same series as the
   * headline: clinic-level daily rows leave out revenue that has no clinic, which moved some months' P75 by 0.25%. */
  companyDaily?: Array<{ date: string; revenue: number; orders: number }>;
  /** Settings annual target and the calendar year it belongs to. When given, goal = the target spread by baseline
   * weekday weights (additive over time and entities, identical for the same days in any period kind); otherwise
   * the goal is the company rolling P75. */
  target?: {
    annual: number;
    year: number;
    /** new-business goal carved out of the target (the Settings number, or last year's new-clinic revenue) */
    newSlice?: number;
    /** last year's new-clinic revenue by month, as 12 shares of the year: how the new-business goal is phased */
    newPhasing?: number[];
    /** last year's new-clinic revenue: the default new-business goal */
    newDefaultSlice?: number;
  };
}) {
  const { defs, planOf, days, identity, rates, companyDaily, target } = args;
  // Baseline (mean) run rate by weekday, summed per rep: additive by construction.
  const repDowRev = new Map<string, number[]>(), repDowOrd = new Map<string, number[]>();
  for (const r of rates) {
    const rep = identity.get(r.clinic)?.sales ?? "—";
    const a = repDowRev.get(rep) ?? repDowRev.set(rep, [0, 0, 0, 0, 0, 0, 0]).get(rep)!;
    const b = repDowOrd.get(rep) ?? repDowOrd.set(rep, [0, 0, 0, 0, 0, 0, 0]).get(rep)!;
    for (let w = 0; w < 7; w++) { a[w] += r.rev[w] ?? 0; b[w] += r.ord[w] ?? 0; }
  }
  const periodGoal: Array<{
    periodId: string; goalRevenue: number; goalOrders: number; baseRevenue: number; baseOrders: number;
    target?: number; newSlice?: number; newShare?: number; newPhasing?: number[]; newDefaultSlice?: number;
    yearBaseRevenue?: number; tShare?: number; p75Revenue?: number; p75Orders?: number;
  }> = [];
  // Company mean revenue per weekday, and the baseline of the whole target year (every day, Jan 1 to Dec 31).
  const coRate = [0, 0, 0, 0, 0, 0, 0];
  for (const a of repDowRev.values()) for (let w = 0; w < 7; w++) coRate[w] += a[w];
  let yearBase = 0;
  if (target) {
    for (let t = Date.UTC(target.year, 0, 1); t < Date.UTC(target.year + 1, 0, 1); t += 86400000)
      yearBase += coRate[new Date(t).getUTCDay()];
  }
  const bump = (s: Map<string, Map<string, number>>, k: string, d: string, x: number) => {
    let m = s.get(k);
    if (!m) s.set(k, (m = new Map()));
    m.set(d, (m.get(d) ?? 0) + x);
  };
  const coR = new Map<string, number>(), coO = new Map<string, number>();
  const gR = new Map<string, Map<string, number>>(), gO = new Map<string, Map<string, number>>();
  const rR = new Map<string, Map<string, number>>(), rO = new Map<string, Map<string, number>>();
  const geoAct = new Map<string, Map<string, number>>();
  const repAlloc = new Map<string, { r: Map<string, number>; o: Map<string, number> }>();
  const geoCache = new Map<string, string>();
  for (const r of days) {
    const id = identity.get(r.clinic);
    let g = geoCache.get(r.clinic);
    if (g === undefined) {
      g = geoKeyOf({ state: id?.state ?? "(blank)", country: id?.country ?? "" }).key;
      geoCache.set(r.clinic, g);
    }
    const rep = id?.sales ?? "—";
    if (!companyDaily) {
      coR.set(r.date, (coR.get(r.date) ?? 0) + r.revenue);
      coO.set(r.date, (coO.get(r.date) ?? 0) + r.orders);
    }
    bump(gR, g, r.date, r.revenue); bump(gO, g, r.date, r.orders);
    bump(rR, rep, r.date, r.revenue); bump(rO, rep, r.date, r.orders);
  }
  if (companyDaily) for (const d of companyDaily) { coR.set(d.date, d.revenue); coO.set(d.date, d.orders); }
  const leadOfSales = new Map<string, string>();
  for (const i of identity.values())
    if (i?.sales && i.sales !== "—" && i.teamLead && i.teamLead !== "—")
      leadOfSales.set(i.sales, i.teamLead);

  const geoRows: GeoAlloc[] = [];
  const sales: Array<{ periodId: string; sales: string; expectedRevenue: number; expectedOrders: number }> = [];
  const lead: Array<{ periodId: string; lead: string; expectedRevenue: number; expectedOrders: number }> = [];
  for (const { id, kind, days: pd } of defs) {
    const plan = planOf.get(id);
    const p75 = (m?: Map<string, number>) => (m ? rollingBaseline(kind, pd, d => m.get(d) ?? 0, plan) : 0);
    const p75R = p75(coR), p75O = p75(coO);
    // Goal is the company's rolling P75 (the one plan). It is split to reps by *baseline* share (mean run rate over
    // the baseline window), not by each rep's own P75: means add up, percentiles do not, so reps -> company and
    // clinics -> rep reconcile exactly and a rep with many small clinics is not penalised (2026-10-16).
    const cnt = [0, 0, 0, 0, 0, 0, 0];
    for (const d of pd) cnt[dow(d)]++;
    const baseOf = (m: Map<string, number[]>, k: string) => (m.get(k) ?? []).reduce((t, x, w) => t + x * cnt[w], 0);
    const reps = [...new Set([...repDowRev.keys(), ...rR.keys()])].map(k => ({ k, r: baseOf(repDowRev, k), o: baseOf(repDowOrd, k) }));
    const sumR = reps.reduce((x, y) => x + y.r, 0), sumO = reps.reduce((x, y) => x + y.o, 0);
    let totR = p75R, totO = p75O;
    let tShare: number | undefined;
    if (target && yearBase > 0 && sumR > 0) {
      let inYear = 0;
      for (const d of pd) if (Number(d.slice(0, 4)) === target.year) inYear += coRate[dow(d)];
      const allBase = pd.reduce((t, d) => t + coRate[dow(d)], 0);
      tShare = allBase > 0 ? inYear / allBase : 0;
      const slice = target.newSlice ?? 0;
      // Existing clinics' goal is never below their baseline (2026-10-18): when the target minus the new-business goal is
      // under their baseline pace, the factor is held at 1 and the year's goal totals a little more than the target.
      const f = Math.max(1, (target.annual - slice) / yearBase);
      const m = tShare * f + (1 - tShare);
      totR = sumR * m; totO = sumO * m;
    }
    periodGoal.push({
      periodId: id, goalRevenue: totR, goalOrders: totO, baseRevenue: sumR, baseOrders: sumO,
      ...(tShare === undefined ? {} : {
        target: target!.annual, newSlice: target!.newSlice ?? 0, yearBaseRevenue: yearBase, tShare,
        ...(target!.newPhasing ? { newShare: newShareOver(target!.newPhasing, pd, target!.year), newPhasing: target!.newPhasing } : {}),
        ...(target!.newDefaultSlice ? { newDefaultSlice: target!.newDefaultSlice } : {}),
      }),
      p75Revenue: p75R, p75Orders: p75O,
    });
    const repR = new Map<string, number>(), repO = new Map<string, number>();
    for (const y of reps) {
      repR.set(y.k, sumR > 0 ? (totR * y.r) / sumR : 0);
      repO.set(y.k, sumO > 0 ? (totO * y.o) / sumO : 0);
    }
    repAlloc.set(id, { r: repR, o: repO });
    const ga = new Map<string, number>();
    for (const [g, m] of gR) { let t = 0; for (const d of pd) t += m.get(d) ?? 0; ga.set(g, t); }
    geoAct.set(id, ga);
    const lR = new Map<string, number>(), lO = new Map<string, number>();
    for (const [rep, r] of repR) {
      if (rep === "—") continue;
      sales.push({ periodId: id, sales: rep, expectedRevenue: r, expectedOrders: repO.get(rep) ?? 0 });
      const l = leadOfSales.get(rep);
      if (l) { lR.set(l, (lR.get(l) ?? 0) + r); lO.set(l, (lO.get(l) ?? 0) + (repO.get(rep) ?? 0)); }
    }
    for (const [l, r] of lR) lead.push({ periodId: id, lead: l, expectedRevenue: r, expectedOrders: lO.get(l) ?? 0 });
  }
  return { geoRows, sales, lead, repAlloc, geoAct, periodGoal };
}

/**
 * Clinic layer [Shyam, 2026-10-12 v4]: clinic expected = rep allocation ×
 * (clinic own P75 ÷ sum of own P75 across the rep's clinics). Clinics add
 * up to rep, reps to overall. Geo rows (state chart / map) are then derived
 * as sums of clinics, so states also add up — but states are not a plan layer.
 */
export function scaleClinicsToReps(args: {
  rows: Array<{ periodId: string; clinic: string; expectedRevenue?: number; expectedOrdersP75?: number }>;
  td: ReturnType<typeof topDownAllocate>;
  identity: Map<string, Idty | undefined>;
  histRev: (clinic: string) => number;
  histOrd: (clinic: string) => number;
}): GeoAlloc[] {
  const { rows, td, identity, histRev, histOrd } = args;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.periodId}\u0001${identity.get(r.clinic)?.sales ?? "—"}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  for (const [k, rs] of groups) {
    const [p, rep] = k.split("\u0001");
    const a = td.repAlloc.get(p);
    const fit = (get: (r: (typeof rs)[0]) => number, hist: (c: string) => number, target: number, set: (r: (typeof rs)[0], v: number) => void) => {
      let w = rs.map(get);
      if (w.every(x => x <= 0)) w = rs.map(r => Math.max(0, hist(r.clinic)));
      const s = w.reduce((x, y) => x + y, 0);
      rs.forEach((r, i) => set(r, s > 0 ? (target * w[i]) / s : 0));
    };
    fit(r => r.expectedRevenue ?? 0, histRev, a?.r.get(rep) ?? 0, (r, v) => (r.expectedRevenue = v));
    fit(r => r.expectedOrdersP75 ?? 0, histOrd, a?.o.get(rep) ?? 0, (r, v) => (r.expectedOrdersP75 = v));
  }
  // Derive geo totals + rep×geo cells from clinics.
  const acc = new Map<string, GeoAlloc>();
  const add = (p: string, g: string, s: string, r: number, o: number) => {
    const k = `${p}\u0001${g}\u0001${s}`;
    const x = acc.get(k) ?? { periodId: p, geo: g, sales: s, expectedRevenue: 0, expectedOrders: 0 };
    x.expectedRevenue += r; x.expectedOrders += o; acc.set(k, x);
  };
  for (const r of rows) {
    const id = identity.get(r.clinic);
    const g = geoKeyOf({ state: id?.state ?? "(blank)", country: id?.country ?? "" }).key;
    add(r.periodId, g, "", r.expectedRevenue ?? 0, r.expectedOrdersP75 ?? 0);
    add(r.periodId, g, id?.sales ?? "—", r.expectedRevenue ?? 0, r.expectedOrdersP75 ?? 0);
  }
  for (const [p, ga] of td.geoAct) for (const [g, v] of ga) {
    const k = `${p}\u0001${g}\u0001`;
    const x = acc.get(k) ?? { periodId: p, geo: g, sales: "", expectedRevenue: 0, expectedOrders: 0 };
    x.actualRevenue = v; acc.set(k, x);
  }
  // One compact row per period for the bridge state chart (reading every
  // geo row across all periods exceeded Convex's per-query limits).
  const out = [...acc.values()];
  const per = new Map<string, Record<string, [number, number]>>();
  for (const x of out) if (x.sales === "") {
    const m = per.get(x.periodId) ?? {};
    m[x.geo] = [Math.round(x.expectedRevenue), Math.round(x.actualRevenue ?? 0)];
    per.set(x.periodId, m);
  }
  // raw state string → geo key (majority over clinics), so the bridge can
  // map stateDaily actuals (headline-consistent) onto plan geos.
  const votes = new Map<string, Map<string, number>>();
  for (const id of identity.values()) {
    const raw = id?.state ?? "(blank)";
    const g = geoKeyOf({ state: raw, country: id?.country ?? "" }).key;
    const v = votes.get(raw) ?? new Map<string, number>();
    v.set(g, (v.get(g) ?? 0) + 1); votes.set(raw, v);
  }
  const rawMap: Record<string, string> = {};
  for (const [raw, v] of votes) rawMap[raw] = [...v].sort((a, b) => b[1] - a[1])[0][0];
  let first = true;
  for (const [p, m] of per)
    first && (((m as any).__map = rawMap), (first = false)),
    out.push({ periodId: p, geo: "#", sales: "#", expectedRevenue: 0, expectedOrders: 0, geoJson: JSON.stringify(m) });
  return out;
}
