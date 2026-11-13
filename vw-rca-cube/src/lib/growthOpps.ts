/**
 * Growth opportunities (2026-11): what the dashboard's own data says could grow revenue, sized with one formula so rows compare:
 *
 *   incremental revenue a year = clinics × (target rate − current rate) × annual value per clinic
 *
 * Opportunities group under the scorecard's growth pillars. Some come from a scorecard opportunity indicator (Low-AOV customers,
 * At-risk customers, New Revenue); others come from data the scorecard does not carry and sit under a pillar as a supporting KPI
 * (Gut Zoomer lapsed clinics, untouched high-value clinics, state attainment). The population and the value per clinic are measured; the
 * target rate is a team assumption until it is validated, and is editable.
 *
 * Pure functions: the page passes in what the engine returned and what the team has saved.
 */

export const PILLARS = ["New Business", "Bundle growth", "Product Growth", "Retention", "Expansion"] as const;
export type Pillar = (typeof PILLARS)[number];

export const STATUSES = ["Hypothesis", "Quantified", "Validated", "Commit decision", "Committed", "Executing", "Scaling", "Dropped"] as const;
export type Status = (typeof STATUSES)[number];

export type Ready = "ready" | "partial" | "need";

/** The scorecard matrix columns for a pillar: Outcome, Leading indicator, Opportunity (where to act), Diagnostic. */
export const MATRIX: Record<Pillar, { out: string; lead: [string, string]; opp: [string, string]; diag: [string, string] }> = {
  "New Business": { out: "New Revenue", lead: ["Pipeline", "needs CRM pipeline data"], opp: ["Unconverted prospects", "needs CRM lead data"], diag: ["Win rate", "needs CRM opportunity data"] },
  "Bundle growth": { out: "AOV", lead: ["Stack penetration", "no data yet"], opp: ["Low-AOV customers", "clinics under $400 AOV"], diag: ["Stack mix", "no data yet"] },
  "Product Growth": { out: "Target Product Orders", lead: ["Product adoption", "new clinics on 2+ families"], opp: ["Product whitespace", "eligible clinics that never ordered the family"], diag: ["Repeat product rate", "clinic × family pairs reordered"] },
  Retention: { out: "Revenue Retention", lead: ["Repeat ordering", "ordered 2+ times"], opp: ["At-risk customers", "slipping or well under baseline"], diag: ["Customer churn", "45 days since the last order"] },
  Expansion: { out: "Expansion Revenue", lead: ["Products per customer", "families per clinic"], opp: ["Cross-sell candidates", "active clinics on 1–2 families"], diag: ["NRR", "existing clinics vs baseline"] },
};

/** A clinic row as the engine's rowsByFocus returns it (only what the opportunities read). */
export type ClinicLite = {
  clinic: string;
  name: string;
  state: string;
  country?: string;
  sales: string;
  actual: number;
  expected: number;
  baseline?: number;
  orders: number;
  aov: number;
  daysSinceTouch?: number | null;
  daysSinceLast?: number | null;
};

export type LapsedLite = { clinic: string; orders: number; revenue?: number; gzRevenue?: number; revenueThis?: number; otherOrders: number; lastOrder: string };

export type BookLite = {
  opp: { atRisk: { n: number; up: number; ids: string[] }; lowAov: { n: number; up: number; ids: string[] }; nurture?: { n: number; up: number; ids: string[] } };
  kpi: { churned: number; churnedIds: string[]; reactivatedCount?: number; aovOpp?: number; opportunity?: number; ordersPerCustomer?: number | null };
};

/** One clinic's Foundation Zoomer results, per Zoomer area (the engine's fzScores:clinics). */
export type FzClinicLite = { clinic: string; products: Array<{ area: string; open: number; low: number; high: number; likely: number }> };
export type FzLite = { clinics: FzClinicLite[] };
/** Product whitespace: clinic × family pairs the reps marked eligible that have never ordered the family, and what a buyer of that family brings in a year. */
export type WhitespaceLite = { pairs: number; ids: string[]; valuePerPair: number };
/** Clinics with several providers where some have stopped ordering (the engine's growth:providers). */
export type ProviderLite = { clinic: string; providers: number; active: number; dormant: number; dormantRevenue: number };

export type Inputs = {
  windowDays: number;
  book: BookLite | null;
  rows: ClinicLite[] | null;
  lapsed: LapsedLite[] | null;
  fz?: FzLite | null;
  whitespace?: WhitespaceLite | null;
  providers?: ProviderLite[] | null;
};

/** What an opportunity is, before anything the team has saved. */
export type OppDef = {
  id: string;
  name: string;
  pillar: Pillar;
  /** "scorecard": sized from a scorecard opportunity indicator. "supporting": from data the scorecard does not carry. */
  source: "scorecard" | "supporting";
  segment: string;
  indicator: string;
  indicatorValue: string;
  metric: string;
  /** Where the data comes from (shown for supporting KPIs). */
  from: string;
  clinicIds: string[];
  n: number;
  /** What `n` counts. Product whitespace counts clinic × family pairs; the clinics behind it are `clinicIds`. */
  unit?: "clinics" | "pairs";
  /** Current and default target rate, in percent, and what the rate measures. */
  cur: number;
  tgt: number;
  rateLabel: string;
  /** Annual revenue per clinic if the rate were 100%. */
  value: number;
  observation: string;
  intervention: string;
  evidence: string;
  ready: Ready;
  /** Header and cell text for the extra column in the clinic list. */
  defaultOwner: string;
  annual: number;
};

/** What the team has saved for an opportunity (all optional). */
export type Saved = { tgt?: number; owner?: string; status?: Status; effort?: number; fit?: number; time?: number; feas?: number; note?: string };

export const WEIGHT_KEYS = ["rev", "prob", "fit", "time", "feas"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Record<WeightKey, number>;
export const DEFAULT_WEIGHTS: Weights = { rev: 30, prob: 25, fit: 15, time: 15, feas: 15 };
export const DIMENSIONS: Array<[WeightKey, string, string]> = [
  ["rev", "Revenue potential", "Banded from the incremental revenue"],
  ["prob", "Probability of success", "Set by the evidence stage"],
  ["fit", "Strategic fit", "Entered by the team"],
  ["time", "Time to impact", "Entered by the team"],
  ["feas", "Execution feasibility", "Entered by the team"],
];
export const THRESHOLD = 3.8;

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
export const annualFactor = (windowDays: number) => (windowDays > 0 ? 365 / windowDays : 1);

/** The country-or-state key the map uses for a clinic. */
export const regionOf = (r: { state: string; country?: string }): { kind: "us" | "intl"; code: string } => {
  const country = (r.country || "").toUpperCase();
  if (!country || country === "US" || country === "—" || country === "USA") return { kind: "us", code: (r.state || "").toUpperCase() };
  return { kind: "intl", code: country };
};

/** Quartile cut: the value a quarter of the (positive) values reach. */
export const topQuartile = (xs: number[]): number => {
  const s = xs.filter(x => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length * 0.75)] : 0;
};

export function discover(inp: Inputs): OppDef[] {
  const A = annualFactor(inp.windowDays);
  const out: OppDef[] = [];
  const byId = new Map((inp.rows ?? []).map(r => [r.clinic, r]));
  const b = inp.book;

  if (b && b.opp.lowAov.n > 0) {
    const gap = b.opp.lowAov.up * A;
    out.push({
      id: "low-aov", name: "Lift the AOV of low-AOV clinics", pillar: "Bundle growth", source: "scorecard", segment: "Ordering clinics under $400 AOV",
      indicator: "Low-AOV customers", indicatorValue: `${b.opp.lowAov.n.toLocaleString("en-US")} clinics · ${money(gap)} a year to $400`, metric: "AOV", from: "",
      clinicIds: b.opp.lowAov.ids, n: b.opp.lowAov.n, cur: 0, tgt: 50, rateLabel: "share of the gap to $400 AOV closed", value: gap / b.opp.lowAov.n,
      observation: `${b.opp.lowAov.n.toLocaleString("en-US")} ordering clinics average under $400 an order. Lifting each to $400 on the orders they place now is worth ${money(gap)} a year.`,
      intervention: "A bundle offer on the order flow and a rep playbook for the clinics closest to $400, with bundle share tracked per rep.",
      evidence: "The scorecard's Low-AOV customers indicator, annualized from the analysis window.", ready: "ready", defaultOwner: "Sales", annual: gap,
    });
  }
  if (b && b.opp.atRisk.n > 0) {
    const short = b.opp.atRisk.up * A;
    out.push({
      id: "at-risk", name: "Recover at-risk clinics", pillar: "Retention", source: "scorecard", segment: "Existing clinics slipping before the churn line",
      indicator: "At-risk customers", indicatorValue: `${b.opp.atRisk.n.toLocaleString("en-US")} clinics · ${money(short)} a year below baseline`, metric: "Revenue Retention", from: "",
      clinicIds: b.opp.atRisk.ids, n: b.opp.atRisk.n, cur: 0, tgt: 35, rateLabel: "share of the shortfall below baseline recovered", value: short / b.opp.atRisk.n,
      observation: `${b.opp.atRisk.n.toLocaleString("en-US")} existing clinics last ordered 5–44 days ago and are flagged slipping, overdue, at risk, ghosted or dropping. They run ${money(short)} a year below their baseline.`,
      intervention: "A weekly call list ranked by dollars below baseline, worked by the clinic owner before the 45-day churn line.",
      evidence: "The scorecard's At-risk customers indicator, annualized from the analysis window.", ready: "ready", defaultOwner: "Sales", annual: short,
    });
  }
  if (b && b.kpi.churnedIds.length > 0 && inp.rows) {
    const rs = b.kpi.churnedIds.map(id => byId.get(id)).filter((r): r is ClinicLite => !!r);
    const base = sum(rs, r => r.baseline ?? 0) * A;
    const back = b.kpi.reactivatedCount ?? 0;
    const cur = back + b.kpi.churned > 0 ? (back / (back + b.kpi.churned)) * 100 : 0;
    if (rs.length && base > 0) {
      out.push({
        id: "reactivate", name: "Reactivate churned clinics", pillar: "New Business", source: "scorecard", segment: "Churned: 45+ days since the last order, with a baseline",
        indicator: "New Revenue · reactivated clinics", indicatorValue: `${rs.length.toLocaleString("en-US")} clinics · ${money(base)} baseline a year`, metric: "New Revenue", from: "",
        clinicIds: rs.map(r => r.clinic), n: rs.length, cur: Math.round(cur * 10) / 10, tgt: Math.round(cur * 10) / 10 + 10, rateLabel: "share of churned clinics back ordering", value: base / rs.length,
        observation: `${rs.length.toLocaleString("en-US")} clinics have gone 45+ days without an order. They averaged ${money(base / rs.length)} a year at baseline. ${Math.round(cur)}% of the clinics that churned have come back so far.`,
        intervention: "A call list ranked by baseline revenue, with a reactivation offer for clinics gone under 120 days.",
        evidence: "Lifecycle stages: the scorecard counts reactivated revenue inside New Revenue.", ready: "ready", defaultOwner: "Sales", annual: base,
      });
    }
  }
  if (inp.lapsed && inp.lapsed.some(l => l.gzRevenue !== undefined)) {
    const ls = inp.lapsed;
    const gz = sum(ls, l => l.gzRevenue ?? 0);
    if (ls.length && gz > 0) {
      out.push({
        id: "gz-lapsed", name: "Win back lapsed Gut Zoomer clinics", pillar: "Product Growth", source: "supporting", segment: "Ordered Gut Zoomer last year, none this year",
        indicator: "Lapsed on Gut Zoomer", indicatorValue: `${ls.length.toLocaleString("en-US")} clinics · ${money(gz)} Gut Zoomer revenue last year`, metric: "Target Product Orders",
        from: "Order history by product family (the Business Feed lapsed list)", clinicIds: ls.map(l => l.clinic), n: ls.length, cur: 0, tgt: 15, rateLabel: "share ordering Gut Zoomer again", value: gz / ls.length,
        observation: `${ls.length.toLocaleString("en-US")} clinics ordered Gut Zoomer last year and have not this year. Together they placed ${money(gz)} of Gut Zoomer revenue. ${ls.filter(l => l.otherOrders > 0).length} still order other tests.`,
        intervention: "Call the clinics that still order other tests first and ask what changed (price, turnaround, a competing panel) before offering it again.",
        evidence: "The Business Feed lapsed list: Gut Zoomer orders and revenue last year against this year.", ready: "ready", defaultOwner: "Sales", annual: gz,
      });
    }
  }
  const nu = b?.opp.nurture;
  if (b && nu && nu.n > 0) {
    // One order's value per stuck clinic, carried to a year at the book's orders per clinic (annualized): what a clinic that keeps ordering brings in.
    const oneOrder = nu.up / nu.n;
    const perYear = oneOrder * Math.max(1, b.kpi.ordersPerCustomer ?? 1) * A;
    out.push({
      id: "second-order", name: "Keep new clinics ordering past their first orders", pillar: "New Business", source: "supporting", segment: "New clinics 14–21 days since their last order, before order 4",
      indicator: "Stuck new clinics", indicatorValue: `${nu.n.toLocaleString("en-US")} clinics · ${money(oneOrder)} an order`, metric: "New Revenue",
      from: "The new-clinic funnel: clinics that stopped between orders", clinicIds: nu.ids, n: nu.n, cur: 0, tgt: 20, rateLabel: "share of stuck new clinics that keep ordering", value: perYear,
      observation: `${nu.n.toLocaleString("en-US")} new clinics are 14–21 days past their last order and have not reached a fourth order. A clinic that keeps ordering is worth about ${money(perYear)} a year at the book's order rate.`,
      intervention: "A guided follow-up at day 7 and day 21 after each result, owned by the rep.",
      evidence: "New-clinic funnel: where new clinics stop between orders 1 and 4. The share that keep ordering is an assumption to validate.", ready: "ready", defaultOwner: "Sales", annual: nu.n * perYear,
    });
  }
  // Foundation Zoomer results that point to a Zoomer the clinic has not ordered: Gut (Gut Baseline or Gut Zoomer) on its own row, and the
  // other Zoomers together on another, so a clinic's Gut and non-Gut results are not counted twice.
  const fz = inp.fz;
  if (fz && fz.clinics.length) {
    const area = (r: FzClinicLite, gut: boolean) => r.products.filter(p => (p.area === "Gut") === gut && p.open > 0);
    const build = (gut: boolean) => {
      const rows = fz.clinics.map(c => ({ c, ps: area(c, gut) })).filter(x => x.ps.length);
      const low = sum(rows, x => sum(x.ps, p => p.low));
      const high = sum(rows, x => sum(x.ps, p => p.high));
      const likely = sum(rows, x => sum(x.ps, p => p.likely));
      const open = sum(rows, x => sum(x.ps, p => p.open));
      return { rows, low, high, likely, open };
    };
    const g = build(true);
    const o = build(false);
    if (o.rows.length && o.low > 0)
      out.push({
        id: "fz-targets", name: "Pitch the Zoomers that Foundation Zoomer results point to", pillar: "Expansion", source: "scorecard", segment: "Clinics with open FZ results for Neural, Hormone, Nutrient, Immune or Cardio",
        indicator: "Cross-sell candidates · FZ results", indicatorValue: `${o.rows.length.toLocaleString("en-US")} clinics · ${money(o.low)}–${money(o.high)} at stake`, metric: "Expansion Revenue", from: "",
        clinicIds: o.rows.map(x => x.c.clinic), n: o.rows.length, cur: 0, tgt: Math.round((o.likely / o.low) * 1000) / 10, rateLabel: "share of open FZ results that become an order", value: o.low / o.rows.length,
        observation: `${o.rows.length.toLocaleString("en-US")} clinics have ${o.open.toLocaleString("en-US")} Foundation Zoomer results pointing to a Zoomer they have not ordered. If every one ordered, that is ${money(o.low)} at the lower price and ${money(o.high)} at the higher. At the share that usually converts it is ${money(o.likely)}.`,
        intervention: "Rep follow-up on the results, led by the clinics with several open areas, with the Zoomer the scores point to.",
        evidence: "Foundation Zoomer system scores (cube fz_scores): the scorecard's cross-sell candidates while Foundation Zoomer is selected. The default target rate is the share of similar results that already turned into an order. This is the revenue of results open today, not a yearly run rate, and it refreshes as new FZ orders come in.", ready: "ready", defaultOwner: "Sales + Marketing", annual: o.likely,
      });
    if (g.rows.length && g.low > 0)
      out.push({
        id: "gut-fz", name: "Pitch Gut Baseline and Gut Zoomer from FZ gut results", pillar: "Product Growth", source: "supporting", segment: "Clinics whose FZ gut results point to Gut Baseline or Gut Zoomer",
        indicator: "FZ gut results", indicatorValue: `${g.rows.length.toLocaleString("en-US")} clinics · ${money(g.low)} Gut Baseline to ${money(g.high)} Gut Zoomer`, metric: "Target Product Orders",
        from: "Foundation Zoomer system scores, Gut area (cube fz_scores)", clinicIds: g.rows.map(x => x.c.clinic), n: g.rows.length, cur: 0, tgt: Math.round((g.likely / g.low) * 1000) / 10, rateLabel: "share of open gut results that become an order", value: g.low / g.rows.length,
        observation: `${g.rows.length.toLocaleString("en-US")} clinics have ${g.open.toLocaleString("en-US")} gut results pointing to Gut Baseline or Gut Zoomer that no one has ordered yet. Low is ${money(g.low)} if every one orders Gut Baseline (the lower price), high is ${money(g.high)} if every one orders Gut Zoomer, and about ${money(g.likely)} is what usually converts.`,
        intervention: "Lead with Gut Baseline as the entry offer and move the clinics that respond into Gut Zoomer.",
        evidence: "Foundation Zoomer gut scores, with the conversion share taken from similar results. Gut Baseline is new, so its own conversion is not measured yet. This is the revenue of results open today, not a yearly run rate.", ready: "ready", defaultOwner: "Sales", annual: g.likely,
      });
  }
  const ws = inp.whitespace;
  if (ws && ws.pairs > 0 && ws.valuePerPair > 0) {
    out.push({
      id: "whitespace", name: "Open whitespace families in marked clinics", pillar: "Product Growth", source: "scorecard", segment: "Clinics reps marked eligible that never ordered the family", unit: "pairs",
      indicator: "Product whitespace", indicatorValue: `${ws.pairs.toLocaleString("en-US")} clinic × family pairs · ${ws.ids.length.toLocaleString("en-US")} clinics`, metric: "Product adoption", from: "",
      clinicIds: ws.ids, n: ws.pairs, cur: 0, tgt: 12, rateLabel: "share of pairs that start ordering the family", value: ws.valuePerPair,
      observation: `Reps marked ${ws.pairs.toLocaleString("en-US")} clinic × family pairs as eligible where the clinic has never ordered the family. A clinic that orders it brings in about ${money(ws.valuePerPair)} a year.`,
      intervention: "Rep-led introductions with a sample panel, the largest clinics first.",
      evidence: "The scorecard's Product whitespace indicator across every rep's eligibility marks. Only as complete as the marking: unmarked clinics are not counted.", ready: "partial", defaultOwner: "Sales + Marketing", annual: ws.pairs * ws.valuePerPair,
    });
  }
  const pv = inp.providers;
  if (pv && pv.length > 0) {
    const rev = sum(pv, p => p.dormantRevenue);
    const dormant = sum(pv, p => p.dormant);
    out.push({
      id: "providers", name: "Bring dormant providers back in multi-provider clinics", pillar: "Expansion", source: "supporting", segment: "3+ providers ordered in two years, 2+ not in the last 90 days",
      indicator: "Ordering providers per clinic", indicatorValue: `${pv.length.toLocaleString("en-US")} clinics · ${dormant.toLocaleString("en-US")} dormant providers`, metric: "Expansion Revenue",
      from: "Provider (customer) order history within each clinic", clinicIds: pv.map(p => p.clinic), n: pv.length, cur: 0, tgt: 10, rateLabel: "share of dormant providers ordering again", value: rev / pv.length,
      observation: `${pv.length.toLocaleString("en-US")} clinics still order but ${dormant.toLocaleString("en-US")} of their providers, who ordered earlier in the last two years, have not in 90 days. Those providers brought in ${money(rev)} a year.`,
      intervention: "Ask the rep to re-introduce the program to the dormant providers on the next clinic visit.",
      evidence: "Providers ordering per clinic over 24 months against the last 90 days. The share that return is an assumption to validate.", ready: "ready", defaultOwner: "Sales", annual: rev,
    });
  }
  if (inp.rows) {
    const rows = inp.rows;
    // Untouched high-value clinics: top-quartile baseline, last call or meeting 45+ days ago.
    const cut = topQuartile(rows.map(r => r.baseline ?? 0));
    const un = rows.filter(r => (r.baseline ?? 0) >= cut && cut > 0 && r.daysSinceTouch !== null && r.daysSinceTouch !== undefined && r.daysSinceTouch >= 45);
    const unBase = sum(un, r => r.baseline ?? 0) * A;
    if (un.length && unBase > 0)
      out.push({
        id: "untouched", name: "Re-engage high-value clinics with no recent call or meeting", pillar: "Retention", source: "supporting", segment: "Top-quartile baseline, last call or meeting 45+ days ago",
        indicator: "Untouched high-value clinics", indicatorValue: `${un.length.toLocaleString("en-US")} clinics · ${money(unBase)} baseline a year`, metric: "Revenue Retention",
        from: "Call and meeting touchpoints from HubSpot, joined to order history", clinicIds: un.map(r => r.clinic), n: un.length, cur: 0, tgt: 5, rateLabel: "share of baseline revenue protected by a call", value: unBase / un.length,
        observation: `${un.length.toLocaleString("en-US")} of the largest clinics by baseline have had no logged call or meeting for 45 days or more. Clinics with no touch on record at all are not counted.`,
        intervention: "Add them to each rep's weekly call list, largest baseline first.",
        evidence: "Last-touch dates (calls and meetings only) against baseline revenue. The share protected is an assumption to validate.", ready: "ready", defaultOwner: "Sales", annual: unBase,
      });
    // State attainment: the five US states furthest below goal.
    const by = new Map<string, { gap: number; ids: string[] }>();
    for (const r of rows) {
      const g = regionOf(r);
      if (g.kind !== "us" || !g.code) continue;
      const x = by.get(g.code) ?? { gap: 0, ids: [] };
      x.gap += r.expected - r.actual;
      x.ids.push(r.clinic);
      by.set(g.code, x);
    }
    const worst = [...by].filter(([, x]) => x.gap > 0).sort((a, b) => b[1].gap - a[1].gap).slice(0, 5);
    const gap = sum(worst, ([, x]) => x.gap) * A;
    const ids = worst.flatMap(([, x]) => x.ids);
    if (worst.length && gap > 0)
      out.push({
        id: "state-gap", name: `Close the revenue gap in ${worst.length} states`, pillar: "Expansion", source: "supporting", segment: `Existing clinics in ${worst.map(([k]) => k).join(", ")}`,
        indicator: "State attainment", indicatorValue: `${worst.map(([k]) => k).join(", ")} · ${money(gap)} a year below goal`, metric: "Expansion Revenue",
        from: "Order revenue by state against the goal, as on the Overview map", clinicIds: ids, n: ids.length, cur: 0, tgt: 25, rateLabel: "share of the gap to goal closed", value: gap / ids.length,
        observation: `Revenue is furthest below goal in ${worst.map(([k, x]) => `${k} (${money(x.gap * A)})`).join(", ")}. The shortfall is spread across ${ids.length.toLocaleString("en-US")} clinics.`,
        intervention: "Territory reviews with the RSMs in those states, with a clinic list per state.",
        evidence: "Revenue against goal by state, annualized from the analysis window. The share closed is an assumption to validate.", ready: "ready", defaultOwner: "Sales", annual: gap,
      });
  }
  return out;
}

export type Opp = OppDef & {
  saved: Saved;
  tgtEff: number;
  status: Status;
  owner: string;
  /** Person-days the team would spend; blank until entered. */
  effort: number | null;
  /** Incremental revenue a year at the target rate. */
  incr: number;
  /** Incremental revenue a year per person-day of effort, when effort is entered. */
  ret: number | null;
  scores: Weights;
  bucket: "Core growth" | "Growth experiment" | "Strategic bet";
};

export const revenueScore = (incr: number): number => (incr >= 400_000 ? 5 : incr >= 250_000 ? 4 : incr >= 120_000 ? 3 : incr >= 50_000 ? 2 : 1);
export const probScore = (s: Status): number => (s === "Hypothesis" ? 2 : s === "Quantified" ? 3 : s === "Validated" ? 4 : s === "Dropped" ? 1 : 5);
const clamp = (n: number | undefined, d: number) => Math.min(5, Math.max(1, Math.round(n ?? d)));

export function resolve(def: OppDef, saved: Saved = {}): Opp {
  const tgtEff = saved.tgt ?? def.tgt;
  const incr = Math.max(0, def.n * ((tgtEff - def.cur) / 100) * def.value);
  const status = saved.status ?? "Quantified";
  const effort = saved.effort && saved.effort > 0 ? saved.effort : null;
  const scores: Weights = { rev: revenueScore(incr), prob: probScore(status), fit: clamp(saved.fit, 3), time: clamp(saved.time, 3), feas: clamp(saved.feas, 3) };
  return {
    ...def, saved, tgtEff, status, owner: saved.owner || def.defaultOwner, effort, incr, ret: effort ? incr / effort : null, scores,
    bucket: scores.prob >= 4 ? "Core growth" : scores.prob === 3 ? "Growth experiment" : "Strategic bet",
  };
}

/** Weighted score out of 5. Weights are used as shares of their total, so they need not add up to 100. */
export function priority(o: { scores: Weights }, w: Weights): number {
  const tot = sum(WEIGHT_KEYS as unknown as WeightKey[], k => w[k]);
  return tot > 0 ? sum(WEIGHT_KEYS as unknown as WeightKey[], k => o.scores[k] * w[k]) / tot : 0;
}
export const recommendation = (score: number): "Prioritize" | "Validate" | "Park" => (score >= THRESHOLD ? "Prioritize" : score >= 3 ? "Validate" : "Park");

/** Incremental revenue of an opportunity inside one state or country: its clinics' share of the opportunity, by their value. */
export function regionSplit(o: Opp, rows: ClinicLite[]): Map<string, number> {
  const byId = new Map(rows.map(r => [r.clinic, r]));
  const out = new Map<string, number>();
  if (!o.n) return out;
  const each = o.incr / o.n;
  for (const id of o.clinicIds) {
    const r = byId.get(id);
    if (!r) continue;
    const g = regionOf(r);
    if (!g.code) continue;
    const key = `${g.kind}:${g.code}`;
    out.set(key, (out.get(key) ?? 0) + each);
  }
  return out;
}

/** Total incremental revenue with clinics counted once: a clinic in two opportunities counts for the larger of its two shares. */
export function overlapAdjusted(opps: Opp[]): number {
  const best = new Map<string, number>();
  for (const o of opps) {
    if (!o.n) continue;
    const each = o.incr / o.n;
    for (const id of o.clinicIds) if (each > (best.get(id) ?? 0)) best.set(id, each);
  }
  let t = 0;
  for (const v of best.values()) t += v;
  return t;
}
