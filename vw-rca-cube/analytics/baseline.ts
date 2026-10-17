/**
 * Baseline vs Goal (Shyam, 2026-10-16).
 *
 *  Baseline  mean run rate over the baseline window, by weekday. Means add up, so a clinic's baseline summed over
 *            clinics, cohorts, reps, leads, states or the company is the same number, and a clinic with any
 *            baseline orders has a baseline above zero.
 *  Goal      the company's rolling P75 for the period (the exact Power BI "strong period" measure). It is not a
 *            separate benchmark per entity: every entity's goal is its baseline x one factor per period,
 *            goalFactor = company goal / company baseline, so goals add up exactly too.
 *
 *  real change = actual - baseline        (what actually moved; additive)
 *  ambition    = goal - baseline          (the stretch above the baseline; additive, split by baseline share)
 *  shortfall vs goal = real change - ambition = actual - goal   (what the dashboard has always shown)
 */
import { windowP75 } from "./dateUtils";
import type { QueryCtx } from "./_generated/server";

export type GoalFactors = {
  /** goal / baseline for revenue and for orders */
  rev: number;
  ord: number;
  baseRevenue: number;
  goalRevenue: number;
  baseOrders: number;
  goalOrders: number;
  /** false when the snapshot has no periodGoal row (older build): falls back to the window P75 multiplier. */
  found: boolean;
};

export async function goalFactors(
  ctx: { db: QueryCtx["db"] },
  cfg: { gen?: number; baselineMode?: string; p75?: { day: number[]; week: number; month: number } | null },
  periodId: string,
): Promise<GoalFactors> {
  const row = await ctx.db
    .query("periodGoal")
    .withIndex("by_gen_period", q => q.eq("gen", cfg.gen ?? 0).eq("periodId", periodId))
    .first();
  if (row && row.baseRevenue > 0) {
    return {
      rev: row.goalRevenue / row.baseRevenue,
      ord: row.baseOrders > 0 ? row.goalOrders / row.baseOrders : row.goalRevenue / row.baseRevenue,
      baseRevenue: row.baseRevenue,
      goalRevenue: row.goalRevenue,
      baseOrders: row.baseOrders,
      goalOrders: row.goalOrders,
      found: true,
    };
  }
  const f = windowP75(cfg);
  return { rev: f, ord: f, baseRevenue: 0, goalRevenue: 0, baseOrders: 0, goalOrders: 0, found: false };
}
