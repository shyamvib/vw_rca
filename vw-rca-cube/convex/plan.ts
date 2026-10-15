import { v } from "convex/values";
import { gatedMutation, scopedMutation } from "./gated";

/**
 * Per-clinic weekly plan: sales can set a target orders/week and revenue/week
 * for a clinic. Stored here (app state); the analytics service reads the plans
 * and serves the list with each clinic's current weekly rate (analytics/plan.ts).
 */

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
