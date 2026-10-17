/**
 * Sales Rep View (Shyam, 2026-09-28) — Today / This week / Scorecard for one
 * rep's book, modelled on "Sales Rep View 1b – Thermometer rail" and the
 * "Sales perf KPIs v2" scorecard. Every number is derived from the same
 * drill() rows the main dashboard uses, so a rep's view reconciles to the
 * rep-filtered tree. KPIs that need data RCA doesn't hold (CRM pipeline,
 * quotas, per-order panel mix, discounts) are returned as `null` with a
 * reason instead of being estimated.
 */
import { v } from "convex/values";
import { drill, matchesFocus, type ClinicRow } from "./clinics";
import { loadCfg } from "./config";
import { newClinicPace } from "./newPace";
import { ACTIVE_COHORTS, calibrate } from "./lifecycle";
import { addDays, diffDays, dow, eachDay, periodDefs, weekStart } from "./dateUtils";
import { scopedQuery } from "./gated";

const EXISTING = new Set(["retained_top20", "retained_rest", "churned"]);
const TENURE_DATA_START = "2025-01-01";
const LOW_AOV = 400;

const sum = (rows: ClinicRow[], f: (r: ClinicRow) => number) =>
  rows.reduce((s, r) => s + f(r), 0);
const since = (cutoff: string, d?: string) =>
  d ? Math.max(0, diffDays(d, cutoff)) : null;

/** Rep-level P75 baseline (same source as geo.scopeTotals): P75 of the rep's
 * own aggregated revenue, not a sum of per-clinic P75s (Shyam, 2026-10-12). */
async function repBaseline(ctx: any, periodId: string, sales: string, gen: number) {
  const row = await ctx.db
    .query("salesPeriodBaseline")
    .withIndex("by_gen_period", (q: any) => q.eq("gen", gen).eq("periodId", periodId))
    .filter((q: any) => q.eq(q.field("sales"), sales))
    .unique();
  return row ? { rev: row.expectedRevenue as number, ord: row.expectedOrders as number } : null;
}

export const book = scopedQuery({
  args: {
    periodId: v.string(),
    sales: v.optional(v.string()),
    /** Call-first health-note filter (2026-09-28 update): narrows the
     * overdue-call list to one health tag; "" / undefined = all tags. */
    health: v.optional(v.string()),
    /** Call-first Portfolio-status filter (2026-09-28 round 3): same idea
     * as `health`, but against ClinicRow.pstatus. "" / undefined = all. */
    pstatus: v.optional(v.string()),
    /** New-clinic "about to fall off" window in days-since-last-order
     * (2026-09-28 round 3): default widened from 10–14 to 14–21, and now
     * rep-adjustable via chips on the page. */
    stuckMin: v.optional(v.number()),
    stuckMax: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const, reason: "pick-rep" };
    const cfg = await loadCfg(ctx);
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      sales: args.sales,
      // Bug fix (Shyam, 2026-09-28): without this, windowOrders defaulted to
      // this-period's order count instead of the clinic's lifetime order
      // count, so the f1..f4 new-clinic funnel (and "stuck" drop-off list)
      // undercounted badly outside the rare period containing every one of
      // a new clinic's orders.
      wantWindowOrders: true,
    });
    if (!cfg || !res.ready) return { ready: false as const, reason: "loading" };
    const cutoff = cfg.currentEnd;
    const rows = res.rows;
    const days = res.days;

    const actual = sum(rows, r => r.actual);
    const rb = await repBaseline(ctx, args.periodId, args.sales, cfg.gen ?? 0);
    const expected = rb ? rb.rev : sum(rows, r => r.expected);
    const orders = sum(rows, r => r.orders);
    const expOrders = rb ? rb.ord : sum(rows, r => r.expectedOrders);
    const active = rows.filter(r => r.orders > 0);

    // Cohorts
    const isNew = (r: ClinicRow) => r.newGroups.length > 0;
    const newRows = rows.filter(isNew);
    const existing = rows.filter(r => EXISTING.has(r.cohort) && r.expected > 0);
    const exAct = sum(existing, r => r.actual);
    const exExp = sum(existing, r => r.expected);
    const exOrd = sum(existing, r => r.orders);
    const exExpOrd = sum(existing, r => r.expectedOrders);
    const newRev = sum(newRows, r => r.actual);
    const newOrd = sum(newRows, r => r.orders);

    // Retention
    const churned = existing.filter(r => r.orders === 0);
    const retainedCap = sum(existing, r => Math.min(r.actual, r.expected));
    const contraction = sum(
      existing.filter(r => r.orders > 0 && r.delta < 0),
      r => -r.delta,
    );
    const revenueChurn = sum(churned, r => r.expected);
    const repeat = active.filter(r => r.orders >= 2);
    const gapDays = repeat.length
      ? repeat.reduce((s, r) => s + days / r.orders, 0) / repeat.length
      : null;
    // At risk (Shyam 2026-10-05): same 5–44 day last-order window as Call first.
    const atRiskRows = existing.filter(
      r => {
        const last = since(cutoff, r.lastOrderAllTime);
        return last !== null && last >= 5 && last < 45;
      },
    ).filter(
      r =>
        r.health.some(h => /slipping|overdue|risk|ghost|drop/i.test(h)) ||
        (r.orders > 0 && r.actual < r.expected * 0.5),
    );
    const dormant = rows.filter(r => {
      const s = since(cutoff, r.lastOrderAllTime);
      return s !== null && s >= 270;
    });

    // Expansion
    const growing = existing.filter(r => r.delta > 0);
    const expansionRev = sum(growing, r => r.delta);
    const bundleUp = existing.filter(
      r => r.orders > 0 && r.bundleShare > r.baseBundleShare + 0.001,
    );

    // AOV
    const bundleOrders = sum(rows, r => r.bundleOrders);
    const lowAov = active.filter(r => r.aov < LOW_AOV);
    const aovGap = active.filter(r => r.baseAov > 0 && r.aov < r.baseAov);
    const aovOpp = sum(aovGap, r => (r.baseAov - r.aov) * r.orders);
    const baseAov = expOrders ? expected / expOrders : 0;

    // Combined
    // Rep-level bridge recomputed from the rep's own baseline (mirrors geo.scopeTotals).
    const volume = (orders - expOrders) * baseAov;
    const aovEffect = actual - expected - volume;
    const atRiskRev = sum(atRiskRows, r => Math.max(0, -r.delta));

    // Reactivated (lifecycle, 2026-10-16): first order before the window, nothing in the baseline, ordering again now.
    // No baseline, so their revenue counts as gain, like new business; the scorecard's New Revenue combines the two.
    const reactivated = rows.filter(r => r.cohort === "reactivated" && r.orders > 0);
    const reactivatedRev = sum(reactivated, r => r.actual);

    // Tenure cut (by first-order year) of the retention / expansion numbers: all, before the data starts
    // (2025), the years in between, and this year's signups. Same formulas as the whole-book KPIs, on a subset.
    const curYear = cutoff.slice(0, 4);
    const tenureOf = (r: ClinicRow): "pre" | "mid" | "cur" => {
      const fo = r.firstOrder ?? "";
      if (!fo || fo < TENURE_DATA_START) return "pre";
      return fo.slice(0, 4) === curYear ? "cur" : "mid";
    };
    const ids = (rs: ClinicRow[]) => rs.map(r => r.clinic);
    const tenureKpis = (pick: (r: ClinicRow) => boolean) => {
      const ex = existing.filter(pick);
      const act = active.filter(pick);
      const exA = sum(ex, r => r.actual);
      const exE = sum(ex, r => r.expected);
      const ch = ex.filter(r => r.orders === 0);
      const gr = ex.filter(r => r.delta > 0);
      const rp = act.filter(r => r.orders >= 2);
      const risk = atRiskRows.filter(pick);
      return {
        existingCount: ex.length, existingIds: ids(ex), existingRevenue: exA, existingBaseline: exE,
        revenueRetention: exE ? sum(ex, r => Math.min(r.actual, r.expected)) / exE : null,
        nrr: exE ? exA / exE : null,
        expansionRev: sum(gr, r => r.delta), growing: gr.length, growingIds: ids(gr),
        churned: ch.length, churnedIds: ids(ch), churnRate: ex.length ? ch.length / ex.length : null,
        repeatRate: act.length ? rp.length / act.length : null, repeatCount: rp.length, activeCount: act.length, repeatIds: ids(rp), activeIds: ids(act),
        atRisk: risk.length, atRiskRev: sum(risk, r => Math.max(0, -r.delta)), atRiskIds: ids(risk),
      };
    };
    const tenure = {
      all: tenureKpis(() => true),
      pre: tenureKpis(r => tenureOf(r) === "pre"),
      mid: tenureKpis(r => tenureOf(r) === "mid"),
      cur: tenureKpis(r => tenureOf(r) === "cur"),
      year: curYear,
    };

    // Early-life retention: of this year's signups that already had their first order before this window started,
    // how many ordered in it. Counted from clinicMeta (rows drop clinics with no orders and no baseline, which are
    // exactly the ones that were lost).
    const defsForWindow = cfg ? periodDefs(cfg.currentStart, cfg.currentEnd) : [];
    const windowStart = defsForWindow.find(d => d.id === args.periodId)?.days[0] ?? cfg?.currentStart ?? "";
    const metaForRep = cfg
      ? await ctx.db
          .query("clinicMeta")
          .withIndex("by_gen_sales", q => q.eq("gen", cfg.gen ?? 0).eq("sales", args.sales!))
          .collect()
      : [];
    const earlyBase = metaForRep.filter(m => m.firstOrder && m.firstOrder >= `${curYear}-01-01` && m.firstOrder < windowStart);
    const orderedNow = new Set(rows.filter(r => r.orders > 0).map(r => r.clinic));
    const earlyKept = earlyBase.filter(m => orderedNow.has(m.clinic));
    const earlyLife = {
      year: curYear,
      base: earlyBase.length,
      kept: earlyKept.length,
      rate: earlyBase.length ? earlyKept.length / earlyBase.length : null,
      baseIds: earlyBase.map(m => m.clinic),
      keptIds: earlyKept.map(m => m.clinic),
      // The ones that stopped, with the little we hold about them (they are not in the clinic table).
      lost: earlyBase
        .filter(m => !orderedNow.has(m.clinic))
        .sort((a, b) => (b.lastOrderAllTime ?? "").localeCompare(a.lastOrderAllTime ?? ""))
        .slice(0, 200)
        .map(m => ({ clinic: m.clinic, name: m.name, state: m.state, firstOrder: m.firstOrder ?? null, lastOrder: m.lastOrderAllTime ?? null })),
    };

    // New clinic funnel (same membership rules as the dashboard's New Clinics card)
    const stage = (k: string) => rows.filter(r => matchesFocus(r, `newgrp:${k}`));
    const f = { f1: stage("f1"), f2: stage("f2"), f3: stage("f3"), f4: stage("f4") };
    // Getting-to-order-4 progression window (Shyam, 2026-09-28): ideal pace
    // between orders is 10–14 days, so the "about to fall off" list is
    // clinics whose gap since their last order sits in that window — not
    // clinics already long overdue (those surface in Call first instead).
    // Precedence order 4 → order 1: a clinic one order away from order 4
    // outranks one only just past order 1, regardless of $.
    const dropStage = (k: string, reached: number) =>
      stage(k).map(r => ({ r, reached }));
    const stuckMin = args.stuckMin ?? 14;
    const stuckMax = args.stuckMax ?? 21;
    const stuckAll = [
      ...dropStage("f4drop", 3),
      ...dropStage("f3drop", 2),
      ...dropStage("f2drop", 1),
    ]
      .map(({ r, reached }) => ({
        clinic: r.clinic,
        name: r.name,
        state: r.state,
        orders: r.windowOrders,
        reached,
        daysSinceFirst: since(cutoff, r.firstOrder),
        daysSinceLast: since(cutoff, r.lastOrderAllTime),
        daysSinceTouch: since(cutoff, r.lastTouchDate),
      }))
      .filter(s => s.daysSinceLast !== null && s.daysSinceLast >= stuckMin && s.daysSinceLast <= stuckMax);
    const stuck = stuckAll
      .sort((a, b) => b.reached - a.reached || (b.daysSinceLast ?? 0) - (a.daysSinceLast ?? 0))
      .slice(0, 12);

    // Call-first: clinics whose gap since their last order sits between 5
    // and 45 days (2026-09-28: fixed window, not a cadence multiple — beyond
    // 45 days a clinic is treated as lost and drops off this list). Ranked
    // by dollars at stake first, days overdue second. Optional health-note
    // filter narrows to one tag for a targeted call list.
    const healthTags = [...new Set(existing.flatMap(r => r.health))].sort();
    const pstatusTags = [...new Set(existing.flatMap(r => r.pstatus))].sort();
    const callFirstPool = existing
      .map(r => {
        const every = r.baseOrdersPerDay ? Math.max(1, 1 / r.baseOrdersPerDay) : null;
        const last = since(cutoff, r.lastOrderAllTime);
        return { r, every, last };
      })
      .filter(x => x.last !== null && x.last >= 5 && x.last < 45)
      .filter(x => !args.health || x.r.health.includes(args.health))
      .filter(x => !args.pstatus || x.r.pstatus.includes(args.pstatus));
    // Chip counts (Shyam 2026-09-30): clinics in the 5–44 day window per tag,
    // cross-filtered by the other active chip row.
    const inWin = existing.filter(r => {
      const last = since(cutoff, r.lastOrderAllTime);
      return last !== null && last >= 5 && last < 45;
    });
    const healthCounts: Record<string, number> = {};
    for (const r of inWin)
      if (!args.pstatus || r.pstatus.includes(args.pstatus))
        for (const h of new Set(r.health)) healthCounts[h] = (healthCounts[h] ?? 0) + 1;
    const pstatusCounts: Record<string, number> = {};
    for (const r of inWin)
      if (!args.health || r.health.includes(args.health))
        for (const p of new Set(r.pstatus)) pstatusCounts[p] = (pstatusCounts[p] ?? 0) + 1;
    const callFirst = callFirstPool
      .sort((a, b) => b.r.expected - a.r.expected || (b.last ?? 0) - (a.last ?? 0))
      .slice(0, 12)
      .map(x => ({
        clinic: x.r.clinic,
        name: x.r.name,
        state: x.r.state,
        every: x.every ? Math.round(x.every) : null,
        daysSinceLast: x.last,
        daysSinceTouch: since(cutoff, x.r.lastTouchDate),
        delta: x.r.delta,
        expected: x.r.expected,
        tag:
          x.r.health.find(h => !/high ticket/i.test(h)) ??
          ((x.last ?? 0) >= 21 ? "Gone quiet" : "Buying overdue"),
      }));
    const overdueCount = callFirstPool.length;

    // Effort: touched in the last 14 days vs reordered after that touch.
    const t14 = addDays(cutoff, -13);
    const withOrders = existing.concat(newRows);
    const touched = withOrders.filter(r => r.lastTouchDate && r.lastTouchDate >= t14);
    const touchedRe = touched.filter(
      r => r.lastOrderAllTime && r.lastOrderAllTime >= (r.lastTouchDate as string),
    );
    const untouched = withOrders.filter(r => !r.lastTouchDate || r.lastTouchDate < t14);
    const untouchedRe = untouched.filter(r => r.lastOrderAllTime && r.lastOrderAllTime >= t14);

    // Touch-effort KPIs per calendar window (Shyam, 2026-09-30, Today KPI
    // strip): touched = last call/meeting on/after window start; touched
    // reorder = ordered on/after that touch; untouched = no call/meeting in
    // window; untouched reorder = ordered in window anyway; idle = untouched
    // and no order in window; lift = touched rate − untouched rate.
    const effortFor = (start: string) => {
      const t = withOrders.filter(r => r.lastTouchDate && r.lastTouchDate >= start);
      const tRe = t.filter(r => r.lastOrderAllTime && r.lastOrderAllTime >= (r.lastTouchDate as string));
      const u = withOrders.filter(r => !r.lastTouchDate || r.lastTouchDate < start);
      const uRe = u.filter(r => r.lastOrderAllTime && r.lastOrderAllTime >= start);
      const idle = u.filter(r => !r.lastOrderAllTime || r.lastOrderAllTime < start);
      return {
        start, touched: t.length, touchedRe: tRe.length, untouched: u.length, untouchedRe: uRe.length,
        idle: idle.length,
        touchedIds: t.map(r => r.clinic), touchedReIds: tRe.map(r => r.clinic),
        untouchedIds: u.map(r => r.clinic), idleIds: idle.map(r => r.clinic),
        // days from last touch to the order after it (null = no order since touch)
        touchGaps: t.map(r => (r.lastOrderAllTime && r.lastOrderAllTime >= (r.lastTouchDate as string))
          ? Math.round((Date.parse(r.lastOrderAllTime) - Date.parse(r.lastTouchDate as string)) / 864e5) : null),
      };
    };
    const mStart = `${cutoff.slice(0, 8)}01`;
    const qm = Math.floor((Number(cutoff.slice(5, 7)) - 1) / 3) * 3 + 1;
    const effortWin = {
      week: effortFor(weekStart(cutoff)),
      month: effortFor(mStart),
      quarter: effortFor(`${cutoff.slice(0, 4)}-${String(qm).padStart(2, "0")}-01`),
    };

    // Lens cuts for "This week"
    const byCohort = new Map<
      string,
      { n: number; d: number; a: number; e: number; b: number; posSum: number; posCount: number; posIds: string[]; negSum: number; negCount: number; negIds: string[] }
    >();
    const byState = new Map<string, number>();
    for (const r of rows) {
      const c = byCohort.get(r.cohort) ?? {
        n: 0,
        d: 0,
        a: 0,
        e: 0,
        b: 0,
        posSum: 0,
        posCount: 0,
        posIds: [] as string[],
        negSum: 0,
        negCount: 0,
        negIds: [] as string[],
      };
      c.n++;
      c.d += r.delta;
      c.a += r.actual;
      c.e += r.expected;
      c.b += r.baseline;
      if (r.delta >= 0) {
        c.posSum += r.delta;
        c.posCount++;
        c.posIds.push(r.clinic);
      } else {
        c.negSum += -r.delta;
        c.negCount++;
        c.negIds.push(r.clinic);
      }
      byCohort.set(r.cohort, c);
      byState.set(r.state || "—", (byState.get(r.state || "—") ?? 0) + r.delta);
    }
    // "New" cohort re-split (Shyam, 2026-09-29): a brand-new clinic has no
    // order history to compute a baseline from, so the generic beating/
    // missing-baseline delta split above is meaningless for it (expected is
    // ~0, so it always reads as "beating"). Re-split "new" using the
    // cohort's own order cadence instead: median days between a new
    // clinic's own orders this window is the pace threshold; a clinic whose
    // days-since-its-last-order is within that pace is contributing
    // positively (on pace), one that has drifted past it is missing its
    // order window (negatively). $ shown is actual revenue delivered, not
    // a delta against a baseline that doesn't exist yet.
    const newCohort = byCohort.get("new");
    if (newCohort) {
      const { onPace } = newClinicPace(newRows, cutoff);
      const reset = {
        n: newCohort.n,
        d: newCohort.d,
        a: newCohort.a,
        e: newCohort.e,
        b: newCohort.b,
        posSum: 0,
        posCount: 0,
        posIds: [] as string[],
        negSum: 0,
        negCount: 0,
        negIds: [] as string[],
      };
      for (const r of newRows) {
        if (onPace.has(r.clinic)) {
          reset.posSum += r.actual;
          reset.posCount++;
          reset.posIds.push(r.clinic);
        } else {
          reset.negSum += r.actual;
          reset.negCount++;
          reset.negIds.push(r.clinic);
        }
      }
      byCohort.set("new", reset);
    }
    const cohortRows = [...byCohort];
    const cohortCal = calibrate(cohortRows.map(([k, c]) => ({ cohort: k, actual: c.a, expected: c.e, clinics: c.n })), expected);
    const states = [...byState].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    // Top clinics by baseline for the weekly-target editor
    const targetClinics = [...rows]
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 10)
      .map(r => ({
        clinic: r.clinic,
        name: r.name,
        baseWeek: sum([r], x => (x.rateDow ?? []).reduce((a, b) => a + b, 0)),
        baseOrdWeek: (r.baseOrdersPerDay ?? 0) * 7,
      }));

    // Opportunity agenda (Shyam, 2026-10-05): the scorecard's Opportunity
    // column turned into today's work — count, $ upside and a few names.
    const top = (rs: ClinicRow[], f: (r: ClinicRow) => number) =>
      [...rs].sort((a, b) => f(b) - f(a)).slice(0, 4).map(r => ({ clinic: r.clinic, name: r.name, v: f(r) }));
    const lowUp = (r: ClinicRow) => Math.max(0, LOW_AOV - r.aov) * r.orders;
    const cfUp = (r: ClinicRow) => Math.max(0, r.expected - r.actual);
    const newAovV = newOrd ? newRev / newOrd : actual && orders ? actual / orders : 0;
    const opp = {
      atRisk: { n: atRiskRows.length, up: atRiskRev, names: top(atRiskRows, r => Math.max(0, -r.delta)), ids: atRiskRows.map(r => r.clinic) },
      lowAov: { n: lowAov.length, up: sum(lowAov, lowUp), names: top(lowAov, lowUp), ids: lowAov.map(r => r.clinic) },
      callFirst: { n: callFirstPool.length, up: callFirstPool.reduce((s, x) => s + cfUp(x.r), 0), ids: callFirstPool.map(x => x.r.clinic) },
      nurture: { n: stuckAll.length, up: stuckAll.length * newAovV, ids: stuckAll.map(x => x.clinic) },
      growing: { n: growing.length, up: expansionRev, ids: growing.map(r => r.clinic) },
    };

    return {
      ready: true as const,
      cutoff,
      opp,
      newIds: newRows.map(r => r.clinic),
      days,
      clinics: rows.length,
      totals: {
        actual,
        expected,
        delta: actual - expected,
        // Baseline = the book's mean run rate; real change = actual - baseline; ambition = goal (expected) - baseline.
        baseline: sum(rows, r => r.baseline),
        realChange: actual - sum(rows, r => r.baseline),
        ambition: expected - sum(rows, r => r.baseline),
        orders,
        expOrders,
      },
      funnel: {
        o1: f.f1.length,
        o2: f.f2.length,
        o3: f.f3.length,
        o4: f.f4.length,
        ids: [f.f1, f.f2, f.f3, f.f4].map(x => x.map(r => r.clinic)),
      },
      activeIds: active.map(r => r.clinic),
      reactivatedIds: reactivated.map(r => r.clinic),
      tenure,
      earlyLife,
      existingIds: existing.map(r => r.clinic),
      allIds: rows.filter(r => r.orders > 0 || r.expected > 0).map(r => r.clinic),
      oppIds: [...new Set([...atRiskRows, ...aovGap].map(r => r.clinic))],
      stuck,
      stuckMin,
      stuckMax,
      callFirst,
      overdueCount,
      healthTags,
      pstatusTags,
      healthCounts: Object.entries(healthCounts),
      pstatusCounts: Object.entries(pstatusCounts),
      effortWin,
      effort: {
        touched: touched.length,
        touchedRe: touchedRe.length,
        untouched: untouched.length,
        untouchedRe: untouchedRe.length,
      },
      lenses: {
        volume,
        aovEffect,
        bundle: sum(rows, r => r.bundleDelta),
        nonBundle: sum(rows, r => r.nonBundleDelta),
        cohorts: cohortRows.map(([k, c]) => ({
          key: k,
          clinics: c.n,
          // calibrated to the rep's headline baseline so the rows add up to the book delta (analytics/lifecycle.ts)
          delta: c.a - c.e * cohortCal.factor,
          // real change (actual - baseline) and ambition (goal - baseline) behind that delta
          real: c.a - c.b,
          ambition: c.e * cohortCal.factor - c.b,
          posSum: c.posSum,
          posCount: c.posCount,
          posIds: c.posIds,
          negSum: c.negSum,
          negCount: c.negCount,
          negIds: c.negIds,
        })),
        cohortCalibration: cohortCal.factor,
        states: states.slice(0, 4).map(([k, d]) => ({ key: k, delta: d })),
      },
      targetClinics,
      kpi: {
        newRevenue: newRev,
        reactivatedRevenue: reactivatedRev,
        reactivatedCount: reactivated.length,
        newCustomers: newRows.length,
        newOrders: newOrd,
        newAov: newOrd ? newRev / newOrd : null,
        newRevShare: actual ? newRev / actual : null,
        o1to2: f.f1.length ? f.f2.length / f.f1.length : null,
        aov: orders ? actual / orders : null,
        baseAov,
        existingAov: exOrd ? exAct / exOrd : null,
        existingBaseAov: exExpOrd ? exExp / exExpOrd : null,
        bundlePen: orders ? bundleOrders / orders : null,
        lowAov: lowAov.length,
        aovOpp,
        ordersPerCustomer: active.length ? orders / active.length : null,
        revenueRetention: exExp ? retainedCap / exExp : null,
        customerRetention: existing.length ? (existing.length - churned.length) / existing.length : null,
        churnRate: existing.length ? churned.length / existing.length : null,
        churned: churned.length,
        churnedIds: churned.map(r => r.clinic),
        existingCount: existing.length,
        revenueChurn,
        contraction,
        repeatRate: active.length ? repeat.length / active.length : null,
        repeatCount: repeat.length,
        repeatIds: repeat.map(r => r.clinic),
        activeCount: active.length,
        daysBetweenOrders: gapDays,
        atRisk: atRiskRows.length,
        atRiskRev,
        dormant: dormant.length,
        expansionRev,
        growing: growing.length,
        expansionRate: existing.length ? growing.length / existing.length : null,
        bundleUp: bundleUp.length,
        existingRevenue: exAct,
        existingBaseline: exExp,
        nrr: exExp ? exAct / exExp : null,
        existingGrowth: exExp ? exAct / exExp - 1 : null,
        netGrowth: expected ? actual / expected - 1 : null,
        runRate: days ? (actual / days) * 7 : null,
        runRatePlan: days ? (expected / days) * 7 : null,
        opportunity: atRiskRev + aovOpp,
        volume,
        aovEffect,
      },
    };
  },
});

/** Full calendar span of a periodId, INCLUDING days that haven't happened
 * yet (unlike clinics.ts's own `periodDays`, which clips to currentEnd) —
 * needed so week/month can tell "elapsed so far" from "days left" instead of
 * a window pinned to whatever's already happened. */
function fullPeriodSpan(periodId: string): string[] | null {
  const [kind, key] = periodId.split(":");
  if (kind === "d") return [key];
  if (kind === "w") return eachDay(key, addDays(key, 6));
  if (kind === "m") {
    const [y, m] = key.split("-").map(Number);
    const first = `${key}-01`;
    const lastDayNum = new Date(y, m, 0).getDate();
    const last = `${key}-${String(lastDayNum).padStart(2, "0")}`;
    return eachDay(first, last);
  }
  if (kind === "q") {
    const [qy, qq] = key.split("-Q");
    const startMonth = (Number(qq) - 1) * 3 + 1;
    const first = `${qy}-${String(startMonth).padStart(2, "0")}-01`;
    const lastMonth = startMonth + 2;
    const lastDayNum = new Date(Number(qy), lastMonth, 0).getDate();
    const last = `${qy}-${String(lastMonth).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
    return eachDay(first, last);
  }
  return null; // "all" / whatever the outer page's custom window resolves to
}

/** Pace for the thermometer, adapted to whatever window the rep has open
 * (Shyam, 2026-09-28 round 5) — was hardcoded to "this week"; now: so far /
 * heading-to / plan for Today/This week/This month/Custom alike. The
 * rep's own weekly clinic targets (`clinicPlan`) only make sense as a week
 * override, so they're applied for the week window and pro-rated by the
 * window's own day count for day/month/custom (day = 1/7th, month = full
 * calendar days / 7, custom = whatever's elapsed / 7) instead of guessing
 * a different target grain that doesn't exist in the data model. */
export const pace = scopedQuery({
  args: { periodId: v.string(), sales: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const };
    const cfg = await loadCfg(ctx);
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      sales: args.sales,
    });
    if (!cfg || !res.ready) return { ready: false as const };
    const span = fullPeriodSpan(args.periodId) ?? eachDay(cfg.currentStart, cfg.currentEnd);
    const elapsed = span.filter(d => d >= cfg.currentStart && d <= cfg.currentEnd);
    const remaining = span.filter(d => d > cfg.currentEnd);
    const plans = await ctx.db.query("clinicPlan").collect();
    const planBy = new Map(plans.map(p => [p.clinic, p.targetRevenueWeek]));
    const planScale = span.length / 7;
    let soFar = 0;
    let expSoFar = 0;
    let expRest = 0;
    let plan = 0;
    let planned = 0;
    let fullP75 = 0;
    for (const r of res.rows) {
      soFar += r.actual;
      expSoFar += r.expected;
      const rate = r.rateDow ?? [0, 0, 0, 0, 0, 0, 0];
      // Rescale the static weekday shape to this clinic's allocated rolling
      // P75 (r.expected) so the gauge plan matches the overall P75 plan.
      const elapsedRate = elapsed.reduce((s, d) => s + rate[dow(d)], 0);
      const k = elapsedRate > 0 ? r.expected / elapsedRate : 1;
      const rest = k * remaining.reduce((s, d) => s + rate[dow(d)], 0);
      expRest += rest;
      const full = k * span.reduce((s, d) => s + rate[dow(d)], 0);
      const p = planBy.get(r.clinic);
      if (p && p > 0) {
        plan += p * planScale;
        planned++;
      } else {
        plan += full;
        fullP75 += full;
      }
    }
    // Heading-to: this window's pace vs baseline so far, applied to the days left.
    // Clamped to soFar (Shyam, 2026-09-28): a negative expRest/paceRatio edge
    // case — refunds pulling soFar or expSoFar below zero — could otherwise
    // project a heading total below what's already booked, which the
    // thermometer can't render sensibly (booked can't un-book itself).
    // Rescale per-clinic sums to the rep-level P75 (2026-10-12).
    const rb = args.sales ? await repBaseline(ctx, args.periodId, args.sales, cfg.gen ?? 0) : null;
    if (rb && expSoFar > 0) {
      const sc = rb.rev / expSoFar;
      expRest *= sc;
      plan += fullP75 * (sc - 1); // only P75-derived plan scales; clinicPlan targets kept
      expSoFar = rb.rev;
    }
    const paceRatio = expSoFar ? soFar / expSoFar : 1;
    const heading = Math.max(soFar, soFar + expRest * paceRatio);
    return {
      ready: true as const,
      periodId: args.periodId,
      elapsedDays: elapsed.length,
      remainingDays: remaining.length,
      firstDay: elapsed[0] ?? null,
      lastDay: elapsed[elapsed.length - 1] ?? null,
      soFar,
      expSoFar,
      heading,
      plan,
      planned,
      needPerDay: remaining.length ? Math.max(0, plan - soFar) / remaining.length : 0,
    };
  },
});

/** Full metrics for one clinic in one rep's book (2026-09-28) — backs the
 * clinic-card click-through so a rep can see everything the clinic list
 * knows about a name they clicked from Call first / the new-clinic funnel. */
export const clinicDetail = scopedQuery({
  args: { periodId: v.string(), sales: v.optional(v.string()), clinic: v.string() },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const };
    const cfg = await loadCfg(ctx);
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      sales: args.sales,
    });
    if (!cfg || !res.ready) return { ready: false as const };
    const r = res.rows.find(row => row.clinic === args.clinic);
    if (!r) return { ready: false as const, reason: "not-in-book" };
    const cutoff = cfg.currentEnd;
    // New clinics often have no orders inside a short window (e.g. today),
    // leaving orders/AOV/portfolio blank. Fall back to the full dashboard
    // window so the card still shows what the clinic has ordered (Shyam 2026-09-30).
    let fallback: null | { periodId: string; start: string; end: string; orders: number; actual: number; aov: number | null; bundleShare: number | null } = null;
    if (!r.windowOrders && args.periodId !== "all") {
      const all = await drill(ctx, { periodId: "all", lens: "total", unlimited: true, sales: args.sales });
      const a = all.ready ? all.rows.find(row => row.clinic === args.clinic) : undefined;
      if (a && a.windowOrders)
        fallback = { periodId: "all", start: cfg.currentStart, end: cfg.currentEnd, orders: a.windowOrders, actual: a.actual, aov: a.aov ?? null, bundleShare: a.bundleShare ?? null };
    }
    return {
      ready: true as const,
      fallback,
      clinic: r.clinic,
      name: r.name,
      state: r.state,
      country: r.country,
      cohort: r.cohort,
      health: r.health,
      pstatus: r.pstatus,
      actual: r.actual,
      expected: r.expected,
      baseline: r.baseline,
      realChange: r.realChange,
      ambition: r.ambition,
      delta: r.delta,
      orders: r.orders,
      expectedOrders: r.expectedOrders,
      windowOrders: r.windowOrders,
      aov: r.aov,
      baseAov: r.baseAov,
      bundleShare: r.bundleShare,
      baseBundleShare: r.baseBundleShare,
      bundleOrders: r.bundleOrders,
      volume: r.volume,
      aovEffect: r.aovEffect,
      newGroups: r.newGroups,
      firstOrder: r.firstOrder ?? null,
      lastOrderAllTime: r.lastOrderAllTime ?? null,
      lastTouchDate: r.lastTouchDate ?? null,
      daysSinceLast: since(cutoff, r.lastOrderAllTime),
      daysSinceTouch: since(cutoff, r.lastTouchDate),
      daysSinceFirst: since(cutoff, r.firstOrder),
    };
  },
});

/** Clinic rows behind one branch of the "This week" shortfall tree
 * (2026-09-28) — cohort:/state: on top of matchesFocus's built-ins, plus
 * the four lens signs, so every tree branch a rep clicks opens the same
 * clinic list the number was built from. */
export const rowsByFocus = scopedQuery({
  args: { periodId: v.string(), sales: v.optional(v.string()), focus: v.string() },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const, rows: [] };
    const cfg = await loadCfg(ctx);
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      sales: args.sales,
    });
    if (!cfg || !res.ready) return { ready: false as const, rows: [] };
    const focus = args.focus;
    let rows = res.rows;
    if (focus.startsWith("cohort:")) {
      const k = focus.slice(7);
      rows = rows.filter(r => (k === "active" ? (ACTIVE_COHORTS as readonly string[]).includes(r.cohort) : r.cohort === k));
    } else if (focus.startsWith("state:")) {
      const k = focus.slice(6);
      rows = rows.filter(r => (r.state || "—") === k);
    } else if (focus === "volpos") rows = rows.filter(r => r.volume > 0);
    else if (focus === "volneg") rows = rows.filter(r => r.volume < 0);
    else if (focus === "aovpos") rows = rows.filter(r => r.aovEffect > 0);
    else if (focus === "aovneg") rows = rows.filter(r => r.aovEffect < 0);
    else if (focus === "bundlepos") rows = rows.filter(r => r.bundleDelta > 0);
    else if (focus === "bundleneg") rows = rows.filter(r => r.bundleDelta < 0);
    else if (focus === "nonbundlepos") rows = rows.filter(r => r.nonBundleDelta > 0);
    else if (focus === "nonbundleneg") rows = rows.filter(r => r.nonBundleDelta < 0);
    else if (focus) rows = rows.filter(r => matchesFocus(r, focus));
    const sorted = [...rows].sort((a, b) => a.delta - b.delta);
    const cutoff = cfg.currentEnd;
    return {
      ready: true as const,
      rows: sorted.map((r, i) => ({
        rank: i + 1,
        clinic: r.clinic,
        name: r.name,
        state: r.state,
        country: r.country,
        cohort: r.cohort,
        health: r.health,
        pstatus: r.pstatus,
        actual: r.actual,
        expected: r.expected,
        baseline: r.baseline,
        realChange: r.realChange,
        ambition: r.ambition,
        delta: r.delta,
        orders: r.orders,
        expectedOrders: r.expectedOrders,
        orderDelta: r.orders - r.expectedOrders,
        aov: r.aov,
        baseAov: r.baseAov,
        aovDelta: r.aov - r.baseAov,
        bundleShare: r.bundleShare,
        baseBundleShare: r.baseBundleShare,
        bundleDelta: r.bundleShare - r.baseBundleShare,
        windowOrders: r.windowOrders,
        volume: r.volume,
        aovEffect: r.aovEffect,
        firstOrder: r.firstOrder ?? null,
        lastOrderAllTime: r.lastOrderAllTime ?? null,
        lastTouchDate: r.lastTouchDate ?? null,
        daysSinceLast: since(cutoff, r.lastOrderAllTime),
        daysSinceTouch: since(cutoff, r.lastTouchDate),
      })),
    };
  },
});


/**
 * Team average for the Today touch-KPI strip (Shyam, 2026-09-30): same
 * effort math as `book.effortWin`, computed per rep across every rep under
 * the selected rep's team lead, then averaged rep-by-rep (each rep weighted
 * equally). `within` = optional "ordered within X days of touch" filter.
 */
export const teamEffort = scopedQuery({
  args: { periodId: v.string(), sales: v.optional(v.string()), start: v.string(), within: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const };
    const mine = await drill(ctx, { periodId: args.periodId, lens: "total", unlimited: true, sales: args.sales });
    if (!mine.ready) return { ready: false as const };
    const lead = mine.rows.find(r => r.teamLead && r.teamLead !== "—")?.teamLead;
    if (!lead) return { ready: true as const, lead: null, reps: 0 };
    const res = await drill(ctx, { periodId: args.periodId, lens: "total", unlimited: true, teamLead: lead });
    if (!res.ready) return { ready: false as const };
    const byRep = new Map<string, ClinicRow[]>();
    for (const r of res.rows) {
      const n = (r.sales ?? "").trim();
      if (!n || n === "—") continue;
      (byRep.get(n) ?? byRep.set(n, []).get(n)!).push(r);
    }
    const s = args.start, W = args.within ?? 0;
    const per = [...byRep.values()].map(rows => {
      const wo = rows.filter(r => r.newGroups.length > 0 || (EXISTING.has(r.cohort) && r.expected > 0));
      const t = wo.filter(r => r.lastTouchDate && r.lastTouchDate >= s);
      const tRe = t.filter(r => {
        if (!r.lastOrderAllTime || r.lastOrderAllTime < (r.lastTouchDate as string)) return false;
        return !W || diffDays(r.lastTouchDate as string, r.lastOrderAllTime) <= W;
      });
      const u = wo.filter(r => !r.lastTouchDate || r.lastTouchDate < s);
      const uRe = u.filter(r => r.lastOrderAllTime && r.lastOrderAllTime >= s);
      const idle = u.length - uRe.length;
      const tr = t.length ? tRe.length / t.length : 0, ur = u.length ? uRe.length / u.length : 0;
      return { touched: t.length, tr, untouched: u.length, ur, lift: (tr - ur) * 100, idle };
    }).filter(p => p.touched + p.untouched > 0);
    const n = per.length || 1;
    const avg = (f: (p: (typeof per)[number]) => number) => per.reduce((a, p) => a + f(p), 0) / n;
    return {
      ready: true as const, lead, reps: per.length,
      touched: avg(p => p.touched), tr: avg(p => p.tr), untouched: avg(p => p.untouched),
      ur: avg(p => p.ur), lift: avg(p => p.lift), idle: avg(p => p.idle),
    };
  },
});
