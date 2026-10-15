import { loadCfg } from "./config";
import { v } from "convex/values";
import {
  dow,
  eachDay,
  monthEnd,
  p75Scale,
  type P75Factors,
  quarterKey,
} from "./dateUtils";
import { gatedQuery, scopedQuery } from "./gated";

/**
 * Product-family level-2 lists for one team lead.
 *
 * The book-wide lists are pre-aggregated per period in `familyPeriod`. Storing
 * the same thing per lead would quadruple that table, so a lead's families are
 * kept as day series (`familyLeadSeries`, a few hundred documents) and the
 * period arithmetic — expected = baseline weekday rate × the period's days ×
 * the P75 factor — is redone here, identical to convex/bridge.ts.
 */

export type FamilyRow = {
  family: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
};

/** Resolves the day list a periodId stands for, clipped to the window. */
function daysOf(
  periodId: string,
  start: string,
  end: string,
): { days: string[]; kind: "all" | "quarter" | "month" | "week" | "day" } {
  if (periodId.startsWith("d:")) {
    return { days: [periodId.slice(2)], kind: "day" };
  }
  if (periodId.startsWith("w:")) {
    const s = periodId.slice(2);
    const all = eachDay(s, addDaysLocal(s, 6));
    return { days: all.filter(d => d >= start && d <= end), kind: "week" };
  }
  if (periodId.startsWith("m:")) {
    const s = `${periodId.slice(2)}-01`;
    const all = eachDay(s, monthEnd(s));
    return { days: all.filter(d => d >= start && d <= end), kind: "month" };
  }
  if (periodId.startsWith("q:")) {
    const all = eachDay(start, end).filter(d => quarterKey(d) === periodId.slice(2));
    return { days: all, kind: "quarter" };
  }
  return { days: eachDay(start, end), kind: "all" };
}

function addDaysLocal(d: string, n: number): string {
  const ms = Date.parse(`${d}T00:00:00Z`) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export const leadFamilies = gatedQuery({
  args: { periodId: v.string(), teamLead: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ready: boolean;
    all: FamilyRow[];
    bundle: FamilyRow[];
    nonbundle: FamilyRow[];
  }> => {
    const empty = { ready: false, all: [], bundle: [], nonbundle: [] };
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (!cfg) return empty;
    const gen = cfg.gen ?? 0;
    const series = await ctx.db
      .query("familyLeadSeries")
      .withIndex("by_gen_lead", q => q.eq("gen", gen).eq("lead", args.teamLead))
      .collect();
    if (series.length === 0) return empty;

    const { days, kind } = daysOf(
      args.periodId,
      cfg.currentStart,
      cfg.currentEnd,
    );
    const dayset = new Set(days);
    const p75f: P75Factors | null =
      cfg.baselineMode === "p75"
        ? ((cfg.p75 as P75Factors | undefined) ?? null)
        : null;

    const byScope: Record<string, FamilyRow[]> = {
      all: [],
      bundle: [],
      nonbundle: [],
    };
    for (const s of series) {
      let expected = 0;
      let expectedOrders = 0;
      for (const d of days) {
        const f = p75Scale(p75f, kind, d);
        expected += (s.rates[dow(d)] ?? 0) * f;
        expectedOrders += (s.ordRates[dow(d)] ?? 0) * f;
      }
      let revenue = 0;
      let orders = 0;
      for (const d of s.days) {
        if (!dayset.has(d.d)) continue;
        revenue += d.rev;
        orders += d.ord;
      }
      (byScope[s.scope] ?? byScope.all).push({
        family: s.family,
        revenue,
        orders,
        expected,
        expectedOrders,
        delta: revenue - expected,
        orderDelta: orders - expectedOrders,
      });
    }
    for (const k of Object.keys(byScope)) {
      byScope[k].sort((a, b) => a.delta - b.delta);
    }
    return {
      ready: true,
      all: byScope.all,
      bundle: byScope.bundle,
      nonbundle: byScope.nonbundle,
    };
  },
});

/**
 * Product-family level-2 lists for one sales rep — same math as
 * `leadFamilies` above, just reading `familySalesSeries` (keyed by rep)
 * instead of `familyLeadSeries` (keyed by team lead). Both series are built
 * from the identical famBase/famDays rows in refresh.ts, just grouped
 * differently, so a rep's totals always reconcile into their lead's totals.
 * Added 2026-09-04 so the product-mix panel re-scopes to a picked rep.
 */
export const salesFamilies = scopedQuery({
  args: { periodId: v.string(), sales: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ready: boolean;
    all: FamilyRow[];
    bundle: FamilyRow[];
    nonbundle: FamilyRow[];
  }> => {
    const empty = { ready: false, all: [], bundle: [], nonbundle: [] };
    const cfg = await loadCfg(ctx);
    if (!cfg) return empty;
    const gen = cfg.gen ?? 0;
    const series = await ctx.db
      .query("familySalesSeries")
      .withIndex("by_gen_sales", q =>
        q.eq("gen", gen).eq("sales", args.sales),
      )
      .collect();
    if (series.length === 0) return empty;

    const { days, kind } = daysOf(
      args.periodId,
      cfg.currentStart,
      cfg.currentEnd,
    );
    const dayset = new Set(days);
    const p75f: P75Factors | null =
      cfg.baselineMode === "p75"
        ? ((cfg.p75 as P75Factors | undefined) ?? null)
        : null;

    const byScope: Record<string, FamilyRow[]> = {
      all: [],
      bundle: [],
      nonbundle: [],
    };
    for (const s of series) {
      let expected = 0;
      let expectedOrders = 0;
      for (const d of days) {
        const f = p75Scale(p75f, kind, d);
        expected += (s.rates[dow(d)] ?? 0) * f;
        expectedOrders += (s.ordRates[dow(d)] ?? 0) * f;
      }
      let revenue = 0;
      let orders = 0;
      for (const d of s.days) {
        if (!dayset.has(d.d)) continue;
        revenue += d.rev;
        orders += d.ord;
      }
      (byScope[s.scope] ?? byScope.all).push({
        family: s.family,
        revenue,
        orders,
        expected,
        expectedOrders,
        delta: revenue - expected,
        orderDelta: orders - expectedOrders,
      });
    }
    for (const k of Object.keys(byScope)) {
      byScope[k].sort((a, b) => a.delta - b.delta);
    }
    return {
      ready: true,
      all: byScope.all,
      bundle: byScope.bundle,
      nonbundle: byScope.nonbundle,
    };
  },
});
