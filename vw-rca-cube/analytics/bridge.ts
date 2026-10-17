import { geoKeyOf } from "./geoKey";
import { loadCfg } from "./config";
import { calibrate } from "./lifecycle";
import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  BASELINE_LABEL,
  type BaselineMode,
  bucketing,
  dayCountsOf,
  dayType,
  dow,
  eachDay,
  holidayName,
  isoDow,
  monthKey,
  monthLabel,
  type P75Factors,
  p75Scale,
  quarterKey,
  quarterLabel,
  ratesFrom,
  shortDayLabel,
  trailingDayP75,
  anchoredDayP75,
  trailingMonthP75,
  trailingWeekP75,
  weekStart,
} from "./dateUtils";
import { scopedQuery } from "./gated";

type Row = {
  clinics?: number;
  label: string;
  sub: string;
  value: number;
  lens: string;
  key: string;
  /** "patients" rows carry a headcount, not dollars, and are read on their
   * own scale rather than as a share of the revenue gap. */
  unit?: "patients";
  /** Reference value the unit row is measured against (expected patients). */
  base?: number;
};
export type FamilyRow = {
  family: string;
  revenue: number; // actual revenue in the period
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number; // revenue shortfall vs baseline
  orderDelta: number;
};
export type Period = {
  id: string;
  kind: "all" | "quarter" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  days: number;
  partial?: boolean;
  holiday: string | null;
  actual: number;
  expected: number;
  delta: number;
  orders: number;
  expectedOrders: number;
  aov: number;
  baseAov: number;
  /** Distinct patients per day, summed over the period. */
  patients: number;
  expectedPatients: number;
  families: FamilyRow[];
  familiesBundle: FamilyRow[];
  familiesNonBundle: FamilyRow[];
  lensA: Row[];
  lensB: Row[];
  lensC: Row[];
  /** Factor the cohort rows' expected was scaled by so they sum to the headline delta. */
  cohortCalibration?: number;
  lensD: Row[];
  topStates: Array<{ state: string; value: number }>;
};

const COHORT_LABEL: Record<string, string> = {
  churned: "Churned clinics",
  new: "New clinics",
  retained_top20: "Active — top 20%",
  retained_rest: "Active — remaining 80%",
  reactivated: "Reactivated clinics",
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

async function computeBridge(ctx: QueryCtx) {
  const cfg = await loadCfg(ctx);
  // Every fact table is versioned by refresh generation; only read the current
  // one so a running refresh's half-written rows are never mixed in.
  const gen = cfg?.gen ?? 0;
  const daily = await ctx.db
    .query("dailyTotals")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const lastRefresh = await ctx.db
    .query("refreshLog")
    .withIndex("by_scope_started", q => q.eq("scope", undefined))
    .order("desc")
    .first();

  if (!cfg || daily.length === 0) {
    return { ready: false as const, config: cfg, lastRefresh, periods: [] };
  }

  const stateDaily = await ctx.db
    .query("stateDaily")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const stateBaseline = await ctx.db
    .query("stateBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  // Top-down geo plan [Shyam, 2026-10-12]: lens D state chart uses the same
  // overall → state allocation as the tree/rep views.
  const rawGeoMap: Record<string, string> = {};
  const geoAllocBy = new Map<string, Array<{ geo: string; expectedRevenue: number; actualRevenue: number }>>();
  const cohortDaily = await ctx.db
    .query("cohortDaily")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const cohortBaseline = await ctx.db
    .query("cohortBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();

  // Mid-refresh the tables are cleared one by one; without every supporting
  // table the lenses would come back empty and the UI would read row[0] of an
  // empty array. Report "not ready" instead.
  if (cohortBaseline.length === 0 || stateBaseline.length === 0) {
    return { ready: false as const, config: cfg, lastRefresh, periods: [] };
  }
  const familyBaseline = await ctx.db
    .query("familyBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const familyPeriod = await ctx.db
    .query("familyPeriod")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const familyActual = new Map<
    string,
    Map<string, { revenue: number; orders: number }>
  >();
  for (const r of familyPeriod) {
    // Keyed by scope so the product-mix branch can show a bundle-only list.
    const key = `${r.scope ?? "all"}|${r.family}`;
    const m =
      familyActual.get(r.periodId) ??
      new Map<string, { revenue: number; orders: number }>();
    m.set(key, { revenue: r.revenue, orders: r.orders });
    familyActual.set(r.periodId, m);
  }

  const byDate = new Map(daily.map(d => [d.date, d]));

  // ---------- baseline rates (per weekday, bucketed by the chosen mode) ----------
  const mode = (cfg.baselineMode ?? "prior_equal") as BaselineMode;
  // In P75 mode every expected value is the mean run rate lifted by a
  // granularity-specific P75 multiplier (day / week / month).
  const p75f: P75Factors | null =
    mode === "p75" ? ((cfg.p75 as P75Factors | undefined) ?? null) : null;
  const bucket = bucketing(mode);
  const baseDays = eachDay(cfg.baselineStart, cfg.baselineEnd);
  const baseCounts = dayCountsOf(baseDays);
  const nWk = baseDays.filter(d => dayType(d) === "wk").length;
  const nWe = baseDays.length - nWk;
  const totals = {
    all: [0, 0, 0, 0, 0, 0, 0],
    bundle: [0, 0, 0, 0, 0, 0, 0],
    nonBundle: [0, 0, 0, 0, 0, 0, 0],
    patients: [0, 0, 0, 0, 0, 0, 0],
  };
  const acc = { rev: 0, bRev: 0, ord: 0, bOrdTot: 0, pat: 0 };
  for (const d of baseDays) {
    const r = byDate.get(d);
    if (!r) continue;
    const i = dow(d);
    totals.all[i] += r.orders;
    totals.bundle[i] += r.bundleOrders;
    totals.nonBundle[i] += r.orders - r.bundleOrders;
    totals.patients[i] += r.patients ?? 0;
    acc.rev += r.revenue;
    acc.bRev += r.bundleRevenue;
    acc.ord += r.orders;
    acc.bOrdTot += r.bundleOrders;
    acc.pat += r.patients ?? 0;
  }
  const rate = {
    all: ratesFrom(totals.all, baseCounts, bucket),
    bundle: ratesFrom(totals.bundle, baseCounts, bucket),
    nonBundle: ratesFrom(totals.nonBundle, baseCounts, bucket),
    patients: ratesFrom(totals.patients, baseCounts, bucket),
  };
  const baseAov = {
    all: acc.ord ? acc.rev / acc.ord : 0,
    bundle: acc.bOrdTot ? acc.bRev / acc.bOrdTot : 0,
    nonBundle:
      acc.ord - acc.bOrdTot
        ? (acc.rev - acc.bRev) / (acc.ord - acc.bOrdTot)
        : 0,
  };

  // ---------- indexed current-window data ----------
  const stateActual = new Map<string, Map<string, number>>(); // date -> state -> rev
  for (const r of stateDaily) {
    const m = stateActual.get(r.date) ?? new Map<string, number>();
    m.set(r.state, (m.get(r.state) ?? 0) + r.revenue);
    stateActual.set(r.date, m);
  }
  const cohortActual = new Map<string, Map<string, number>>();
  for (const r of cohortDaily) {
    const m = cohortActual.get(r.date) ?? new Map<string, number>();
    m.set(r.cohort, (m.get(r.cohort) ?? 0) + r.revenue);
    cohortActual.set(r.date, m);
  }

  const currentDays = eachDay(cfg.currentStart, cfg.currentEnd);

  // Rolling revenue/orders baselines, same formula as Power BI Revenue
  // Intelligence's "Today's / WTD / MTD Revenue Baseline" DAX measures:
  // P75 of the trailing-13-week (day/week) or trailing-3-month (month)
  // matching-pace history, re-anchored to each period's own end date rather
  // than one fixed reference window. `byDate` already holds the full pulled
  // history (refresh.ts widens the pull range for exactly this lookback).
  const revenueOn = (d: string): number => byDate.get(d)?.revenue ?? 0;
  const ordersOn = (d: string): number => byDate.get(d)?.orders ?? 0;
  function rollingExpected(
    kind: Period["kind"],
    days: string[],
  ): { revenue: number; orders: number } {
    const asOf = days[days.length - 1];
    if (kind === "day") {
      return {
        revenue: trailingDayP75(revenueOn, asOf),
        orders: trailingDayP75(ordersOn, asOf),
      };
    }
    if (kind === "week") {
      const wkStart = weekStart(asOf);
      const iso = isoDow(asOf);
      return {
        revenue: trailingWeekP75(revenueOn, wkStart, iso),
        orders: trailingWeekP75(ordersOn, wkStart, iso),
      };
    }
    if (kind === "month") {
      const mStart = `${monthKey(asOf)}-01`;
      return {
        revenue: trailingMonthP75(revenueOn, mStart, asOf),
        orders: trailingMonthP75(ordersOn, mStart, asOf),
      };
    }
    // "all": no Power BI equivalent was specified for an arbitrary custom
    // range, so sum each day's own trailing-13-week daily baseline — the
    // most literal extension of the same day-level formula.
    let revenue = 0;
    let orders = 0;
    for (const d of days) {
      revenue += anchoredDayP75(revenueOn, d, days[0]);
      orders += anchoredDayP75(ordersOn, d, days[0]);
    }
    return { revenue, orders };
  }

  function build(
    id: string,
    kind: Period["kind"],
    label: string,
    days: string[],
  ): Period {
    const sc = (d: string): number => p75Scale(p75f, kind, d);
    let orders = 0;
    let revenue = 0;
    let bundleOrders = 0;
    let bundleRevenue = 0;
    let patients = 0;
    let expB = 0;
    let expNb = 0;
    let expPat = 0;
    let wk = 0;
    let we = 0;
    let holiday: string | null = null;
    for (const d of days) {
      const r = byDate.get(d);
      if (r) {
        orders += r.orders;
        revenue += r.revenue;
        bundleOrders += r.bundleOrders;
        bundleRevenue += r.bundleRevenue;
        patients += r.patients ?? 0;
      }
      const t = dayType(d);
      if (t === "wk") wk += 1;
      else we += 1;
      const i = dow(d);
      const f = sc(d);
      expB += rate.bundle[i] * f;
      expNb += rate.nonBundle[i] * f;
      expPat += rate.patients[i] * f;
      holiday = holiday ?? holidayName(d);
    }
    // Headline revenue/orders baseline: Power BI-equivalent rolling P75
    // (trailing 13 weeks for day/week, trailing 3 months for month), so the
    // baseline shown here moves the same way Revenue Intelligence's does.
    const rolling = rollingExpected(kind, days);
    const expected = rolling.revenue;
    const expAll = rolling.orders;
    const delta = revenue - expected;
    const aov = orders ? revenue / orders : 0;
    const rollingBaseAov = expAll ? expected / expAll : 0;

    const volume = (orders - expAll) * rollingBaseAov;
    const aovEffect = orders * (aov - rollingBaseAov);

    const nbOrders = orders - bundleOrders;
    const nbRevenue = revenue - bundleRevenue;
    const bundleDelta =
      (bundleOrders - expB) * baseAov.bundle +
      bundleOrders *
        ((bundleOrders ? bundleRevenue / bundleOrders : 0) - baseAov.bundle);
    const nonBundleDelta =
      (nbOrders - expNb) * baseAov.nonBundle +
      nbOrders * ((nbOrders ? nbRevenue / nbOrders : 0) - baseAov.nonBundle);

    // Lens C — clinic cohorts
    const cohortAgg = cohortBaseline.map(cb => {
      let actual = 0;
      for (const d of days) actual += cohortActual.get(d)?.get(cb.cohort) ?? 0;
      let exp = 0;
      for (const d of days) exp += cb.rates[dow(d)] * sc(d);
      return { cohort: cb.cohort, actual, expected: exp, clinics: cb.clinics };
    });
    // Calibrated to the headline baseline so the cohort rows add up to the headline delta (analytics/lifecycle.ts).
    const cal = calibrate(cohortAgg, expected);
    const lensC: Row[] = cal.rows.map(r => ({
      label: COHORT_LABEL[r.cohort] ?? r.cohort,
      sub: `${fmtInt(r.clinics)} clinics`,
      value: r.delta,
      lens: "cohort",
      key: r.cohort,
      clinics: r.clinics,
    }));
    lensC.sort((a, b) => a.value - b.value);
    const cohortCalibration = cal.factor;

    // Lens D — states
    const stateDelta = new Map<string, number>();
    const ga = geoAllocBy.get(id);
    if (ga && ga.length) {
      // expected = top-down plan; actual = stateDaily (same source as headline)
      for (const g of ga) stateDelta.set(g.geo, -g.expectedRevenue);
      for (const d of days) {
        const m = stateActual.get(d);
        if (!m) continue;
        for (const [st, rev] of m) {
          const g = rawGeoMap[st] ?? geoKeyOf({ state: st, country: "" }).key;
          stateDelta.set(g, (stateDelta.get(g) ?? 0) + rev);
        }
      }
    } else {
      for (const sb of stateBaseline) {
        let exp = 0;
        for (const d of days) exp += sb.rates[dow(d)] * sc(d);
        stateDelta.set(sb.state, -exp);
      }
      for (const d of days) {
        const m = stateActual.get(d);
        if (!m) continue;
        for (const [st, rev] of m) {
          stateDelta.set(st, (stateDelta.get(st) ?? 0) + rev);
        }
      }
    }
    const sorted = [...stateDelta].sort((a, b) => a[1] - b[1]);
    const worst = sorted.slice(0, 4);
    const worstSum = worst.reduce((s, [, v]) => s + v, 0);
    const othersSum = sorted.slice(4).reduce((s, [, v]) => s + v, 0);
    const worstKey = worst.map(([s]) => s).join("/");
    const lensD: Row[] = [
      {
        label: worst.map(([s]) => s).join(" / "),
        sub: "four worst states",
        value: worstSum,
        lens: "state",
        key: worstKey,
      },
      {
        label: "All other states",
        sub: "net",
        value: othersSum,
        lens: "state",
        key: `!${worstKey}`,
      },
    ];

    // Level 2 — product families. Built once per order universe: "all" backs
    // the volume branch, "bundle" / "nonbundle" back the two product-mix rows,
    // so each branch lists only the families that actually sit inside it.
    const famActual = familyActual.get(id) ?? new Map();
    const famListFor = (scope: string): FamilyRow[] => {
      const rows: FamilyRow[] = [];
      const seen = new Set<string>();
      for (const fb of familyBaseline) {
        if ((fb.scope ?? "all") !== scope) continue;
        seen.add(fb.family);
        let exp = 0;
        let expOrd = 0;
        for (const d of days) {
          const f = sc(d);
          exp += fb.rates[dow(d)] * f;
          expOrd += fb.ordRates[dow(d)] * f;
        }
        const a = famActual.get(`${scope}|${fb.family}`) ?? {
          revenue: 0,
          orders: 0,
        };
        rows.push({
          family: fb.family,
          revenue: a.revenue,
          orders: a.orders,
          expected: exp,
          expectedOrders: expOrd,
          delta: a.revenue - exp,
          orderDelta: a.orders - expOrd,
        });
      }
      for (const [key, a] of famActual) {
        const bar = key.indexOf("|");
        if (key.slice(0, bar) !== scope) continue;
        const family = key.slice(bar + 1);
        if (seen.has(family)) continue;
        rows.push({
          family,
          revenue: a.revenue,
          orders: a.orders,
          expected: 0,
          expectedOrders: 0,
          delta: a.revenue,
          orderDelta: a.orders,
        });
      }
      rows.sort((x, y) => x.delta - y.delta);
      return rows;
    };
    const families = famListFor("all");
    const familiesBundle = famListFor("bundle");
    const familiesNonBundle = famListFor("nonbundle");

    return {
      id,
      kind,
      label,
      start: days[0],
      end: days[days.length - 1],
      days: days.length,
      holiday,
      actual: revenue,
      expected,
      delta,
      orders,
      expectedOrders: expAll,
      aov,
      baseAov: rollingBaseAov,
      patients,
      expectedPatients: expPat,
      families,
      familiesBundle,
      familiesNonBundle,
      lensA: [
        {
          label: "Order volume",
          sub: `${fmtInt(orders - expAll)} orders vs expected`,
          value: volume,
          lens: "volume",
          key: "",
        },
        {
          label: "AOV / price-mix",
          sub: `${aov - rollingBaseAov >= 0 ? "+" : "-"}$${fmtInt(Math.abs(aov - rollingBaseAov))} AOV`,
          value: aovEffect,
          lens: "aov",
          key: "",
        },
        {
          label: "Patient traffic",
          sub: `${fmtInt(patients)} patients vs ${fmtInt(expPat)} expected`,
          value: patients - expPat,
          unit: "patients" as const,
          base: expPat,
          lens: "traffic",
          key: "",
        },
      ],
      lensB: [
        {
          label: "Bundle orders",
          sub: `${fmtInt(bundleOrders)} orders`,
          value: bundleDelta,
          lens: "bundle",
          key: "",
        },
        {
          label: "Non-bundle orders",
          sub: `${fmtInt(nbOrders)} orders`,
          value: nonBundleDelta,
          lens: "nonbundle",
          key: "",
        },
      ],
      lensC,
      cohortCalibration,
      lensD,
      topStates: sorted.slice(0, 6).map(([state, value]) => ({ state, value })),
    };
  }

  const periods: Period[] = [];
  periods.push(
    build(
      "all",
      "all",
      `${shortDayLabel(cfg.currentStart)} – ${shortDayLabel(cfg.currentEnd)}`,
      currentDays,
    ),
  );

  const months = new Map<string, string[]>();
  const weeks = new Map<string, string[]>();
  const quarters = new Map<string, string[]>();
  for (const d of currentDays) {
    const mk = monthKey(d);
    const ws = weekStart(d);
    const qk = quarterKey(d);
    months.set(mk, [...(months.get(mk) ?? []), d]);
    weeks.set(ws, [...(weeks.get(ws) ?? []), d]);
    quarters.set(qk, [...(quarters.get(qk) ?? []), d]);
  }
  for (const [qk, qdays] of [...quarters].sort()) {
    const [qy, qq] = qk.split("-Q");
    const qStartMonth = (Number(qq) - 1) * 3 + 1;
    const qFirst = `${qy}-${String(qStartMonth).padStart(2, "0")}-01`;
    const qLastMonth = qStartMonth + 2;
    const qLastMonthDays = new Date(Number(qy), qLastMonth, 0).getDate();
    const qLast = `${qy}-${String(qLastMonth).padStart(2, "0")}-${String(qLastMonthDays).padStart(2, "0")}`;
    const fullQuarterDays = eachDay(qFirst, qLast);
    const partial =
      qdays[0] !== qFirst ||
      qdays.length < fullQuarterDays.length ||
      cfg.currentEnd === qdays[qdays.length - 1];
    const p = build(`q:${qk}`, "quarter", quarterLabel(qk), qdays);
    p.partial = partial;
    periods.push(p);
  }
  for (const [mk, days] of [...months].sort()) {
    const monthDays = eachDay(`${mk}-01`, days[days.length - 1]);
    const partial =
      days[0] !== `${mk}-01` ||
      days.length < monthDays.length ||
      cfg.currentEnd === days[days.length - 1];
    const p = build(`m:${mk}`, "month", monthLabel(mk), days);
    p.partial = partial;
    periods.push(p);
  }
  for (const [ws, days] of [...weeks].sort()) {
    const p = build(`w:${ws}`, "week", shortDayLabel(ws), days);
    p.partial = days.length < 7;
    periods.push(p);
  }
  for (const d of currentDays) {
    periods.push(build(`d:${d}`, "day", shortDayLabel(d), [d]));
  }

  return {
    ready: true as const,
    config: cfg,
    lastRefresh,
    baseline: {
      mode,
      modeLabel: BASELINE_LABEL[mode] ?? mode,
      bucket,
      start: cfg.baselineStart,
      end: cfg.baselineEnd,
      days: baseDays.length,
      weekdays: nWk,
      weekends: nWe,
      orders: acc.ord,
      revenue: acc.rev,
      aov: baseAov.all,
      patients: acc.pat,
      patientsPerWeekday: rate.patients[2],
      ordersPerWeekday: rate.all[2],
      ordersPerWeekend: rate.all[0],
      ratesByDow: rate.all,
      p75: p75f,
    },
    periods,
  };
}

export const bridge = scopedQuery({
  args: {},
  handler: async ctx => await computeBridge(ctx),
});

export const bridgeInternal = internalQuery({
  args: {},
  handler: async ctx => await computeBridge(ctx),
});
