/**
 * Baseline vs Goal (Shyam, 2026-10-16).
 *
 *  Baseline  mean run rate over the baseline window, by weekday. Means add up, so a clinic's baseline summed over
 *            clinics, cohorts, reps, leads, states or the company is the same number, and a clinic with any
 *            baseline orders has a baseline above zero.
 *  Goal      the Settings annual target spread over the year by baseline weekday weights (changed 2026-10-16;
 *            it was the company rolling P75, now kept as a benchmark, p75Revenue). Every entity's goal is its
 *            baseline x one factor per period, goalFactor = goal / baseline, so goals add up over entities AND
 *            over time, and are the same for the same days in any period kind. The target is applied at read
 *            time (targetScale), so changing it in Settings re-bases every goal without a rebuild.
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

type GoalRow = { target?: number; yearBaseRevenue?: number; tShare?: number };

/** Multiplier taking the goal stored at refresh (built with row.target) to the goal for the current Settings target. */
export function targetScaleOf(row: GoalRow | null | undefined, targetNow: number | undefined): number {
  if (!row || !row.target || !row.yearBaseRevenue || row.tShare === undefined || !targetNow) return 1;
  const m = (t: number) => row.tShare! * (t / row.yearBaseRevenue!) + (1 - row.tShare!);
  return m(targetNow) / m(row.target);
}

/** The Settings target lives on the shared "main" config row; a rep's own window row can hold a stale copy. */
export async function mainTarget(ctx: { db: QueryCtx["db"] }): Promise<number | undefined> {
  const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "main")).unique();
  return row?.annualTarget;
}

/** Same multiplier, looked up by period; 1 when the snapshot has no goal row. */
export async function targetScale(
  ctx: { db: QueryCtx["db"] },
  cfg: { gen?: number; annualTarget?: number } | null | undefined,
  periodId: string,
): Promise<number> {
  if (!cfg) return 1;
  const row = await ctx.db
    .query("periodGoal")
    .withIndex("by_gen_period", q => q.eq("gen", cfg.gen ?? 0).eq("periodId", periodId))
    .first();
  return targetScaleOf(row, await mainTarget(ctx));
}

export async function goalFactors(
  ctx: { db: QueryCtx["db"] },
  cfg: { gen?: number; annualTarget?: number; baselineMode?: string; p75?: { day: number[]; week: number; month: number } | null },
  periodId: string,
): Promise<GoalFactors> {
  const row = await ctx.db
    .query("periodGoal")
    .withIndex("by_gen_period", q => q.eq("gen", cfg.gen ?? 0).eq("periodId", periodId))
    .first();
  if (row && row.baseRevenue > 0) {
    const k = targetScaleOf(row, await mainTarget(ctx));
    return {
      rev: (row.goalRevenue * k) / row.baseRevenue,
      ord: row.baseOrders > 0 ? (row.goalOrders * k) / row.baseOrders : (row.goalRevenue * k) / row.baseRevenue,
      baseRevenue: row.baseRevenue,
      goalRevenue: row.goalRevenue * k,
      baseOrders: row.baseOrders,
      goalOrders: row.goalOrders * k,
      found: true,
    };
  }
  const f = windowP75(cfg);
  return { rev: f, ord: f, baseRevenue: 0, goalRevenue: 0, baseOrders: 0, goalOrders: 0, found: false };
}
