import { loadCfg } from "./config";
import { v } from "convex/values";
import { dow, monthKey } from "./dateUtils";
import { scopedQuery } from "./gated";
import { geoKeyOf } from "./geoKey";
import { currentWeekly } from "./plan";

/**
 * Year-end projection.
 *
 * Where the dashboard's tree explains what already happened, this answers the
 * forward question: at the current run rate, where does 2026 land, how far is
 * that from the target, and what has to be added on each remaining trading day
 * — broken down the same way the shortfall is.
 *
 * Mechanics
 *  - Run rate: average revenue/orders per weekday over the trailing 13 weeks of
 *    actuals (so weekday mix never distorts a projection).
 *  - Each remaining calendar day is scaled by a prior-year seasonal factor
 *    (that date's revenue last year ÷ the median of the same weekday in a
 *    normal stretch of last year), which prices in holidays and the Nov–Dec
 *    slowdown from actual trading history rather than a hardcoded list.
 *  - Needed dollars are spread over remaining days in the same shape, so the
 *    per-day asks are already holiday-adjusted.
 *  - Clinic plans (target orders/revenue per week entered in the drill list)
 *    are carried over the remaining weeks and folded into the projected close.
 */

export const summary = scopedQuery({
  args: {
    teamLead: v.optional(v.string()),
    // Geography key from geo.ts (a US state code or "c:XX" for a country),
    // and/or a salesperson name — scopes the projection to that book instead
    // of a team lead's, using each clinic's own YTD and trailing-13-week
    // actuals rather than a bespoke DAX rollup per grouping.
    state: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = await loadCfg(ctx);
    if (!cfg) return { ready: false as const };
    const gen = cfg.gen ?? 0;
    const proj = await ctx.db
      .query("projection")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .first();
    if (!proj) return { ready: false as const };

    // Filtered by team lead, the projection is that lead's own year-to-date
    // plus their share of the forward curve; the annual target is pro-rated by
    // the same share, so the gap is that book's share of the company gap.
    const lead = args.teamLead
      ? (proj.leads ?? []).find(l => l.lead === args.teamLead)
      : undefined;
    let share = lead ? lead.share : 1;
    let ordShare = lead ? lead.ordShare : 1;
    let ytdRevenue = lead ? lead.ytdRevenue : proj.ytdRevenue;
    let ytdOrders = lead ? lead.ytdOrders : proj.ytdOrders;

    // A state and/or salesperson scope (optionally combined with team lead,
    // e.g. "this rep's book in this state") is built from the clinic rows
    // directly — their own YTD + trailing-13-week actuals — the same
    // mechanic as the team-lead share above but computed on the fly so it
    // works for any geography or rep, not just the pre-aggregated leads.
    const scopeActive = !!(args.state || args.sales);
    const inScope = (m: {
      teamLead?: string;
      state: string;
      country?: string;
      sales: string;
    }) => {
      if (args.teamLead && m.teamLead !== args.teamLead) return false;
      if (args.state) {
        const gk = geoKeyOf({ state: m.state, country: m.country ?? "" });
        if (gk.key !== args.state) return false;
      }
      if (args.sales && m.sales !== args.sales) return false;
      return true;
    };
    let metas: Array<{
      clinic: string;
      teamLead?: string;
      state: string;
      country?: string;
      sales: string;
      ytdRevenue?: number;
      ytdOrders?: number;
      fwdRevenue?: number;
      fwdOrders?: number;
    }> = [];
    if (scopeActive || args.teamLead) {
      metas = await ctx.db
        .query("clinicMeta")
        .withIndex("by_gen", q => q.eq("gen", gen))
        .collect();
    }
    if (scopeActive) {
      let totalFwdRev = 0;
      let totalFwdOrd = 0;
      let scopeFwdRev = 0;
      let scopeFwdOrd = 0;
      let scopeYtdRev = 0;
      let scopeYtdOrd = 0;
      for (const m of metas) {
        const fwdRev = m.fwdRevenue ?? 0;
        const fwdOrd = m.fwdOrders ?? 0;
        totalFwdRev += fwdRev;
        totalFwdOrd += fwdOrd;
        if (!inScope(m)) continue;
        scopeFwdRev += fwdRev;
        scopeFwdOrd += fwdOrd;
        scopeYtdRev += m.ytdRevenue ?? 0;
        scopeYtdOrd += m.ytdOrders ?? 0;
      }
      share = totalFwdRev ? scopeFwdRev / totalFwdRev : 0;
      ordShare = totalFwdOrd ? scopeFwdOrd / totalFwdOrd : 0;
      ytdRevenue = scopeYtdRev;
      ytdOrders = scopeYtdOrd;
    }
    const target = (cfg.annualTarget ?? 130_000_000) * share;

    const projectedRemaining =
      proj.days.reduce((s, d) => s + d.rev, 0) * share;
    const projectedRemainingOrders =
      proj.days.reduce((s, d) => s + d.ord, 0) * ordShare;
    const close = ytdRevenue + projectedRemaining;
    const closeOrders = ytdOrders + projectedRemainingOrders;
    const neededRemaining = Math.max(0, target - ytdRevenue);


    // Per-day asks, holiday-shaped: each day keeps its share of the projected
    // curve, so a Thanksgiving Thursday is never asked for a normal Thursday.
    const shapeTotal = projectedRemaining || 1;
    const holidaySet = new Set(proj.holidays);
    let wdCount = 0;
    let weCount = 0;
    let wdNeeded = 0;
    let weNeeded = 0;
    let wdProjected = 0;
    let weProjected = 0;
    const byMonth = new Map<
      string,
      { projected: number; needed: number; days: number }
    >();
    for (const d of proj.days) {
      const dayRev = d.rev * share;
      const needed = (dayRev / shapeTotal) * neededRemaining;
      const weekend = dow(d.date) === 0 || dow(d.date) === 6;
      if (weekend) {
        weCount += 1;
        weNeeded += needed;
        weProjected += dayRev;
      } else if (!holidaySet.has(d.date)) {
        wdCount += 1;
        wdNeeded += needed;
        wdProjected += dayRev;
      }
      const mk = monthKey(d.date);
      const m = byMonth.get(mk) ?? { projected: 0, needed: 0, days: 0 };
      m.projected += dayRev;
      m.needed += needed;
      m.days += 1;
      byMonth.set(mk, m);
    }

    const aov =
      projectedRemainingOrders > 0
        ? projectedRemaining / projectedRemainingOrders
        : 0;
    const ordersNeeded = aov > 0 ? neededRemaining / aov : 0;

    // --- Clinic plans: sales-entered weekly targets -------------------------
    const { byClinic } = await currentWeekly(ctx);
    let plans = await ctx.db.query("clinicPlan").collect();
    if (args.teamLead || scopeActive) {
      // Only the filtered book's plans lift the filtered projection.
      const mine = new Set(metas.filter(inScope).map(m => m.clinic));
      plans = plans.filter(p => mine.has(p.clinic));
    }
    const remainingWeeks = proj.days.length / 7;
    let planRevWeek = 0;
    let planOrdWeek = 0;
    let planBaseRevWeek = 0;
    for (const p of plans) {
      const cur = byClinic.get(p.clinic) ?? { rev: 0, ord: 0 };
      planBaseRevWeek += cur.rev;
      planRevWeek += Math.max(0, p.targetRevenueWeek - cur.rev);
      planOrdWeek += Math.max(0, p.targetOrdersWeek - cur.ord);
    }
    const planRevenue = planRevWeek * remainingWeeks;
    const planOrders = planOrdWeek * remainingWeeks;
    const withPlan = projectedRemaining + planRevenue;
    const closeWithPlan = ytdRevenue + withPlan;
    const lift = projectedRemaining > 0 ? withPlan / projectedRemaining : 1;

    return {
      ready: true as const,
      target,
      teamLead: args.teamLead ?? null,
      state: args.state ?? null,
      sales: args.sales ?? null,
      leadShare: share,
      ytd: {
        revenue: ytdRevenue,
        orders: ytdOrders,
        start: proj.ytdStart,
        end: proj.ytdEnd,
      },
      plan: {
        count: plans.length,
        weeklyRevenueUplift: planRevWeek,
        weeklyOrderUplift: planOrdWeek,
        currentWeeklyRevenue: planBaseRevWeek,
        addedRevenue: planRevenue,
        addedOrders: planOrders,
        remainingWeeks,
      },
      projected: {
        remaining: withPlan,
        remainingBase: projectedRemaining,
        remainingOrders: projectedRemainingOrders,
        close: closeWithPlan,
        closeBase: close,
        closeOrders: closeOrders + planOrders,
        aov,
      },
      gap: target - closeWithPlan,
      neededRemaining,
      pace: {
        remainingDays: proj.days.length,
        workdays: wdCount,
        weekendDays: weCount,
        holidays: proj.holidays,
        workdayProjected: wdCount ? (wdProjected * lift) / wdCount : 0,
        workdayNeeded: wdCount ? wdNeeded / wdCount : 0,
        weekendProjected: weCount ? (weProjected * lift) / weCount : 0,
        weekendNeeded: weCount ? weNeeded / weCount : 0,
        ordersNeeded,
        ordersProjected: projectedRemainingOrders + planOrders,
        fwdRates: proj.fwdRates,
        fwdOrdRates: proj.fwdOrdRates,
      },
      months: [...byMonth]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([month, m]) => ({
          month,
          days: m.days,
          projected: m.projected,
          needed: m.needed,
          uplift: m.needed - m.projected,
        })),
    };
  },
});
