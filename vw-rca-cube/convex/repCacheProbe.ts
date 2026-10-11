import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { baselineWindow, eachDay } from "./dateUtils";

/** Read-only feasibility probe: can existing main daily clinic rows replace
 * the Power BI current-window clinic pull for a rep on an individual day?
 * This is NOT an app-facing query and does not change calculation paths. */
export const compareDailyClinicActuals = internalQuery({
  args: { repKey: v.string(), sales: v.string(), date: v.string() },
  handler: async (ctx, { repKey, sales, date }) => {
    if (!repKey.startsWith("rep:") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Invalid probe parameters");
    }
    const main = await ctx.db.query("config")
      .withIndex("by_key", q => q.eq("key", "main")).unique();
    const rep = await ctx.db.query("config")
      .withIndex("by_key", q => q.eq("key", repKey)).unique();
    if (!main?.gen || !rep?.gen || main.currentEnd !== rep.currentEnd ||
        date < main.currentStart || date > main.currentEnd ||
        date < rep.currentStart || date > rep.currentEnd) {
      return { comparable: false as const, reason: "Different cutoff or day outside cached window" };
    }
    const [mainMeta, repMeta, mainDaily, repDaily] = await Promise.all([
      ctx.db.query("clinicMeta").withIndex("by_gen", q => q.eq("gen", main.gen!)).collect(),
      ctx.db.query("clinicMeta").withIndex("by_gen", q => q.eq("gen", rep.gen!)).collect(),
      ctx.db.query("clinicPeriod").withIndex("by_gen_period",
        q => q.eq("gen", main.gen!).eq("periodId", `d:${date}`)).collect(),
      ctx.db.query("clinicPeriod").withIndex("by_gen_period",
        q => q.eq("gen", rep.gen!).eq("periodId", `d:${date}`)).collect(),
    ]);
    const mainMine = new Set(mainMeta.filter(m => m.sales === sales).map(m => m.clinic));
    const repMine = new Set(repMeta.filter(m => m.sales === sales).map(m => m.clinic));
    const sums = (rows: typeof mainDaily, ids: Set<string>) => {
      const chosen = rows.filter(r => ids.has(r.clinic));
      return {
        clinics: chosen.length,
        revenue: chosen.reduce((n, r) => n + r.revenue, 0),
        orders: chosen.reduce((n, r) => n + r.orders, 0),
        bundleRevenue: chosen.reduce((n, r) => n + r.bundleRevenue, 0),
        bundleOrders: chosen.reduce((n, r) => n + r.bundleOrders, 0),
        patients: chosen.reduce((n, r) => n + (r.patients ?? 0), 0),
      };
    };
    return {
      comparable: true as const,
      date, mainGen: main.gen, repGen: rep.gen,
      identityDisagreements: [...new Set([...mainMine, ...repMine])]
        .filter(id => mainMine.has(id) !== repMine.has(id)).length,
      differingIdsWithMainActivity: mainDaily
        .filter(r => mainMine.has(r.clinic) !== repMine.has(r.clinic)).length,
      differingIdsWithRepActivity: repDaily
        .filter(r => mainMine.has(r.clinic) !== repMine.has(r.clinic)).length,
      main: sums(mainDaily, mainMine), rep: sums(repDaily, repMine),
    };
  },
});

/** Coverage audit for a local cache assembled from all retained main/rep
 * generations. A missing day is not necessarily a missing order: no-order
 * dates are absent from clinicPeriod. Source-range completeness needs its own
 * manifest before the cache can be used to serve arbitrary dates. */
export const coverage = internalQuery({
  args: { start: v.string(), end: v.string() },
  handler: async (ctx, { start, end }) => {
    const main = await ctx.db.query("config")
      .withIndex("by_key", q => q.eq("key", "main")).unique();
    const win = baselineWindow("p75", start, end);
    const all = await ctx.db.query("config").collect();
    return {
      requested: { start, end, baselineStart: win.start, baselineEnd: win.end },
      main: main && { start: main.currentStart, end: main.currentEnd, gen: main.gen },
      sourceWindows: all.filter(c => c.key.startsWith("rep:") && c.gen)
        .map(c => ({ start: c.currentStart, end: c.currentEnd, gen: c.gen })),
      daysBeforeMain: main ? eachDay(win.start, main.currentStart < win.end ? main.currentStart : win.end).length : null,
    };
  },
});
