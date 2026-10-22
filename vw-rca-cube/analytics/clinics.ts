import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { loadCfg } from "./config";
import { isTeamScope, teamOf } from "./scope";
import { ACTIVE_COHORTS } from "./lifecycle";
import { goalFactors } from "./baseline";
import {
  addDays,
  dayType,
  dow,
  eachDay,
  monthKey,
  quarterKey,
} from "./dateUtils";
import { evaluateFlags } from "./flags";
import { scopedQuery } from "./gated";
import { loadStops } from "./familyStops";
import { geoKeyOf } from "./geoKey";

/**
 * Clinic-level attribution behind any node of the shortfall tree.
 *
 * Every clinic carries its own day-type baseline (revenue, orders, bundle
 * split), so the same expected-vs-actual arithmetic used for the totals is
 * applied per clinic. Summing the clinic rows of a lens node reproduces that
 * node's number, except for the geography lens, which is allocated by the
 * clinic's dominant state rather than each order's ship-to state.
 */

export type ClinicRow = {
  clinic: string;
  /** Only set on the `famstops` focus (GZ / Total Tox still-out list). */
  stops?: { family: string; month: string; lastOrder: string; priorOrders: number }[];
  stopFamilies?: string;
  stopMonth?: string;
  stopMonthNum?: number;
  stopLastOrder?: string;
  stopLastNum?: number;
  stopDays?: number;
  stopPrior?: number;
  /** Total orders for this clinic over the entire refresh window. */
  windowOrders: number;
  /** Distinct order-DAYS over the entire refresh window (Shyam, 2026-09-28)
   * — same "one calendar day = one order" definition newClinicOrderSeq
   * uses, so matchesFocus()'s newgrp:fN fallback agrees with the cached
   * stage tags below instead of the raw transaction count above. */
  windowOrderDays: number;
  name: string;
  state: string;
  country: string;
  teamLead: string;
  sales: string;
  cohort: string;
  /** New-logo risk groups the clinic falls into (level 2 under new clinics). */
  newGroups: string[];
  /** First order this calendar year (analytics/lifecycleRules.ts). */
  isNew?: boolean;
  /** active / reactivated / churned, as of the latest data and by the clinic's own gap threshold. */
  life?: string;
  health: string[];
  pstatus: string[];
  /** Goal: baseline x the period goal factor. `delta` is actual minus this. */
  expected: number;
  /** Baseline: mean run rate over the baseline window (additive). */
  baseline: number;
  /** The clinic's baseline over a full week (any weekday): > 0 means it ordered in the baseline window. Tab-independent. */
  baselineWeekly?: number;
  baselineOrders: number;
  /** actual - baseline: what actually moved. */
  realChange: number;
  /** goal - baseline: the stretch above the baseline. delta = realChange - ambition. */
  ambition: number;
  actual: number;
  delta: number;
  orders: number;
  expectedOrders: number;
  volume: number;
  aovEffect: number;
  aov: number;
  baseAov: number;
  bundleDelta: number;
  nonBundleDelta: number;
  bundleOrders: number;
  /** Share of this clinic's orders in the window that are bundle orders. */
  bundleShare: number;
  /** The same share over the baseline, so the column reads as a change. */
  baseBundleShare: number;
  /** Distinct patients per day summed over the period, and its baseline. */
  patients: number;
  expectedPatients: number;
  patientDelta: number;
  metric: number;
  /** Year-to-date revenue and trailing-13-week revenue for this clinic, used
   * by the geography/rep run-rate projection — carried straight off the
   * clinicMeta row already loaded above so callers don't need a second
   * full-table scan just to get these two numbers. */
  ytdRevenue: number;
  /** Orders this calendar year (lifetime orders for a clinic that is new this year). */
  ytdOrders?: number;
  fwdRevenue: number;
  /** Last-3-months order cadence, precomputed at refresh time (see refresh.ts)
   * so callers needing it (the feed's cadence cards) don't need extra
   * full-table clinicPeriod scans at query time. monthSeries is oldest→newest,
   * length matches however many of the last 3 window-months exist. */
  monthOrders: number;
  monthSeries: number[];
  /** Rep view (2026-09-28): reorder-cadence and touch inputs, as of cutoff. */
  lastOrderAllTime?: string;
  lastTouchDate?: string;
  firstOrder?: string;
  /** Expected revenue per calendar day by weekday (0=Sun), P75-adjusted. */
  rateDow?: number[];
  /** Baseline orders per calendar day (all weekdays averaged). */
  baseOrdersPerDay?: number;
};

type Lens =
  | "total"
  | "volume"
  | "aov"
  | "bundle"
  | "nonbundle"
  | "cohort"
  | "state"
  /** Patient-traffic lens: ranks clinics by patient deficit vs their own
   * baseline; the metric is a patient count, not dollars. */
  | "traffic"
  /** Geography lens that also covers international countries; the key is the
   * geo key from geo.ts ("CA" for California, "c:CA" for Canada). */
  | "geo";

export function periodDays(
  periodId: string,
  currentStart: string,
  currentEnd: string,
): string[] {
  if (periodId === "all") return eachDay(currentStart, currentEnd);
  const [kind, key] = periodId.split(":");
  if (kind === "d") return [key];
  if (kind === "w") {
    return eachDay(key, addDays(key, 6)).filter(
      d => d >= currentStart && d <= currentEnd,
    );
  }
  if (kind === "m") {
    return eachDay(currentStart, currentEnd).filter(d => monthKey(d) === key);
  }
  if (kind === "q") {
    return eachDay(currentStart, currentEnd).filter(d => quarterKey(d) === key);
  }
  return eachDay(currentStart, currentEnd);
}

// `ids:` focuses (wins cards, alert cards) can carry hundreds of clinic ids.
// matchesFocus runs once per clinic per drill() call, so splitting the
// comma list and doing an O(n) `.includes()` on every row turned an O(rows)
// scan into O(rows * ids) and blew Convex's 1s query budget once a "ids:"
// list got past a couple hundred entries. Cache the parsed Set per focus
// string (module-level, tiny and short-lived — each drill() call only ever
// sees one or two distinct focus values).
let idsFocusCache: { focus: string; set: Set<string> } | null = null;
function idsFocusSet(focus: string): Set<string> {
  if (idsFocusCache && idsFocusCache.focus === focus) return idsFocusCache.set;
  const set = new Set(focus.slice(4).split(","));
  idsFocusCache = { focus, set };
  return set;
}

/** Does a clinic row belong to the cohort an alert card counted? Shared by the
 * drill list and the clinic search, so both agree on membership. */
export function matchesFocus(
  r: {
    clinic: string;
    orders: number;
    windowOrders?: number;
    windowOrderDays?: number;
    expected: number;
    baseAov: number;
    aov: number;
    delta: number;
    sales: string;
    health: string[];
    pstatus: string[];
    newGroups?: string[];
  },
  focus: string,
): boolean {
  if (!focus) return true;
  if (focus === "silent") return r.orders === 0 && r.expected > 0;
  if (focus === "aovdrop")
    return r.orders >= 20 && r.baseAov > 0 && r.aov < r.baseAov * 0.75;
  if (focus === "stopped") return r.pstatus.includes("STOPPED");
  if (focus === "risers") return r.delta > 0;
  if (focus === "losers") return r.delta < 0;
  if (focus.startsWith("ids:")) return idsFocusSet(focus).has(r.clinic);
  if (focus.startsWith("sales:")) return r.sales === focus.slice(6);
  if (focus.startsWith("health:")) return r.health.includes(focus.slice(7));
  if (focus.startsWith("newgrp:")) {
    const groups = r.newGroups ?? [];
    const group = focus.slice(7);
    // The click target is defined by actual orders in the selected period,
    // not the last refresh's cached stage labels. This also handles new
    // stages added after a clinicMeta generation was written. Uses
    // `windowOrderDays` (distinct order-days, same "one order = one
    // calendar day" rule newClinicOrderSeq uses) rather than the raw
    // transaction count `windowOrders`/`orders` — mixing the two definitions
    // is what caused the Today tab's "getting to order 4" funnel to diverge
    // from the Provider Retention Funnel (Shyam, 2026-09-28 mismatch report).
    const dropStage = group.match(/^f([2-9])drop$/);
    if (dropStage) {
      const reached = Number(dropStage[1]) - 1;
      const next = Number(dropStage[1]);
      const windowOrderDays = r.windowOrderDays ?? r.windowOrders ?? r.orders;
      if (groups.includes(`f${next}drop`) || groups.includes(`f${next}`)) {
        return groups.includes(`f${reached}`) && !groups.includes(`f${next}`);
      }
      return (
        groups.includes(`f${reached}`) &&
        windowOrderDays >= reached &&
        windowOrderDays < next
      );
    }
    const orderStage = group.match(/^f([1-9])$/);
    if (orderStage) {
      if (groups.includes(group)) return true;
      return (
        groups.includes("f1") &&
        (r.windowOrderDays ?? r.windowOrders ?? r.orders) >=
          Number(orderStage[1])
      );
    }
    return groups.includes(group);
  }
  return true;
}

/**
 * Whole-clinic actual/expected for one selected period, keyed by clinic —
 * the same unscoped numbers `drill()` feeds into `evaluateFlags`. Exposed so
 * other clinic-list paths (family/product/provider drills in families.ts)
 * can evaluate the SAME health flags for the SAME period without re-deriving
 * the P75/weekday-rate math, and without ever substituting a family- or
 * bundle-scoped number in their place.
 */
type ClinicMetaRow = {
  clinic: string;
  rev: number[];
  ord: number[];
  bOrd: number[];
  ytdOrders?: number;
  ytdRevenue?: number;
  lastOrderAllTime?: string;
  firstOrder?: string;
  vaYtdPct?: number;
  lifetimeDeductionRate?: number;
  lastTouchDate?: string;
  touchDataAvailable?: boolean;
  medianGapBd?: number;
  bdSinceLastOrder?: number;
};

/**
 * Whole-clinic actual/expected for one selected period, keyed by clinic —
 * the same unscoped numbers `drill()` feeds into `evaluateFlags`. Exposed so
 * other clinic-list paths (family/product/provider drills in families.ts)
 * can evaluate the SAME health flags for the SAME period without re-deriving
 * the P75/weekday-rate math, and without ever substituting a family- or
 * bundle-scoped number in their place.
 *
 * Takes an already-fetched `meta` array when the caller has one (e.g.
 * families.ts's `context()`, which needs the full clinicMeta collect for its
 * own response anyway) — collecting the whole `clinicMeta` table twice in
 * one query can trip Convex's per-execution byte-read cap.
 */
export async function clinicPerformanceMap(
  ctx: QueryCtx,
  periodId: string,
  meta?: ClinicMetaRow[],
): Promise<{
  ready: boolean;
  cutoff: string;
  byClinic: Map<
    string,
    {
      actual: number;
      expected: number;
      orders: number;
      expectedOrders: number;
      bundleOrders: number;
      expectedBundleOrders: number;
    }
  >;
}> {
  const cfg = await loadCfg(ctx);
  if (!cfg) return { ready: false, cutoff: "", byClinic: new Map() };
  const gen = cfg.gen ?? 0;
  const gf = await goalFactors(ctx, cfg, periodId);
  const days = periodDays(periodId, cfg.currentStart, cfg.currentEnd);
  if (days.length === 0)
    return { ready: false, cutoff: "", byClinic: new Map() };
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) dowCounts[dow(d)]++;

  const rows =
    meta ??
    (await ctx.db
      .query("clinicMeta")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect());
  const actuals = await ctx.db
    .query("clinicPeriod")
    .withIndex("by_gen_period", q => q.eq("gen", gen).eq("periodId", periodId))
    .collect();
  const actualBy = new Map(actuals.map(a => [a.clinic, a]));
  const byClinic = new Map<
    string,
    {
      actual: number;
      expected: number;
      orders: number;
      expectedOrders: number;
      bundleOrders: number;
      expectedBundleOrders: number;
    }
  >();
  for (const m of rows) {
    const a = actualBy.get(m.clinic);
    const actual = a?.revenue ?? 0;
    const orders = a?.orders ?? 0;
    const bundleOrders = a?.bundleOrders ?? 0;
    let expected = 0;
    let expectedOrders = 0;
    let expBundleOrd = 0;
    for (let i = 0; i < 7; i++) {
      const c = dowCounts[i];
      if (!c) continue;
      expected += m.rev[i] * gf.rev * c;
      expectedOrders += m.ord[i] * gf.ord * c;
      expBundleOrd += m.bOrd[i] * gf.ord * c;
    }
    byClinic.set(m.clinic, {
      actual,
      expected,
      orders,
      expectedOrders,
      bundleOrders,
      expectedBundleOrders: expBundleOrd,
    });
  }
  return { ready: true, cutoff: cfg.currentEnd, byClinic };
}

/**
 * Evaluates the shared health-flag set for every clinic for one selected
 * period — the whole-clinic-scope counterpart of `clinicPerformanceMap`,
 * for callers (family/product/provider drills) that just want the flags
 * without re-deriving the underlying actual/expected numbers themselves.
 *
 * Same `meta` reuse note as `clinicPerformanceMap` — always pass it when the
 * caller already has the clinicMeta collect, to keep this a single extra
 * `clinicPeriod` read rather than a second full `clinicMeta` scan.
 */
export async function clinicHealthMap(
  ctx: QueryCtx,
  periodId: string,
  meta: ClinicMetaRow[],
): Promise<Map<string, string[]>> {
  const { ready, cutoff, byClinic } = await clinicPerformanceMap(
    ctx,
    periodId,
    meta,
  );
  const out = new Map<string, string[]>();
  if (!ready) return out;
  for (const m of meta) {
    const perf = byClinic.get(m.clinic);
    if (!perf) continue;
    out.set(
      m.clinic,
      evaluateFlags(
        cutoff,
        {
          ytdOrders: m.ytdOrders ?? 0,
          ytdRevenue: m.ytdRevenue ?? 0,
          lastOrderAllTime: m.lastOrderAllTime ?? "",
          firstOrder: m.firstOrder ?? "",
          vaYtdPct: m.vaYtdPct,
          lifetimeDeductionRate: m.lifetimeDeductionRate,
          lastTouchDate: m.lastTouchDate,
          touchDataAvailable: m.touchDataAvailable ?? false,
          medianGapBd: m.medianGapBd,
          bdSinceLastOrder: m.bdSinceLastOrder,
        },
        perf,
      ),
    );
  }
  return out;
}

export async function drill(
  ctx: QueryCtx,
  args0: {
    periodId: string;
    lens: string;
    key?: string;
    limit?: number;
    unlimited?: boolean;
    /** Sales supervisor / team lead filter applied to every clinic-derived
     * view (lists, geography, scoped totals). */
    teamLead?: string;
    /** Individual sales rep filter — same idea as teamLead but one grain
     * down. Composable with teamLead (a rep row still has to match both if
     * both are set, though in practice a rep belongs to one lead). */
    sales?: string;
    /** Optional alert cohort from the news rail: narrows the list to the same
     * clinics the alert card counted (e.g. silent clinics, AOV collapses). */
    focus?: string;
    /** Historical insight snapshots (Shyam, 2026-09-23): reads a "snapshot"
     * config row instead of "main" so backfill never touches the live window. */
    configKey?: string;
    /** Force `windowOrders` (lifetime order count used by the new-clinic
     * f1..f4 funnel classification in matchesFocus) to be computed from the
     * full "all" window even when no `newgrp:` focus is set (Shyam,
     * 2026-09-28 bug report). Callers like repView.book() need every row's
     * lifetime order count to classify new clinics themselves, without
     * asking drill() to also filter the row set down to one funnel stage —
     * that's what a plain `focus: "newgrp:…"` would do instead. */
    wantWindowOrders?: boolean;
    /** Keep clinics that have a baseline (ordered in the baseline window) even when this period's weekdays give them
     * zero expected and zero actual, so lifecycle membership and counts do not change with the tab (2026-10-18). */
    keepBaselined?: boolean;
  },
) {
  // A team scope ("team:<lead>", rep view for a VP of sales) is the team-lead filter: the lead's clinics and every rep's under them.
  const args = isTeamScope(args0.sales) ? { ...args0, sales: undefined, teamLead: teamOf(args0.sales) } : args0;
  const cfg = await loadCfg(ctx, args.configKey);
  if (!cfg) return { ready: false as const, rows: [], total: 0, count: 0 };
  const gen = cfg.gen ?? 0;

  const gf = await goalFactors(ctx, cfg, args.periodId);
  const days = periodDays(args.periodId, cfg.currentStart, cfg.currentEnd);
  if (days.length === 0) {
    return { ready: false as const, rows: [], total: 0, count: 0 };
  }
  const wk = days.filter(d => dayType(d) === "wk").length;
  const we = days.length - wk;
  // Precompute how many days in the window fall on each weekday once, so the
  // per-clinic "expected" loop below is O(7) instead of O(days.length) — for
  // the full-window "all" period (200+ days) this cut the hottest loop in
  // drill() by ~30x and was needed to keep it under Convex's 1s budget.
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) dowCounts[dow(d)]++;

  // Scoped read: a rep's or team lead's own clinics come straight off an
  // index instead of reading the whole table and filtering in memory (which
  // cost 7-12 MB per call and hit Convex's 16 MiB cap on long windows). The
  // loop below still applies the same filters, so rows are unchanged. Needs
  // the generation's global baseline sums (written at refresh); older
  // generations without them keep the full read.
  const scopeLead =
    args.teamLead && args.teamLead !== "—" ? args.teamLead : undefined;
  const useScope =
    !!(args.sales || scopeLead) &&
    cfg.baseRevAll !== undefined &&
    cfg.baseOrdersAll !== undefined;
  const meta = useScope
    ? args.sales
      ? await ctx.db
          .query("clinicMeta")
          .withIndex("by_gen_sales", q =>
            q.eq("gen", gen).eq("sales", args.sales!),
          )
          .collect()
      : await ctx.db
          .query("clinicMeta")
          .withIndex("by_gen_lead", q =>
            q.eq("gen", gen).eq("teamLead", scopeLead!),
          )
          .collect()
    : await ctx.db
        .query("clinicMeta")
        .withIndex("by_gen", q => q.eq("gen", gen))
        .collect();
  // Global baseline AOV — used for the volume / price split so the clinic rows
  // add back to the same numbers as lens A on the tree. Always company-wide,
  // so a scoped read takes it from the sums stored at refresh.
  let baseRevAll = 0;
  let baseOrdAll = 0;
  if (useScope) {
    baseRevAll = cfg.baseRevAll!;
    baseOrdAll = cfg.baseOrdersAll!;
  } else {
    for (const m of meta) {
      baseRevAll += m.baseRev;
      baseOrdAll += m.baseOrders;
    }
  }
  const globalBaseAov = baseOrdAll ? baseRevAll / baseOrdAll : 0;
  // Period rows. A small scope (one rep) looks its clinics up by index; a
  // large one, or a company-wide read, takes the period's rows in one range
  // (Convex caps a function at ~4k index reads, so no per-clinic lookups for
  // big scopes).
  const pointLookup = useScope && meta.length <= 1000;
  const periodRows = async (periodId: string) =>
    pointLookup
      ? (
          await Promise.all(
            meta.map(m =>
              ctx.db
                .query("clinicPeriod")
                .withIndex("by_gen_period_clinic", q =>
                  q
                    .eq("gen", gen)
                    .eq("periodId", periodId)
                    .eq("clinic", m.clinic),
                )
                .collect(),
            ),
          )
        ).flat()
      : await ctx.db
          .query("clinicPeriod")
          .withIndex("by_gen_period", q =>
            q.eq("gen", gen).eq("periodId", periodId),
          )
          .collect();
  const actuals = await periodRows(args.periodId);
  const actualBy = new Map(actuals.map(a => [a.clinic, a]));
  const allWindowActuals =
    (args.focus?.startsWith("newgrp:") || args.wantWindowOrders) &&
    args.periodId !== "all"
      ? await periodRows("all")
      : actuals;
  const windowOrdersBy = new Map(
    allWindowActuals.map(a => [a.clinic, a.orders]),
  );

  const lens = args.lens as Lens;
  const rawKey = args.key ?? "";
  const exclude = rawKey.startsWith("!");
  const stateKeys = new Set(
    rawKey
      .replace(/^!/, "")
      .split("/")
      .map(s => s.trim()),
  );

  const rows: ClinicRow[] = [];
  for (const m of meta) {
    if (args.teamLead && (m.teamLead ?? "—") !== args.teamLead) continue;
    if (args.sales && (m.sales ?? "—") !== args.sales) continue;
    // "active" is the grouped lifecycle stage (retained top 20% + the rest); see lifecycle.ts
    if (lens === "cohort" && (args.key === "active" ? !ACTIVE_COHORTS.includes(m.cohort as never) : m.cohort !== args.key)) continue;
    if (lens === "state") {
      const inSet = stateKeys.has(m.state);
      if (exclude ? inSet : !inSet) continue;
    }
    if (lens === "geo") {
      const gk = geoKeyOf({
        state: m.state,
        country: m.country ?? "—",
      }).key;
      const inSet = stateKeys.has(gk);
      if (exclude ? inSet : !inSet) continue;
    }
    const a = actualBy.get(m.clinic);
    const actual = a?.revenue ?? 0;
    const orders = a?.orders ?? 0;
    const bundleRevenue = a?.bundleRevenue ?? 0;
    const bundleOrders = a?.bundleOrders ?? 0;
    const patients = a?.patients ?? 0;

    let expected = 0;
    let expectedOrders = 0;
    let expBundleRev = 0;
    let expBundleOrd = 0;
    let expPatients = 0;
    // Baseline = the clinic's mean run rate over the baseline window; goal = baseline x the period's goal factor
    // (analytics/baseline.ts). Computed for EVERY clinic, ordering or not, so clinic goals add up to the rep's, the
    // rep's to the lead's and the company's exactly. (Until 2026-10-16 ordering clinics were scaled to their rep while
    // non-ordering ones got an extra unscaled expectation on top, so clinic rows summed to more than the book.)
    let baseline = 0;
    let baselineOrders = 0;
    for (let i = 0; i < 7; i++) {
      const c = dowCounts[i];
      if (!c) continue;
      baseline += m.rev[i] * c;
      baselineOrders += m.ord[i] * c;
      expBundleRev += m.bRev[i] * gf.rev * c;
      expBundleOrd += m.bOrd[i] * gf.ord * c;
      expPatients += (m.pat?.[i] ?? 0) * gf.ord * c;
    }
    expected = baseline * gf.rev;
    expectedOrders = baselineOrders * gf.ord;

    // A brand-new clinic legitimately has expected=0 on any day it hasn't
    // ordered yet (no baseline history to project from), so this skip used
    // to drop it out of `rows` entirely on any narrow window it didn't buy
    // in — which meant the new-clinic funnel (order 1..4 stage counts) saw
    // almost none of a rep's new clinics outside the rare window that
    // happened to contain every one of their orders (Shyam, 2026-09-28 bug
    // report). Keep the row (at $0/$0) for anything already tagged "new" so
    // funnel classification always sees it, regardless of the window.
    const baselineWeekly = m.rev.reduce((t: number, x: number) => t + x, 0);
    if (expected === 0 && actual === 0 && !(m.newGroups ?? []).length && !(args.keepBaselined && (baselineWeekly > 0 || m.cohort === "reactivated" || m.cohort === "churned" || m.cohort === "new" || m.isNew))) continue;

    const baseAov = m.baseOrders ? m.baseRev / m.baseOrders : 0;

    const volume = (orders - expectedOrders) * globalBaseAov;
    const aovEffect = actual - expected - volume;

    const baseBundleAov = expBundleOrd ? expBundleRev / expBundleOrd : 0;
    const bundleDelta = expBundleOrd
      ? (bundleOrders - expBundleOrd) * baseBundleAov +
        bundleOrders *
          ((bundleOrders ? bundleRevenue / bundleOrders : 0) - baseBundleAov)
      : bundleRevenue;
    const nonBundleDelta = actual - expected - bundleDelta;

    const delta = actual - expected;
    const patientDelta = patients - expPatients;
    // Health flags always describe the WHOLE clinic — computed from the
    // unscoped actual/expected/bundle numbers above, never the bundle/
    // nonbundle-scoped ones below, so a badge reads the same whether it's
    // shown at the top-level clinic list or inside a bundle drilldown.
    const health = evaluateFlags(
      cfg.currentEnd,
      {
        ytdOrders: m.ytdOrders ?? 0,
        ytdRevenue: m.ytdRevenue ?? 0,
        lastOrderAllTime: m.lastOrderAllTime ?? "",
        firstOrder: m.firstOrder ?? "",
        vaYtdPct: m.vaYtdPct,
        lifetimeDeductionRate: m.lifetimeDeductionRate,
        lastTouchDate: m.lastTouchDate,
        touchDataAvailable: m.touchDataAvailable ?? false,
        medianGapBd: m.medianGapBd,
        bdSinceLastOrder: m.bdSinceLastOrder,
      },
      {
        actual,
        expected,
        orders,
        expectedOrders,
        bundleOrders,
        expectedBundleOrders: expBundleOrd,
      },
    );
    const metric =
      lens === "volume"
        ? volume
        : lens === "aov"
          ? aovEffect
          : lens === "bundle"
            ? bundleDelta
            : lens === "nonbundle"
              ? nonBundleDelta
              : lens === "traffic"
                ? patientDelta
                : delta;
    // The traffic lens answers "who is responsible for LOW patient traffic":
    // clinics at or above their own baseline are not part of that list.
    if (lens === "traffic" && patientDelta >= 0) continue;

    // On the bundle / non-bundle branch the row's headline columns are scoped
    // to that order universe — showing all-order counts under a bundle node
    // made the rows disagree with the node above them.
    const scoped =
      lens === "bundle"
        ? {
            actual: bundleRevenue,
            expected: expBundleRev,
            orders: bundleOrders,
            expectedOrders: expBundleOrd,
          }
        : lens === "nonbundle"
          ? {
              actual: actual - bundleRevenue,
              expected: expected - expBundleRev,
              orders: orders - bundleOrders,
              expectedOrders: expectedOrders - expBundleOrd,
            }
          : { actual, expected, orders, expectedOrders };

    rows.push({
      clinic: m.clinic,
      windowOrders: windowOrdersBy.get(m.clinic) ?? orders,
      windowOrderDays: m.windowOrderDays ?? 0,
      name: m.name,
      state: m.state,
      country: m.country ?? "—",
      teamLead: m.teamLead ?? "—",
      sales: m.sales,
      cohort: m.cohort,
      newGroups: m.newGroups ?? [],
      isNew: m.isNew ?? false,
      life: m.life,
      health,
      pstatus: m.pstatus ?? [],
      expected: scoped.expected,
      baseline: scoped.expected / (gf.rev || 1),
      baselineWeekly,
      baselineOrders: scoped.expectedOrders / (gf.ord || 1),
      realChange: scoped.actual - scoped.expected / (gf.rev || 1),
      ambition: scoped.expected - scoped.expected / (gf.rev || 1),
      actual: scoped.actual,
      delta,
      orders: scoped.orders,
      expectedOrders: scoped.expectedOrders,
      volume,
      aovEffect,
      aov: scoped.orders ? scoped.actual / scoped.orders : 0,
      baseAov: scoped.expectedOrders
        ? scoped.expected / scoped.expectedOrders
        : baseAov,
      bundleDelta,
      nonBundleDelta,
      bundleOrders,
      bundleShare: orders ? bundleOrders / orders : 0,
      baseBundleShare: expectedOrders ? expBundleOrd / expectedOrders : 0,
      patients,
      expectedPatients: expPatients,
      patientDelta,
      metric,
      ytdRevenue: m.ytdRevenue ?? 0,
      ytdOrders: m.ytdOrders ?? 0,
      fwdRevenue: m.fwdRevenue ?? 0,
      monthOrders: m.monthOrders ?? 0,
      monthSeries: m.monthSeries ?? [],
      lastOrderAllTime: m.lastOrderAllTime,
      lastTouchDate: m.lastTouchDate,
      firstOrder: m.firstOrder,
      rateDow: m.rev.map(x => x * gf.rev),
      baseOrdersPerDay: m.ord.reduce((a, b) => a + b, 0) / 7,
    });
  }

  // Alert focus: keep only the clinics the alert card was talking about, so
  // the totals under the list match the number quoted on the card.
  const focus = args.focus ?? "";
  // Gut Zoomer / Total Tox still-out clinics (Shyam, 2026-10-13): the feed
  // card opens the regular clinic list narrowed to the familyStops clinics,
  // with the stop details attached as extra columns. Every stopped clinic is
  // returned (no top-N) so the family / month chips filter client-side.
  let famstops = false;
  if (focus.startsWith("famstops")) {
    famstops = true;
    const stops = await loadStops(ctx, args.teamLead);
    const by = new Map<string, typeof stops>();
    for (const s of stops) {
      const arr = by.get(s.clinic);
      if (arr) arr.push(s);
      else by.set(s.clinic, [s]);
    }
    const end = cfg.currentEnd as string;
    const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
    // Clinics with no row in this generation's clinicMeta (no baseline or
    // window activity, e.g. last order in Feb) still belong on the list:
    // add them with zero RCA columns so the count matches the feed card.
    const present = new Set(rows.map(r => r.clinic));
    for (const [clinic, ss] of by) {
      if (present.has(clinic)) continue;
      const s0 = ss[0];
      if (args.sales && s0.sales !== args.sales) continue;
      rows.push({
        clinic, windowOrders: 0, windowOrderDays: 0, name: s0.name, state: s0.state,
        country: "—", teamLead: s0.teamLead ?? "—", sales: s0.sales, cohort: "—",
        newGroups: [], health: [], pstatus: [], expected: 0, baseline: 0, baselineOrders: 0, realChange: 0, ambition: 0, actual: 0, delta: 0,
        orders: 0, expectedOrders: 0, volume: 0, aovEffect: 0, aov: 0, baseAov: 0,
        bundleDelta: 0, nonBundleDelta: 0, bundleOrders: 0, bundleShare: 0,
        baseBundleShare: 0, patients: 0, expectedPatients: 0, patientDelta: 0,
        metric: 0, ytdRevenue: 0, fwdRevenue: 0, monthOrders: 0, monthSeries: [],
      });
    }
    const kept = rows
      .filter(r => by.has(r.clinic))
      .map(r => {
        const ss = [...by.get(r.clinic)!].sort((a, b) => a.family.localeCompare(b.family));
        const last = ss.map(s => s.lastOrder).sort().pop() ?? "";
        const month = ss.map(s => s.month).sort()[0] ?? "";
        return Object.assign(r, {
          stops: ss.map(s => ({ family: s.family, month: s.month, lastOrder: s.lastOrder, priorOrders: s.priorOrders })),
          stopFamilies: ss.map(s => (s.family === "Gut Zoomer" ? "GZ" : "TT")).join(" + "),
          stopMonth: month,
          stopMonthNum: month ? Number(month.replace("-", "")) : 0,
          stopLastOrder: last,
          stopLastNum: last ? Number(last.replace(/-/g, "")) : 0,
          stopDays: last && end ? Math.round(dayNum(end) - dayNum(last)) : 0,
          stopPrior: ss.reduce((a, s) => a + s.priorOrders, 0),
        });
      });
    rows.length = 0;
    rows.push(...kept);
  } else {
    const focused = !focus ? [...rows] : rows.filter(r => matchesFocus(r, focus));
    rows.length = 0;
    rows.push(...focused);
  }

  const total = rows.reduce((s, r) => s + r.metric, 0);
  const count = rows.length;
  const descending = total > 0;
  rows.sort((x, y) => (descending ? y.metric - x.metric : x.metric - y.metric));
  const limit = args.unlimited || famstops ? rows.length : Math.min(args.limit ?? 50, 500);

  // Positive vs negative driver split — every node nets a single number, but
  // that number can hide bright spots inside a dragging cohort (or drags
  // inside a growing one). Computed over the full row set, not just the
  // page shown, so it doesn't shift as someone pages through the list.
  let posSum = 0;
  let posCount = 0;
  let negSum = 0;
  let negCount = 0;
  for (const r of rows) {
    if (r.metric >= 0) {
      posSum += r.metric;
      posCount++;
    } else {
      negSum += r.metric;
      negCount++;
    }
  }

  return {
    ready: true as const,
    rows: rows.slice(0, limit),
    total,
    count,
    posSum,
    posCount,
    negSum,
    negCount,
    days: days.length,
    weekdays: wk,
    weekends: we,
  };
}

export const clinicDrill = scopedQuery({
  args: {
    periodId: v.string(),
    lens: v.string(),
    key: v.optional(v.string()),
    limit: v.optional(v.number()),
    focus: v.optional(v.string()),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => await drill(ctx, args),
});

export const clinicDrillInternal = internalQuery({
  args: {
    periodId: v.string(),
    lens: v.string(),
    key: v.optional(v.string()),
    limit: v.optional(v.number()),
    focus: v.optional(v.string()),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => await drill(ctx, args),
});

/**
 * Positive vs negative driver split, per cohort — same split `drill()` already
 * returns for a single lens/key node, but computed once for every cohort in
 * one pass so lens C's tree branches can each show their own split inline
 * without a click. Reuses a single lens="total"/unlimited drill() (same cost
 * as the wins/feed panels already pay once per load) instead of one collect
 * per cohort. Requested by Shyam 2026-09-06 so the split reads on the branch
 * itself, not only after opening the clinic list.
 */
export const cohortDriverSplit = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      teamLead: args.teamLead,
      sales: args.sales,
    });
    if (!res.ready) return { ready: false as const };
    const byCohort = new Map<
      string,
      { posSum: number; posCount: number; negSum: number; negCount: number }
    >();
    for (const r of res.rows) {
      const s = byCohort.get(r.cohort) ?? {
        posSum: 0,
        posCount: 0,
        negSum: 0,
        negCount: 0,
      };
      if (r.delta >= 0) {
        s.posSum += r.delta;
        s.posCount++;
      } else {
        s.negSum += r.delta;
        s.negCount++;
      }
      byCohort.set(r.cohort, s);
    }
    // The grouped lifecycle stage "Active" (retained top 20% + the rest), see lifecycle.ts
    const active = { posSum: 0, posCount: 0, negSum: 0, negCount: 0 };
    for (const k of ACTIVE_COHORTS) {
      const c = byCohort.get(k);
      if (!c) continue;
      active.posSum += c.posSum;
      active.posCount += c.posCount;
      active.negSum += c.negSum;
      active.negCount += c.negCount;
    }
    const cohortsOut: Record<string, { posSum: number; posCount: number; negSum: number; negCount: number }> = {
      ...Object.fromEntries(byCohort),
      active,
    };
    return {
      ready: true as const,
      cohorts: cohortsOut,
    };
  },
});

/**
 * The new-client funnel under the new-clinics branch: order 1 -> 2 -> 3 ->
 * still active. Order stages are cumulative (a clinic with 3 orders sits in
 * all of order 1, 2 and 3); `f2drop` is the disjoint set that had exactly one
 * order. Every stage is compared with the baseline window's own new clients,
 * pace-adjusted for window length.
 */
export const newClinicGroups = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    // Rep logins: only that rep's new clinics. The baseline-window groups
    // are precomputed per team lead only, so with a rep filter the
    // comparison falls back to the whole-book baseline scaled by the rep's
    // share of current new-clinic revenue (see below).
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "cohort",
      key: "new",
      unlimited: true,
      teamLead: args.teamLead,
      sales: args.sales,
    });
    if (!res.ready) return { ready: false as const, groups: [], total: 0 };

    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    const baseRows = await ctx.db
      .query("newLogoBaseline")
      .withIndex("by_gen_lead", q =>
        q.eq("gen", gen).eq("lead", args.teamLead ?? ""),
      )
      .collect();
    const baseOf = new Map(baseRows.map(r => [r.key, r]));
    // Baseline windows are usually shorter than the analysis window, so the
    // comparison is put on the same daily pace before it is subtracted.
    const scale =
      baseRows.length && baseRows[0].baseDays
        ? baseRows[0].curDays / baseRows[0].baseDays
        : 1;

    const STAGES = [
      { key: "f1", label: "Order 1" },
      { key: "f2drop", label: "Did not place order 2" },
      { key: "f2", label: "Order 2" },
      { key: "f3drop", label: "Did not place order 3" },
      { key: "f3", label: "Order 3" },
      { key: "f4drop", label: "Did not place order 4" },
      { key: "f4", label: "Order 4" },
      { key: "active", label: "Still active" },
    ];

    const cell = (key: string) => {
      const dropStage = key.match(/^f([2-9])drop$/);
      const rows = res.rows.filter(r => matchesFocus(r, `newgrp:${key}`));
      // Drop-off is a current-window operational count rather than a
      // like-for-like rung. Where both cumulative baseline rungs exist,
      // subtract the next rung to get the exact baseline drop-off cohort.
      const baseCount = (stageKey: string) => {
        const row = baseOf.get(stageKey);
        return row
          ? { clinics: row.clinics, revenue: row.revenue, orders: row.orders }
          : undefined;
      };
      let b = baseCount(key);
      if (dropStage) {
        const previous = baseCount(`f${Number(dropStage[1]) - 1}`);
        const next = baseCount(`f${dropStage[1]}`);
        b =
          previous && next
            ? {
                clinics: Math.max(0, previous.clinics - next.clinics),
                revenue: previous.revenue - next.revenue,
                orders: previous.orders - next.orders,
              }
            : undefined;
      }
      const baseClinics = (b?.clinics ?? 0) * scale;
      const baseRevenue = (b?.revenue ?? 0) * scale;
      const baseOrders = (b?.orders ?? 0) * scale;
      const revenue = rows.reduce((s, r) => s + r.actual, 0);
      const orders = rows.reduce((s, r) => s + r.orders, 0);
      return {
        key,
        clinics: rows.length,
        revenue,
        orders,
        baseClinics,
        baseRevenue,
        baseOrders,
        baselineAvailable: !!b,
        clinicDelta: rows.length - baseClinics,
        revenueDelta: revenue - baseRevenue,
        orderDelta: orders - baseOrders,
      };
    };

    const groups = STAGES.map(st => ({ ...cell(st.key), label: st.label }));

    const allBase = baseOf.get("__all__");
    return {
      ready: true as const,
      groups,
      // Only clinics whose first ever order falls in THIS window carry groups;
      // the drill also holds the baseline window's new logos, which supply the
      // branch's expectation and are counted separately.
      clinics: res.rows.filter(r => r.newGroups.length > 0).length,
      revenue: res.rows
        .filter(r => r.newGroups.length > 0)
        .reduce((s, r) => s + r.actual, 0),
      baseRevenue: (allBase?.revenue ?? 0) * scale,
      orders: res.rows.reduce((s, r) => s + r.orders, 0),
      baseClinics: (allBase?.clinics ?? 0) * scale,
      scale,
      total: res.total,
    };
  },
});
