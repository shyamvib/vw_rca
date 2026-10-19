import { loadCfg, viewerCfgKey } from "./config";
import { goalFactors } from "./baseline";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { clinicHealthMap } from "./clinics";
import { addDays, dow, eachDay, monthKey, quarterKey, windowP75 } from "./dateUtils";
import { gatedAction, onlyMine, scopedAction, type Viewer } from "./gated";

/**
 * Rep logins may only open clinics in their own book. Team viewers pass.
 */
async function assertOwnsClinic(
  ctx: { viewer: Viewer; runQuery: ActionCtx["runQuery"] },
  clinic: string,
) {
  if (ctx.viewer.kind !== "rep") return;
  const owner: string | null = await ctx.runQuery(internal.repAuth.clinicSales, {
    clinic,
  });
  if (owner !== ctx.viewer.rep) {
    throw new Error("Not available for rep logins.");
  }
}
import {
  type CubeFilter,
  rows as cubeRows,
  eq,
  O,
  orderDays,
  ordersRows,
  scopeFilters,
} from "./cube";
import { familyOf, num, splitFamilies, TABLE } from "./powerbi";

/**
 * Level-2 drill-downs that are too large to precompute: the clinics behind a
 * single product family, and the customers inside a single clinic. Both are
 * queried live from Power BI on click and cached until the next refresh.
 *
 * Expected values reuse the stored baseline: a clinic's (or customer's) share
 * of the baseline window is scaled by the share of the baseline that the
 * selected period represents, so the rows still add back to the family node.
 */

export const OTHER_FAMILY = "Other families";

export function periodRange(
  periodId: string,
  currentStart: string,
  currentEnd: string,
): { start: string; end: string; days: string[] } {
  let days = eachDay(currentStart, currentEnd);
  const [kind, key] = periodId.split(":");
  if (periodId !== "all") {
    if (kind === "d") days = [key];
    else if (kind === "w") {
      days = eachDay(key, addDays(key, 6)).filter(
        d => d >= currentStart && d <= currentEnd,
      );
    } else if (kind === "m") {
      days = days.filter(d => monthKey(d) === key);
    } else if (kind === "q") {
      days = days.filter(d => quarterKey(d) === key);
    }
  }
  return { start: days[0], end: days[days.length - 1], days };
}

export const context = internalQuery({
  args: {
    family: v.optional(v.string()),
    scope: v.optional(v.string()),
    // The caller's selected period. Health flags always describe the WHOLE
    // clinic for THIS period (never the family/scope-narrowed numbers) —
    // see convex/flags.ts and clinics.ts's clinicHealthMap. Defaults to the
    // full window for callers that don't have a natural period of their own
    // (e.g. the provider name search).
    periodId: v.optional(v.string()),
    /** Period whose goal factor to return when it differs from the health-flag period. */
    goalPeriodId: v.optional(v.string()),
    cfgKey: v.optional(v.string()),
  },
  handler: async (ctx, { family, scope, periodId, goalPeriodId, cfgKey }) => {
    // Pin the rep's window for helpers called below (they read loadCfg(ctx)).
    if (cfgKey) (ctx as { __cfgKey?: string }).__cfgKey = cfgKey;
    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    const fam = family
      ? ((
          await ctx.db
            .query("familyBaseline")
            .withIndex("by_gen", q => q.eq("gen", gen))
            .collect()
        ).find(
          f => f.family === family && (f.scope ?? "all") === (scope ?? "all"),
        ) ?? null)
      : null;
    const clinics = await ctx.db
      .query("clinicMeta")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    // Reuse this same clinicMeta collect for the flag evaluator — fetching
    // the whole table a second time in one query risks Convex's per-
    // execution byte-read cap (hit in practice at ~7k clinics, 2026-09-21).
    const health = await clinicHealthMap(ctx, periodId ?? "all", clinics);
    const goal = cfg ? await goalFactors(ctx, cfg, goalPeriodId ?? periodId ?? "all") : null;
    return {
      cfg,
      goal,
      fam,
      clinics: clinics.map(c => ({
        clinic: c.clinic,
        name: c.name,
        state: c.state,
        sales: c.sales,
        cohort: c.cohort,
        health: health.get(c.clinic) ?? [],
        pstatus: c.pstatus ?? [],
        baseRev: c.baseRev,
        baseOrders: c.baseOrders,
        isNew: c.isNew ?? false,
        rev: c.rev,
        ord: c.ord,
        bRev: c.bRev,
        bOrd: c.bOrd,
      })),
    };
  },
});

/**
 * Families are stored as combination strings, so a single family is matched by
 * substring in DAX (cheap prefilter) and then verified exactly in TS, where the
 * order's revenue is also split pro-rata across the families it contains.
 */
/** Restricts a family query to bundle or non-bundle orders. */
/** Orders whose product-family combination contains `family` (case-insensitive, like DAX CONTAINSSTRING). */
const familyFilter = (family: string): CubeFilter => ({
  member: `${O}.product_family`,
  operator: "contains",
  values: [family],
});

/** Revenue weight of `family` in a combination row, 0 when it isn't in it. */
function famWeight(row: Record<string, unknown>, family: string): number {
  const parts = splitFamilies(familyOf(row));
  return parts.includes(family) ? 1 / parts.length : 0;
}

export type FamilyClinicRow = {
  clinic: string;
  name: string;
  state: string;
  sales: string;
  cohort: string;
  health: string[];
  pstatus: string[];
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  aov: number;
  /** Share of this clinic's orders in this family that are bundle orders. */
  bundleShare: number;
};

// biome-ignore lint/suspicious/noExplicitAny: action ctx shape differs per caller
async function familyClinics(
  ctx: any,
  args: {
    periodId: string;
    family: string;
    limit?: number;
    /** "all" | "bundle" | "nonbundle" — matches the branch the family was
     * opened from, so a family under the bundle branch only counts the
     * clinic's bundle orders. */
    scope?: string;
  },
): Promise<{
  rows: FamilyClinicRow[];
  total: number;
  orderTotal: number;
  count: number;
  note?: string;
}> {
  const scope = args.scope ?? "all";
  const { cfg, fam, clinics, goal } = await ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
    family: args.family,
    scope,
    periodId: args.periodId,
  });
  if (!cfg) return { rows: [], total: 0, orderTotal: 0, count: 0 };
  if (args.family === OTHER_FAMILY) {
    return {
      rows: [],
      total: 0,
      orderTotal: 0,
      count: 0,
      note: "“Other families” rolls up every small family — open a named family for the clinic list.",
    };
  }
  const gfR = goal?.rev ?? windowP75(cfg);
  const gfO = goal?.ord ?? windowP75(cfg);
  const { start, end, days } = periodRange(
    args.periodId,
    cfg.currentStart,
    cfg.currentEnd,
  );

  // What share of the baseline does this period represent, for this family?
  let expRev = 0;
  let expOrd = 0;
  if (fam) {
    for (const d of days) {
      expRev += fam.rates[dow(d)] * gfR;
      expOrd += fam.ordRates[dow(d)] * gfO;
    }
  }
  const revShare = fam && fam.baseRev ? expRev / fam.baseRev : 0;
  const ordShare = fam && fam.baseOrders ? expOrd / fam.baseOrders : 0;

  const [currentRows, baseRows, bundleRows] = await Promise.all([
    ordersRows({ by: ["clinic_id"], family: true, start, end, m: { rev: "revenue", ord: "orders" },
        filters: [familyFilter(args.family), ...scopeFilters(scope)] }),
    ordersRows({ by: ["clinic_id"], family: true, start: cfg.baselineStart, end: cfg.baselineEnd, m: { rev: "revenue", ord: "orders" },
        filters: [familyFilter(args.family), ...scopeFilters(scope)] }),
    // Bundle share of the family's orders per clinic. Only needed when the
    // list isn't already scoped to one side of the bundle split.
    scope === "all"
      ? ordersRows({ by: ["clinic_id"], family: true, start, end, m: { ord: "orders" },
          filters: [familyFilter(args.family), ...scopeFilters("bundle")] })
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  const meta = new Map(clinics.map((c: { clinic: string }) => [c.clinic, c]));
  const acc = new Map<
    string,
    {
      revenue: number;
      orders: number;
      expected: number;
      expectedOrders: number;
      bundleOrders: number;
    }
  >();
  const touch = (id: string) => {
    const a = acc.get(id) ?? {
      revenue: 0,
      orders: 0,
      expected: 0,
      expectedOrders: 0,
      bundleOrders: 0,
    };
    acc.set(id, a);
    return a;
  };
  for (const r of currentRows) {
    const w = famWeight(r, args.family);
    if (!w) continue;
    const a = touch(String(r[`${TABLE}[clinic_id]`]));
    a.revenue += num(r, "rev") * w;
    a.orders += num(r, "ord");
  }
  for (const r of bundleRows) {
    const w = famWeight(r, args.family);
    if (!w) continue;
    touch(String(r[`${TABLE}[clinic_id]`])).bundleOrders += num(r, "ord");
  }
  for (const r of baseRows) {
    const w = famWeight(r, args.family);
    if (!w) continue;
    const a = touch(String(r[`${TABLE}[clinic_id]`]));
    a.expected += num(r, "rev") * w * revShare;
    a.expectedOrders += num(r, "ord") * ordShare;
  }

  const rows: FamilyClinicRow[] = [];
  for (const [clinic, a] of acc) {
    const m = meta.get(clinic) as
      | { name: string; state: string; sales: string; cohort: string }
      | undefined;
    rows.push({
      clinic,
      name: m?.name ?? `Clinic ${clinic}`,
      state: m?.state ?? "—",
      sales: m?.sales ?? "—",
      cohort: m?.cohort ?? "—",
      health: (m as { health?: string[] } | undefined)?.health ?? [],
      pstatus: (m as { pstatus?: string[] } | undefined)?.pstatus ?? [],
      revenue: a.revenue,
      orders: a.orders,
      expected: a.expected,
      expectedOrders: a.expectedOrders,
      delta: a.revenue - a.expected,
      orderDelta: a.orders - a.expectedOrders,
      aov: a.orders ? a.revenue / a.orders : 0,
      bundleShare:
        scope === "bundle"
          ? 1
          : scope === "nonbundle"
            ? 0
            : a.orders
              ? a.bundleOrders / a.orders
              : 0,
    });
  }
  const total = rows.reduce((s, r) => s + r.delta, 0);
  const orderTotal = rows.reduce((s, r) => s + r.orderDelta, 0);
  const descending = total > 0;
  rows.sort((x, y) => (descending ? y.delta - x.delta : x.delta - y.delta));
  return {
    rows: rows.slice(0, Math.min(args.limit ?? 25, 250)),
    total,
    orderTotal,
    count: rows.length,
  };
}

export const familyClinicsAction = scopedAction({
  args: {
    periodId: v.string(),
    family: v.string(),
    limit: v.optional(v.number()),
    scope: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    rows: FamilyClinicRow[];
    total: number;
    orderTotal: number;
    count: number;
    note?: string;
  }> => {
    // Rep logins: compute the full list, keep only the rep's clinics, then
    // re-total so the panel's sums describe what is on screen.
    const rep = ctx.viewer.kind === "rep" ? ctx.viewer.rep : (args.sales ?? null);
    const limit = rep ? 250 : args.limit;
    const key = (viewerCfgKey(ctx) ?? "") + `fam2|${args.periodId}|${args.family}|${args.scope ?? "all"}|${limit ?? 25}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    let result: Awaited<ReturnType<typeof familyClinics>>;
    if (hit) {
      result = JSON.parse(hit);
    } else {
      result = await familyClinics(ctx, { periodId: args.periodId, family: args.family, scope: args.scope, limit });
      await ctx.runMutation(internal.ingest.putCache, {
        key,
        payload: JSON.stringify(result),
      });
    }
    if (!rep) return result;
    const rows = result.rows.filter(r => r.sales === rep).slice(0, args.limit ?? 25);
    return {
      ...result,
      rows,
      total: rows.reduce((s, r) => s + r.delta, 0),
      orderTotal: rows.reduce((s, r) => s + r.orderDelta, 0),
      count: rows.length,
    };
  },
});

export const familyClinicsInternal = internalAction({
  args: {
    periodId: v.string(),
    family: v.string(),
    limit: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => await familyClinics(ctx, args),
});

export type CustomerRow = {
  customerId: string;
  name: string;
  type: string;
  revenue: number;
  orders: number;
  patients: number;
  aov: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  lastOrder: string;
  hubspot: string;
};

// biome-ignore lint/suspicious/noExplicitAny: action ctx shape differs per caller
async function customers(
  ctx: any,
  args: { clinic: string; periodId: string; family?: string; scope?: string },
): Promise<{ rows: CustomerRow[]; total: number }> {
  const scope = args.scope ?? "all";
  const { cfg, fam, clinics, goal } = await ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
    family: args.family,
    scope,
    periodId: args.periodId,
  });
  if (!cfg) return { rows: [], total: 0 };
  const gfR = goal?.rev ?? windowP75(cfg);
  const gfO = goal?.ord ?? windowP75(cfg);
  const { start, end, days } = periodRange(
    args.periodId,
    cfg.currentStart,
    cfg.currentEnd,
  );

  const clinicMeta = clinics.find(
    (c: { clinic: string }) => c.clinic === args.clinic,
  );
  let expRev = 0;
  let expOrd = 0;
  let baseRev = 0;
  let baseOrders = 0;
  if (args.family && fam) {
    for (const d of days) {
      expRev += fam.rates[dow(d)] * gfR;
      expOrd += fam.ordRates[dow(d)] * gfO;
    }
    baseRev = fam.baseRev;
    baseOrders = fam.baseOrders;
  } else if (clinicMeta) {
    // Scoped list: measure the clinic against its bundle (or non-bundle) rates
    // so the customer rows compare like with like.
    const rev = (i: number) =>
      scope === "bundle"
        ? (clinicMeta.bRev?.[i] ?? 0)
        : scope === "nonbundle"
          ? clinicMeta.rev[i] - (clinicMeta.bRev?.[i] ?? 0)
          : clinicMeta.rev[i];
    const ord = (i: number) =>
      scope === "bundle"
        ? (clinicMeta.bOrd?.[i] ?? 0)
        : scope === "nonbundle"
          ? clinicMeta.ord[i] - (clinicMeta.bOrd?.[i] ?? 0)
          : clinicMeta.ord[i];
    for (const d of days) {
      expRev += rev(dow(d)) * gfR;
      expOrd += ord(dow(d)) * gfO;
    }
    for (const d of eachDay(cfg.baselineStart, cfg.baselineEnd)) {
      baseRev += rev(dow(d));
      baseOrders += ord(dow(d));
    }
  }
  const revShare = baseRev ? expRev / baseRev : 0;
  const ordShare = baseOrders ? expOrd / baseOrders : 0;

  const ff =
    args.family && args.family !== OTHER_FAMILY ? [familyFilter(args.family)] : [];
  const [cur, base] = await Promise.all([
    ordersRows({ by: ["customer_id", "customer_name", "customer_type"], family: !!args.family, start, end,
        m: { rev: "revenue", ord: "orders", pat: "patients", last: "last_order", hs: "last_hubspot_link" },
        filters: [eq(`${O}.clinic_id`, Number(args.clinic)), ...ff, ...scopeFilters(scope)] }),
    ordersRows({ by: ["customer_id"], family: !!args.family, start: cfg.baselineStart, end: cfg.baselineEnd,
        m: { rev: "revenue", ord: "orders" },
        filters: [eq(`${O}.clinic_id`, Number(args.clinic)), ...ff, ...scopeFilters(scope)] }),
  ]);
  const weight = (r: Record<string, unknown>) =>
    args.family && args.family !== OTHER_FAMILY ? famWeight(r, args.family) : 1;

  const rows = new Map<string, CustomerRow>();
  const blank = (id: string): CustomerRow => ({
    customerId: id,
    name: `Customer ${id}`,
    type: "—",
    revenue: 0,
    orders: 0,
    patients: 0,
    aov: 0,
    expected: 0,
    expectedOrders: 0,
    delta: 0,
    orderDelta: 0,
    lastOrder: "",
    hubspot: "",
  });
  for (const r of cur) {
    const w = weight(r);
    if (!w) continue;
    const id = String(r[`${TABLE}[customer_id]`]);
    const row = rows.get(id) ?? blank(id);
    row.name = String(r[`${TABLE}[customer_name]`] ?? row.name);
    row.type = String(r[`${TABLE}[customer_type]`] ?? "—");
    row.revenue += num(r, "rev") * w;
    row.orders += num(r, "ord");
    row.patients = Math.max(row.patients, num(r, "pat"));
    const hs = String(r["[hs]"] ?? "");
    if (hs.startsWith("http")) row.hubspot = hs;
    const last = String(r["[last]"] ?? "").slice(0, 10);
    if (last > row.lastOrder) row.lastOrder = last;
    rows.set(id, row);
  }
  for (const r of base) {
    const w = weight(r);
    if (!w) continue;
    const id = String(r[`${TABLE}[customer_id]`]);
    const row = rows.get(id) ?? blank(id);
    row.expected += num(r, "rev") * w * revShare;
    row.expectedOrders += num(r, "ord") * ordShare;
    rows.set(id, row);
  }
  const out = [...rows.values()].map(r => ({
    ...r,
    lastOrder: r.lastOrder || "—",
    aov: r.orders ? r.revenue / r.orders : 0,
    delta: r.revenue - r.expected,
    orderDelta: r.orders - r.expectedOrders,
  }));
  out.sort((a, b) => a.delta - b.delta);
  return {
    rows: out.slice(0, 100),
    total: out.reduce((s, r) => s + r.delta, 0),
  };
}

export const customersAction = scopedAction({
  args: {
    clinic: v.string(),
    periodId: v.string(),
    family: v.optional(v.string()),
    scope: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: CustomerRow[]; total: number }> => {
    await assertOwnsClinic(ctx, args.clinic);
    const key = (viewerCfgKey(ctx) ?? "") + `cust3|${args.periodId}|${args.clinic}|${args.family ?? ""}|${args.scope ?? "all"}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    if (hit) return JSON.parse(hit);
    const result = await customers(ctx, args);
    await ctx.runMutation(internal.ingest.putCache, {
      key,
      payload: JSON.stringify(result),
    });
    return result;
  },
});

export const customersInternal = internalAction({
  args: {
    clinic: v.string(),
    periodId: v.string(),
    family: v.optional(v.string()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => await customers(ctx, args),
});

export type PortfolioRow = {
  family: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  status: string;
  baselineAvg: number;
  recentOrders: number;
  /** a real product family (not Non Zoomer / Unmapped): what Products per customer counts */
  product?: boolean;
};

/** Portfolio Changes status of a test the clinic has no row for in the selected window (the model works at test level). */
export type TestStatus = { test: string; status: string; baselineAvg: number; recentOrders: number };

/**
 * A clinic's own product portfolio: which single families it orders, this
 * period vs its baseline rate, joined to the dataset's own Portfolio Changes
 * status (NEW / DECLINING / STOPPED per clinic and test).
 */
// biome-ignore lint/suspicious/noExplicitAny: action ctx shape differs per caller
async function portfolio(
  ctx: any,
  args: { clinic: string; periodId: string; scope?: string },
): Promise<PortfolioResult> {
  const scope = args.scope ?? "all";
  const { cfg, clinics, goal } = await ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
    periodId: args.periodId,
  });
  if (!cfg) return { rows: [], testStatus: [] };
  const gfR = goal?.rev ?? windowP75(cfg);
  const { start, end, days } = periodRange(
    args.periodId,
    cfg.currentStart,
    cfg.currentEnd,
  );
  const meta = clinics.find(
    (c: { clinic: string }) => c.clinic === args.clinic,
  ) as
    | { rev: number[]; ord: number[]; bRev: number[]; baseRev: number; isNew?: boolean }
    | undefined;

  const baseDays = eachDay(cfg.baselineStart, cfg.baselineEnd);
  const [cur, base, changes, anchorRows] = await Promise.all([
    ordersRows({ family: true, start, end, m: { rev: "revenue", ord: "orders" },
        filters: [eq(`${O}.clinic_id`, Number(args.clinic)), ...scopeFilters(scope)] }),
    ordersRows({ family: true, start: cfg.baselineStart, end: cfg.baselineEnd, m: { rev: "revenue", ord: "orders" },
        filters: [eq(`${O}.clinic_id`, Number(args.clinic)), ...scopeFilters(scope)] }),
    // The model also reports the date it anchored "the last 28 days" on; older Cube models do not have that member yet, so
    // fall back to the query without it.
    (async () => {
      const dims = ["portfolio_changes.clinic_id", "portfolio_changes.test_name", "portfolio_changes.status", "portfolio_changes.baseline_28d_avg", "portfolio_changes.recent_orders"];
      const map: Record<string, string> = {
        "portfolio_changes.clinic_id": "Portfolio Changes[Clinic Id]",
        "portfolio_changes.test_name": "Portfolio Changes[Test Name]",
        "portfolio_changes.status": "Portfolio Changes[Status]",
        "portfolio_changes.baseline_28d_avg": "Portfolio Changes[Baseline 28D Average]",
        "portfolio_changes.recent_orders": "Portfolio Changes[Recent Orders]",
      };
      const filters = [eq("portfolio_changes.clinic_id", Number(args.clinic))];
      try {
        return await cubeRows({ dimensions: [...dims, "portfolio_changes.anchor_date"], filters }, { ...map, "portfolio_changes.anchor_date": "Portfolio Changes[Anchor Date]" });
      } catch {
        return await cubeRows({ dimensions: dims, filters }, map);
      }
    })(),
    // The anchor is the same for every clinic, so a clinic with no status rows can still print exact dates.
    cubeRows({ dimensions: ["portfolio_changes.anchor_date"], limit: 1 }, { "portfolio_changes.anchor_date": "Portfolio Changes[Anchor Date]" }).catch(() => [] as Array<Record<string, unknown>>),
  ]);

  // The period's share of the baseline window, weighted by day type, so the
  // family rows are comparable with the rest of the dashboard.
  let share = 0;
  if (meta && meta.baseRev) {
    // The window's share of the clinic's baseline, measured on the same order
    // universe the tables are scoped to, so bundle rows scale off bundle rates.
    const rate = (i: number) =>
      scope === "bundle"
        ? (meta.bRev?.[i] ?? 0)
        : scope === "nonbundle"
          ? meta.rev[i] - (meta.bRev?.[i] ?? 0)
          : meta.rev[i];
    let exp = 0;
    for (const d of days) exp += rate(dow(d)) * gfR;
    let baseTot = 0;
    for (const d of baseDays) baseTot += rate(dow(d));
    share = baseTot ? exp / baseTot : 0;
  } else {
    share = baseDays.length ? days.length / baseDays.length : 0;
  }

  const acc = new Map<
    string,
    {
      revenue: number;
      orders: number;
      expected: number;
      expectedOrders: number;
      bundleOrders: number;
    }
  >();
  const touch = (f: string) => {
    const a = acc.get(f) ?? {
      revenue: 0,
      orders: 0,
      expected: 0,
      expectedOrders: 0,
      bundleOrders: 0,
    };
    acc.set(f, a);
    return a;
  };
  for (const r of cur) {
    const fams = splitFamilies(familyOf(r));
    for (const f of fams) {
      const a = touch(f);
      a.revenue += num(r, "rev") / fams.length;
      a.orders += num(r, "ord");
    }
  }
  // A clinic that is new this year has no baseline (lifecycle rules, 2026-10-18), so nothing is expected of it per family
  // either; what it ordered in the baseline period is not turned into an expectation.
  if (!meta?.isNew)
    for (const r of base) {
      const fams = splitFamilies(familyOf(r));
      for (const f of fams) {
        const a = touch(f);
        a.expected += (num(r, "rev") / fams.length) * share;
        a.expectedOrders += num(r, "ord") * share;
      }
    }

  const status = new Map<
    string,
    { test: string; status: string; baselineAvg: number; recentOrders: number }
  >();
  for (const r of changes) {
    const test = String(r["Portfolio Changes[Test Name]"] ?? "").trim();
    if (!test) continue;
    status.set(test.toLowerCase(), {
      test,
      status: String(r["Portfolio Changes[Status]"] ?? ""),
      baselineAvg: Number(r["Portfolio Changes[Baseline 28D Average]"] ?? 0),
      recentOrders: Number(r["Portfolio Changes[Recent Orders]"] ?? 0),
    });
  }
  const rows: PortfolioRow[] = [...acc].map(([family, a]) => {
    const st = status.get(family.toLowerCase());
    return {
      family,
      revenue: a.revenue,
      orders: a.orders,
      expected: a.expected,
      expectedOrders: a.expectedOrders,
      delta: a.revenue - a.expected,
      orderDelta: a.orders - a.expectedOrders,
      status: st?.status ?? "",
      baselineAvg: st?.baselineAvg ?? 0,
      recentOrders: st?.recentOrders ?? 0,
      product: family !== "Non Zoomer" && family !== "Unmapped",
    };
  });
  rows.sort((a, b) => a.orderDelta - b.orderDelta);
  // The status model works on tests (Portfolio Changes), not product families: a test with a status that matches no
  // family row above (e.g. "Hormone Zoomer 2.0", or a test ordered only just before the window) is listed on its own.
  const shown = new Set(rows.map(r => r.family.toLowerCase()));
  const testStatus: TestStatus[] = [...status]
    .filter(([k, v]) => !shown.has(k) && v.status)
    .map(([, v]) => ({ test: v.test, status: v.status, baselineAvg: v.baselineAvg, recentOrders: v.recentOrders }))
    .sort((a, b) => a.test.localeCompare(b.test));
  // Portfolio Changes (cube/model/cubes/portfolio_changes.yml): recent = the last 28 days up to the latest order date, the
  // baseline = the 90 days before that (average shown per 28 days). The model reports the latest order date it used; if it
  // does not (older model), the dashboard's cutoff plus the lag is the best estimate.
  const reported = String(changes[0]?.["Portfolio Changes[Anchor Date]"] ?? anchorRows[0]?.["Portfolio Changes[Anchor Date]"] ?? "").slice(0, 10);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(reported) ? reported : addDays(cfg.currentEnd, cfg.lagDays ?? 1);
  return {
    rows,
    testStatus,
    window: { start, end },
    recent: { start: addDays(anchor, -27), end: anchor },
    prior: { start: addDays(anchor, -117), end: addDays(anchor, -28) },
    anchorExact: /^\d{4}-\d{2}-\d{2}$/.test(reported),
    isNew: !!meta?.isNew,
  };
}

export const portfolioAction = scopedAction({
  args: {
    clinic: v.string(),
    periodId: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<PortfolioResult> => {
    await assertOwnsClinic(ctx, args.clinic);
    const key = (viewerCfgKey(ctx) ?? "") + `port4|${args.periodId}|${args.clinic}|${args.scope ?? "all"}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    if (hit) return JSON.parse(hit);
    const result = await portfolio(ctx, args);
    await ctx.runMutation(internal.ingest.putCache, {
      key,
      payload: JSON.stringify(result),
    });
    return result;
  },
});

export const portfolioInternal = internalAction({
  args: {
    clinic: v.string(),
    periodId: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => await portfolio(ctx, args),
});

export type PortfolioResult = {
  rows: PortfolioRow[];
  testStatus: TestStatus[];
  note?: string;
  window?: { start: string; end: string };
  recent?: { start: string; end: string };
  prior?: { start: string; end: string };
  anchorExact?: boolean;
  isNew?: boolean;
};

export type UnmappedTest = {
  test: string;
  orders: number;
  expectedOrders: number;
  orderDelta: number;
  revenue: number;
  expected: number;
  delta: number;
};

/**
 * What actually sits inside "Unmapped": the individual tests on orders whose
 * product_family is unmapped in the BI model (mostly à-la-carte blood
 * analytes). A test can appear on many orders, so `orders` counts distinct
 * orders containing the test and `revenue` is the revenue of those orders —
 * the rows overlap by design and do not sum to the Unmapped node.
 */
async function unmappedTests(
  ctx: any,
  args: { periodId: string; limit?: number },
): Promise<{ rows: UnmappedTest[]; note: string }> {
  const { cfg, fam, goal } = await ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
    family: "Unmapped",
    periodId: args.periodId,
  });
  if (!cfg) return { rows: [], note: "No configuration loaded." };
  const gfR = goal?.rev ?? windowP75(cfg);
  const { start, end, days } = periodRange(
    args.periodId,
    cfg.currentStart,
    cfg.currentEnd,
  );

  // Share of the baseline window this period represents, weighted by day type,
  // so expected values line up with the rest of the dashboard.
  let share = 0;
  if (fam?.baseRev) {
    let exp = 0;
    for (const d of days) exp += fam.rates[dow(d)] * gfR;
    share = exp / fam.baseRev;
  } else {
    const baseDays = eachDay(cfg.baselineStart, cfg.baselineEnd);
    share = baseDays.length ? days.length / baseDays.length : 0;
  }

  const q = (s: string, e: string) =>
    cubeRows({
      measures: [`${O}.orders`, `${O}.revenue`],
      dimensions: ["order_tests.test_name"],
      timeDimensions: orderDays(s, e),
      filters: [eq(`${O}.product_family`, "Unmapped")],
    }, { "order_tests.test_name": "fact_order_tests_enriched[test_name]", [`${O}.orders`]: "[ord]", [`${O}.revenue`]: "[rev]" });
  const [cur, base] = await Promise.all([
    q(start, end),
    q(cfg.baselineStart, cfg.baselineEnd),
  ]);

  const nameOf = (r: Record<string, unknown>) =>
    String(r["fact_order_tests_enriched[test_name]"] ?? "").trim();
  const acc = new Map<string, UnmappedTest>();
  const touch = (t: string) => {
    const a = acc.get(t) ?? {
      test: t,
      orders: 0,
      expectedOrders: 0,
      orderDelta: 0,
      revenue: 0,
      expected: 0,
      delta: 0,
    };
    acc.set(t, a);
    return a;
  };
  for (const r of cur) {
    const t = nameOf(r);
    if (!t) continue;
    const a = touch(t);
    a.orders += num(r, "ord");
    a.revenue += num(r, "rev");
  }
  for (const r of base) {
    const t = nameOf(r);
    if (!t) continue;
    const a = touch(t);
    a.expectedOrders += num(r, "ord") * share;
    a.expected += num(r, "rev") * share;
  }
  const rows = [...acc.values()].map(a => ({
    ...a,
    orderDelta: a.orders - a.expectedOrders,
    delta: a.revenue - a.expected,
  }));
  rows.sort((a, b) => a.orderDelta - b.orderDelta);
  const limit = args.limit ?? 25;
  return {
    rows: rows.slice(0, limit),
    note: `${rows.length} distinct tests sit on unmapped orders. A test is counted once per order it appears on and carries that order's full revenue, so these rows overlap and do not add to the Unmapped node — read them as "which tests drive unmapped demand".`,
  };
}

export const unmappedTestsAction = gatedAction({
  args: { periodId: v.string(), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: UnmappedTest[]; note: string }> => {
    const key = (viewerCfgKey(ctx) ?? "") + `unmapped|${args.periodId}|${args.limit ?? 25}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    if (hit) return JSON.parse(hit);
    const result = await unmappedTests(ctx, args);
    await ctx.runMutation(internal.ingest.putCache, {
      key,
      payload: JSON.stringify(result),
    });
    return result;
  },
});

export const unmappedTestsInternal = internalAction({
  args: { periodId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => await unmappedTests(ctx, args),
});

export type SwitchRow = {
  clinic: string;
  name: string;
  state: string;
  sales: string;
  cohort: string;
  health: string[];
  pstatus: string[];
  /** Pair totals in the shape of the standard clinic table. */
  revenue: number;
  expected: number;
  orders: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  aov: number;
  /** Portfolio Changes status for the two tests, e.g. "STOPPED" / "NEW". */
  downStatus: string;
  upStatus: string;
  downOrders: number;
  downExpectedOrders: number;
  downOrderDelta: number;
  downDelta: number;
  upOrders: number;
  upExpectedOrders: number;
  upOrderDelta: number;
  upDelta: number;
  netDelta: number;
  netOrderDelta: number;
  /** stayed | switched | partial | lost | gained */
  klass: string;
};

/**
 * Clinic-level view of a substitution pair (e.g. Total Tox → Toxin Zoomer):
 * for every clinic that ordered either family, how its orders of the declining
 * family moved and whether the replacement family picked them up. Classified so
 * the list answers "who has NOT moved over" directly, and joined to the
 * dataset's own Portfolio Changes status for the two tests.
 */
// biome-ignore lint/suspicious/noExplicitAny: action ctx shape differs per caller
async function switchClinics(
  ctx: any,
  args: { periodId: string; down: string; up: string; limit?: number },
): Promise<{
  rows: SwitchRow[];
  counts: Record<string, number>;
  groupDelta: Record<string, number>;
  totals: {
    downDelta: number;
    upDelta: number;
    downOrderDelta: number;
    upOrderDelta: number;
  };
  count: number;
}> {
  const empty = {
    rows: [],
    counts: {},
    groupDelta: {},
    totals: {
      downDelta: 0,
      upDelta: 0,
      downOrderDelta: 0,
      upOrderDelta: 0,
    },
    count: 0,
  };
  const [downCtx, upCtx] = await Promise.all([
    ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
      family: args.down,
      periodId: args.periodId,
    }),
    ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
      family: args.up,
      periodId: args.periodId,
    }),
  ]);
  const cfg = downCtx.cfg;
  const goal = downCtx.goal;
  if (!cfg) return empty;
  const gfR = goal?.rev ?? windowP75(cfg);
  const gfO = goal?.ord ?? windowP75(cfg);
  const { start, end, days } = periodRange(
    args.periodId,
    cfg.currentStart,
    cfg.currentEnd,
  );

  // Each family's own share of its baseline for this period, day-type weighted,
  // so the per-clinic expectations match the family nodes on the tree.
  const shareOf = (
    fam: {
      rates: number[];
      ordRates: number[];
      baseRev: number;
      baseOrders: number;
    } | null,
  ) => {
    if (!fam) return { rev: 0, ord: 0 };
    let r = 0;
    let o = 0;
    for (const d of days) {
      r += fam.rates[dow(d)] * gfR;
      o += fam.ordRates[dow(d)] * gfO;
    }
    return {
      rev: fam.baseRev ? r / fam.baseRev : 0,
      ord: fam.baseOrders ? o / fam.baseOrders : 0,
    };
  };
  const shares: Record<string, { rev: number; ord: number }> = {
    [args.down]: shareOf(downCtx.fam),
    [args.up]: shareOf(upCtx.fam),
  };

  const pairFilter = {
    or: [familyFilter(args.down), familyFilter(args.up)],
  };
  const q = (s: string, e: string) =>
    ordersRows({ by: ["clinic_id"], family: true, start: s, end: e, m: { rev: "revenue", ord: "orders" },
      filters: [pairFilter] });
  const [curRows, baseRows, changes] = await Promise.all([
    q(start, end),
    q(cfg.baselineStart, cfg.baselineEnd),
    cubeRows({ dimensions: ["portfolio_changes.clinic_id", "portfolio_changes.test_name", "portfolio_changes.status", "portfolio_changes.baseline_28d_avg", "portfolio_changes.recent_orders"],
        filters: [eq("portfolio_changes.test_name", args.down, args.up)] }, {
        "portfolio_changes.clinic_id": "Portfolio Changes[Clinic Id]",
        "portfolio_changes.test_name": "Portfolio Changes[Test Name]",
        "portfolio_changes.status": "Portfolio Changes[Status]",
        "portfolio_changes.baseline_28d_avg": "Portfolio Changes[Baseline 28D Average]",
        "portfolio_changes.recent_orders": "Portfolio Changes[Recent Orders]",
      }),
  ]);

  type Acc = {
    downOrders: number;
    downRev: number;
    downExpectedOrders: number;
    downExpected: number;
    upOrders: number;
    upRev: number;
    upExpectedOrders: number;
    upExpected: number;
  };
  const acc = new Map<string, Acc>();
  const touch = (id: string): Acc => {
    const a = acc.get(id) ?? {
      downOrders: 0,
      downRev: 0,
      downExpectedOrders: 0,
      downExpected: 0,
      upOrders: 0,
      upRev: 0,
      upExpectedOrders: 0,
      upExpected: 0,
    };
    acc.set(id, a);
    return a;
  };
  const add = (rows: Record<string, unknown>[], baseline: boolean): void => {
    for (const r of rows) {
      const id = String(r[`${TABLE}[clinic_id]`]);
      const rev = num(r, "rev");
      const ord = num(r, "ord");
      for (const family of [args.down, args.up]) {
        const w = famWeight(r, family);
        if (!w) continue;
        const a = touch(id);
        const isDown = family === args.down;
        if (baseline) {
          const sh = shares[family];
          if (isDown) {
            a.downExpected += rev * w * sh.rev;
            a.downExpectedOrders += ord * sh.ord;
          } else {
            a.upExpected += rev * w * sh.rev;
            a.upExpectedOrders += ord * sh.ord;
          }
        } else if (isDown) {
          a.downRev += rev * w;
          a.downOrders += ord;
        } else {
          a.upRev += rev * w;
          a.upOrders += ord;
        }
      }
    }
  };
  add(curRows, false);
  add(baseRows, true);

  const statusBy = new Map<string, { down: string; up: string }>();
  for (const c of changes) {
    const id = String(c["Portfolio Changes[Clinic Id]"] ?? "");
    const test = String(c["Portfolio Changes[Test Name]"] ?? "");
    const status = String(c["Portfolio Changes[Status]"] ?? "");
    if (!id || !status) continue;
    const s = statusBy.get(id) ?? { down: "", up: "" };
    if (test === args.down) s.down = status;
    else s.up = status;
    statusBy.set(id, s);
  }

  const meta = new Map(
    (
      downCtx.clinics as Array<{
        clinic: string;
        name: string;
        state: string;
        sales: string;
        cohort: string;
        health: string[];
        pstatus: string[];
      }>
    ).map(c => [c.clinic, c]),
  );
  const rows: SwitchRow[] = [];
  for (const [clinic, a] of acc) {
    const m = meta.get(clinic);
    const downOrderDelta = a.downOrders - a.downExpectedOrders;
    const upOrderDelta = a.upOrders - a.upExpectedOrders;
    const st = statusBy.get(clinic) ?? { down: "", up: "" };
    // Classification is about order flow, not revenue: a clinic has "moved"
    // when the replacement picked up a meaningful share of what it dropped.
    let klass: string;
    if (downOrderDelta < -0.5 && a.upOrders <= 0) klass = "stayed";
    else if (downOrderDelta < -0.5 && upOrderDelta >= -downOrderDelta * 0.6)
      klass = "switched";
    else if (downOrderDelta < -0.5 && upOrderDelta > 0.5) klass = "partial";
    else if (downOrderDelta < -0.5) klass = "lost";
    // Never bought the declining test in either window: the pair says nothing
    // about them, so keep them out of the "flat or up" bucket.
    else if (a.downOrders <= 0 && a.downExpectedOrders <= 0.5) klass = "uponly";
    else klass = "gained";
    const revenue = a.downRev + a.upRev;
    const expected = a.downExpected + a.upExpected;
    const orders = a.downOrders + a.upOrders;
    const expectedOrders = a.downExpectedOrders + a.upExpectedOrders;
    rows.push({
      clinic,
      name: m?.name ?? `Clinic ${clinic}`,
      state: m?.state ?? "—",
      sales: m?.sales ?? "—",
      cohort: m?.cohort ?? "—",
      health: m?.health ?? [],
      pstatus: m?.pstatus ?? [],
      revenue,
      expected,
      orders,
      expectedOrders,
      delta: revenue - expected,
      orderDelta: orders - expectedOrders,
      aov: orders > 0 ? revenue / orders : 0,
      downStatus: st.down,
      upStatus: st.up,
      downOrders: a.downOrders,
      downExpectedOrders: a.downExpectedOrders,
      downOrderDelta,
      downDelta: a.downRev - a.downExpected,
      upOrders: a.upOrders,
      upExpectedOrders: a.upExpectedOrders,
      upOrderDelta,
      upDelta: a.upRev - a.upExpected,
      netDelta: a.downRev - a.downExpected + (a.upRev - a.upExpected),
      netOrderDelta: downOrderDelta + upOrderDelta,
      klass,
    });
  }
  const counts: Record<string, number> = {};
  /** Full-group net revenue delta, independent of the display cap. */
  const groupDelta: Record<string, number> = {};
  const totals = {
    downDelta: 0,
    upDelta: 0,
    downOrderDelta: 0,
    upOrderDelta: 0,
  };
  for (const r of rows) {
    counts[r.klass] = (counts[r.klass] ?? 0) + 1;
    groupDelta[r.klass] = (groupDelta[r.klass] ?? 0) + r.netDelta;
    totals.downDelta += r.downDelta;
    totals.upDelta += r.upDelta;
    totals.downOrderDelta += r.downOrderDelta;
    totals.upOrderDelta += r.upOrderDelta;
  }
  // Worst unreplaced losses first — that is the call list.
  rows.sort((x, y) => x.netDelta - y.netDelta);
  // Cap PER GROUP, so every tab shows its own top N rather than sharing one pool.
  const cap = Math.min(args.limit ?? 60, 300);
  const perClass: Record<string, number> = {};
  const capped = rows.filter(r => {
    const n = (perClass[r.klass] ?? 0) + 1;
    perClass[r.klass] = n;
    return n <= cap;
  });
  return {
    rows: capped,
    counts,
    groupDelta,
    totals,
    count: rows.length,
  };
}

export const switchClinicsAction = scopedAction({
  args: {
    periodId: v.string(),
    down: v.string(),
    up: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    rows: SwitchRow[];
    counts: Record<string, number>;
    groupDelta: Record<string, number>;
    totals: {
      downDelta: number;
      upDelta: number;
      downOrderDelta: number;
      upOrderDelta: number;
    };
    count: number;
  }> => {
    const rep = ctx.viewer.kind === "rep" ? ctx.viewer.rep : null;
    const limit = rep ? 300 : args.limit;
    const key = (viewerCfgKey(ctx) ?? "") + `switch4|${args.periodId}|${args.down}|${args.up}|${limit ?? 60}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    let result: Awaited<ReturnType<typeof switchClinics>>;
    if (hit) {
      result = JSON.parse(hit);
    } else {
      result = await switchClinics(ctx, { ...args, limit });
      await ctx.runMutation(internal.ingest.putCache, {
        key,
        payload: JSON.stringify(result),
      });
    }
    if (!rep) return result;
    // Rep logins: the rep's clinics only, with group counts/totals re-derived
    // from those rows so every tab describes what is on screen.
    const mine = onlyMine(ctx.viewer, result.rows);
    const counts: Record<string, number> = {};
    const groupDelta: Record<string, number> = {};
    const totals = { downDelta: 0, upDelta: 0, downOrderDelta: 0, upOrderDelta: 0 };
    for (const r of mine) {
      counts[r.klass] = (counts[r.klass] ?? 0) + 1;
      groupDelta[r.klass] = (groupDelta[r.klass] ?? 0) + r.netDelta;
      totals.downDelta += r.downDelta;
      totals.upDelta += r.upDelta;
      totals.downOrderDelta += r.downOrderDelta;
      totals.upOrderDelta += r.upOrderDelta;
    }
    const cap = Math.min(args.limit ?? 60, 300);
    const perClass: Record<string, number> = {};
    const rows = mine.filter(r => {
      const n = (perClass[r.klass] ?? 0) + 1;
      perClass[r.klass] = n;
      return n <= cap;
    });
    return { rows, counts, groupDelta, totals, count: rows.length };
  },
});

export const switchClinicsInternal = internalAction({
  args: {
    periodId: v.string(),
    down: v.string(),
    up: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => await switchClinics(ctx, args),
});

export type ProviderRow = {
  customerId: string;
  name: string;
  type: string;
  clinic: string;
  clinicName: string;
  state: string;
  sales: string;
  revenue: number;
  orders: number;
  patients: number;
  aov: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  lastOrder: string;
  hubspot: string;
  health: string[];
  pstatus: string[];
};

/**
 * Provider (customer) search across the whole window — the customer-level
 * counterpart of the clinic search box. Matches on provider name or id and
 * measures each hit against its clinic's own baseline run rate, so the numbers
 * read the same way as everywhere else on the dashboard.
 */
// biome-ignore lint/suspicious/noExplicitAny: action ctx shape differs per caller
async function providers(
  ctx: any,
  term: string,
  periodId = "all",
): Promise<{ ready: boolean; rows: ProviderRow[] }> {
  const q = term.trim();
  if (q.length < 2) return { ready: true, rows: [] };
  const { cfg, clinics, goal } = await ctx.runQuery(internal.families.context, {
    cfgKey: viewerCfgKey(ctx),
    periodId: "all",
    goalPeriodId: periodId,
  });
  if (!cfg) return { ready: false, rows: [] };
  const gfR = goal?.rev ?? windowP75(cfg);
  const gfO = goal?.ord ?? windowP75(cfg);
  const pr = periodRange(periodId, cfg.currentStart, cfg.currentEnd);
  const days = pr.days.length ? pr.days : eachDay(cfg.currentStart, cfg.currentEnd);
  const pStart = days[0];
  const pEnd = days[days.length - 1];

  // Share of each clinic's baseline that this window represents, so a
  // provider's baseline revenue converts into an expected value.
  const share = new Map<string, { rev: number; ord: number }>();
  const meta = new Map<string, (typeof clinics)[number]>();
  for (const c of clinics as Array<{
    clinic: string;
    rev: number[];
    ord: number[];
    baseRev: number;
    baseOrders: number;
  }>) {
    let expRev = 0;
    let expOrd = 0;
    for (const d of days) {
      expRev += c.rev[dow(d)] * gfR;
      expOrd += c.ord[dow(d)] * gfO;
    }
    share.set(c.clinic, {
      rev: c.baseRev ? expRev / c.baseRev : 0,
      ord: c.baseOrders ? expOrd / c.baseOrders : 0,
    });
    // biome-ignore lint/suspicious/noExplicitAny: mixed clinic meta shape
    meta.set(c.clinic, c as any);
  }

  const safe = q.replace(/"/g, "");
  const [cur, base] = await Promise.all([
    ordersRows({ by: ["customer_id", "customer_name", "customer_type", "clinic_id"], start: pStart, end: pEnd,
        m: { rev: "revenue", ord: "orders", pat: "patients", last: "last_order", hs: "last_hubspot_link" },
        filters: [{ member: `${O}.customer_name`, operator: "contains", values: [safe] }],
        order: [["rev", "desc"]], limit: 400 }),
    ordersRows({ by: ["customer_id", "customer_name", "clinic_id"], start: cfg.baselineStart, end: cfg.baselineEnd,
        m: { rev: "revenue", ord: "orders" },
        filters: [{ member: `${O}.customer_name`, operator: "contains", values: [safe] }] }),
  ]);

  const rows = new Map<string, ProviderRow>();
  const blank = (id: string, clinic: string): ProviderRow => {
    const m = meta.get(clinic) as
      | {
          name: string;
          state: string;
          sales: string;
          health: string[];
          pstatus: string[];
        }
      | undefined;
    return {
      customerId: id,
      name: `Provider ${id}`,
      type: "—",
      clinic,
      clinicName: m?.name ?? `Clinic ${clinic}`,
      state: m?.state ?? "—",
      sales: m?.sales ?? "—",
      revenue: 0,
      orders: 0,
      patients: 0,
      aov: 0,
      expected: 0,
      expectedOrders: 0,
      delta: 0,
      orderDelta: 0,
      lastOrder: "",
      hubspot: "",
      health: m?.health ?? [],
      pstatus: m?.pstatus ?? [],
    };
  };
  for (const r of cur as Array<Record<string, unknown>>) {
    const id = String(r[`${TABLE}[customer_id]`]);
    const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
    const row = rows.get(id) ?? blank(id, clinic);
    row.name = String(r[`${TABLE}[customer_name]`] ?? row.name);
    row.type = String(r[`${TABLE}[customer_type]`] ?? "—");
    row.revenue += num(r, "rev");
    row.orders += num(r, "ord");
    row.patients = Math.max(row.patients, num(r, "pat"));
    const hs = String(r["[hs]"] ?? "");
    if (hs.startsWith("http")) row.hubspot = hs;
    const last = String(r["[last]"] ?? "").slice(0, 10);
    if (last > row.lastOrder) row.lastOrder = last;
    rows.set(id, row);
  }
  for (const r of base as Array<Record<string, unknown>>) {
    const id = String(r[`${TABLE}[customer_id]`]);
    const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
    const row = rows.get(id) ?? blank(id, clinic);
    const nm = String(r[`${TABLE}[customer_name]`] ?? "");
    if (nm && row.name.startsWith("Provider ")) row.name = nm;
    const sh = share.get(row.clinic || clinic) ?? { rev: 0, ord: 0 };
    row.expected += num(r, "rev") * sh.rev;
    row.expectedOrders += num(r, "ord") * sh.ord;
    rows.set(id, row);
  }
  const out = [...rows.values()]
    .map(r => ({
      ...r,
      lastOrder: r.lastOrder || "—",
      aov: r.orders ? r.revenue / r.orders : 0,
      delta: r.revenue - r.expected,
      orderDelta: r.orders - r.expectedOrders,
    }))
    .filter(r => r.revenue > 0 || r.expected > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 40);
  return { ready: true, rows: out };
}

export const providerSearch = scopedAction({
  args: { term: v.string(), periodId: v.optional(v.string()) },
  handler: async (
    ctx,
    { term, periodId },
  ): Promise<{ ready: boolean; rows: ProviderRow[] }> => {
    const key = (viewerCfgKey(ctx) ?? "") + `prov2|${periodId ?? "all"}|${term.trim().toLowerCase()}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, {
      key,
    });
    if (hit) {
      const cached = JSON.parse(hit) as { ready: boolean; rows: ProviderRow[] };
      return { ...cached, rows: onlyMine(ctx.viewer, cached.rows) };
    }
    const result = await providers(ctx, term, periodId ?? "all");
    if (result.ready) {
      await ctx.runMutation(internal.ingest.putCache, {
        key,
        payload: JSON.stringify(result),
      });
    }
    return { ...result, rows: onlyMine(ctx.viewer, result.rows) };
  },
});

export const providerSearchInternal = internalAction({
  args: { term: v.string() },
  handler: async (ctx, { term }) => await providers(ctx, term),
});
