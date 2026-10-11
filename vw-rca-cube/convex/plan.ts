import { loadCfg } from "./config";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { eachDay } from "./dateUtils";
import { gatedMutation, scopedMutation, scopedQuery } from "./gated";

/**
 * Per-clinic weekly plan.
 *
 * Sales can set a target orders/week and revenue/week for any clinic in the
 * drill list. The difference between that target and the clinic's current
 * weekly rate is carried forward over the remaining weeks of the year and
 * added to the year-end projection, so a rep can see what their own commitments
 * do to the close.
 */

export type PlanCurrent = { rev: number; ord: number };

/** Current weekly rate per clinic across the analysis window. */
export async function currentWeekly(ctx: QueryCtx) {
  const cfg = await loadCfg(ctx);
  if (!cfg) return { weeks: 0, byClinic: new Map<string, PlanCurrent>() };
  const gen = cfg.gen ?? 0;
  const weeks = eachDay(cfg.currentStart, cfg.currentEnd).length / 7;
  const rows = await ctx.db
    .query("clinicPeriod")
    .withIndex("by_gen_period", q => q.eq("gen", gen).eq("periodId", "all"))
    .collect();
  const byClinic = new Map<string, PlanCurrent>();
  for (const r of rows) {
    const c = byClinic.get(r.clinic) ?? { rev: 0, ord: 0 };
    c.rev += weeks ? r.revenue / weeks : 0;
    c.ord += weeks ? r.orders / weeks : 0;
    byClinic.set(r.clinic, c);
  }
  return { weeks, byClinic };
}

export const list = scopedQuery({
  args: {},
  handler: async ctx => {
    const { weeks, byClinic } = await currentWeekly(ctx);
    const plans = await ctx.db.query("clinicPlan").collect();
    return {
      ready: true as const,
      weeks,
      current: [...byClinic].map(([clinic, c]) => ({
        clinic,
        revWeek: c.rev,
        ordWeek: c.ord,
      })),
      plans: plans.map(p => ({
        clinic: p.clinic,
        name: p.name,
        targetRevenueWeek: p.targetRevenueWeek,
        targetOrdersWeek: p.targetOrdersWeek,
      })),
    };
  },
});

export const setPlan = scopedMutation({
  args: {
    clinic: v.string(),
    name: v.string(),
    targetRevenueWeek: v.number(),
    targetOrdersWeek: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clinicPlan")
      .withIndex("by_clinic", q => q.eq("clinic", args.clinic))
      .first();
    const empty = args.targetRevenueWeek <= 0 && args.targetOrdersWeek <= 0;
    if (existing) {
      if (empty) {
        await ctx.db.delete(existing._id);
        return { ok: true as const };
      }
      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
      return { ok: true as const };
    }
    if (empty) return { ok: true as const };
    await ctx.db.insert("clinicPlan", { ...args, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const clearPlans = gatedMutation({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query("clinicPlan").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { cleared: rows.length };
  },
});
