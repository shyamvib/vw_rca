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
 *  New business goal (2026-10-18): the annual target is split into an existing-business goal and a new-business goal, a
 *            Settings number (default 5% of the target). Existing clinics' factor uses (target - new-business goal) over
 *            the older clinics' baseline pace; new clinics have no baseline and share the new-business goal as a group,
 *            spread over the year by the same baseline weekday weights and over reps by baseline share:
 *            newGoal(scope, period) = newGoal x tShare x baseline(scope, period) / yearBaseline.
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
  /** The company's new-business goal for the period (a slice of the target; group level). */
  newGoalRevenue: number;
  /** false when the snapshot has no periodGoal row (older build): falls back to the window P75 multiplier. */
  found: boolean;
};

type GoalRow = {
  target?: number;
  newSlice?: number;
  yearBaseRevenue?: number;
  tShare?: number;
  /** Company share of the year's new-business goal falling in this period (last year's monthly shape). */
  newShare?: number;
  /** 12 monthly shares of the year's new-business goal (last year's new-clinic revenue by month). */
  newPhasing?: number[];
  /** Last year's revenue from clinics that were new that year: the default new-business goal. */
  newDefaultSlice?: number;
  baseRevenue?: number;
};

/** Share of the target given to new business when there is neither a Settings number nor a prior year to anchor on. */
export const DEFAULT_NEW_SHARE = 0.05;
/** `newGoalExplicit` is the Settings number; without one the new-business goal is last year's new-clinic revenue. */
export type GoalSettings = { target?: number; newGoalExplicit?: number };

export function sliceOf(row: GoalRow | null | undefined, st: GoalSettings | undefined): number {
  if (st?.newGoalExplicit !== undefined) return st.newGoalExplicit;
  if (row?.newDefaultSlice) return row.newDefaultSlice;
  return st?.target ? DEFAULT_NEW_SHARE * st.target : 0;
}

/** Multiplier taking the existing-business goal stored at refresh to the one for the current Settings (target and new-business goal). */
export function targetScaleOf(row: GoalRow | null | undefined, st: GoalSettings | undefined): number {
  if (!row || !row.target || !row.yearBaseRevenue || row.tShare === undefined || !st?.target) return 1;
  const m = (t: number, slice: number) => row.tShare! * ((t - slice) / row.yearBaseRevenue!) + (1 - row.tShare!);
  const then = m(row.target, row.newSlice ?? 0);
  return then > 0 ? m(st.target, sliceOf(row, st)) / then : 1;
}

/** Share of a (full) set of days of the target year taken by the new-business goal, phased by last year's monthly shape. */
export function newShareOver(phasing: number[] | undefined, days: string[], year: number): number | undefined {
  if (!phasing || phasing.length !== 12) return undefined;
  let s = 0;
  for (const d of days) {
    if (Number(d.slice(0, 4)) !== year) continue;
    const m = Number(d.slice(5, 7));
    s += phasing[m - 1] / new Date(Date.UTC(year, m, 0)).getUTCDate();
  }
  return s;
}

/** The new-business goal for one scope (company, lead, rep) and period, given the scope's baseline in that period. */
export function newGoalOf(row: GoalRow | null | undefined, st: GoalSettings | undefined, scopeBaseline: number): number {
  if (!row || !st?.target) return 0;
  const slice = sliceOf(row, st);
  if (!slice) return 0;
  if (row.newShare !== undefined && row.baseRevenue) return (slice * row.newShare * scopeBaseline) / row.baseRevenue;
  if (!row.yearBaseRevenue || row.tShare === undefined) return 0;
  return (slice * row.tShare * scopeBaseline) / row.yearBaseRevenue;
}

/** The Settings target and new-business goal live on the shared "main" config row; a rep's own window row can hold a stale copy. */
export async function mainSettings(ctx: { db: QueryCtx["db"] }): Promise<GoalSettings> {
  const row = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "main")).unique();
  return { target: row?.annualTarget, newGoalExplicit: row?.newBusinessGoal };
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
  return targetScaleOf(row, await mainSettings(ctx));
}

/** The stored goal row for a period (the company's, with the target / new-business settings it was built with). */
export async function goalRowFor(ctx: { db: QueryCtx["db"] }, cfg: { gen?: number } | null | undefined, periodId: string) {
  if (!cfg) return null;
  return await ctx.db
    .query("periodGoal")
    .withIndex("by_gen_period", q => q.eq("gen", cfg.gen ?? 0).eq("periodId", periodId))
    .first();
}

/** New-business goal for a scope and period (0 when the snapshot has no goal row). */
export async function newGoalFor(
  ctx: { db: QueryCtx["db"] },
  cfg: { gen?: number } | null | undefined,
  periodId: string,
  scopeBaseline: number,
): Promise<number> {
  if (!cfg) return 0;
  const row = await ctx.db
    .query("periodGoal")
    .withIndex("by_gen_period", q => q.eq("gen", cfg.gen ?? 0).eq("periodId", periodId))
    .first();
  return newGoalOf(row, await mainSettings(ctx), scopeBaseline);
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
    const st = await mainSettings(ctx);
    const k = targetScaleOf(row, st);
    return {
      rev: (row.goalRevenue * k) / row.baseRevenue,
      ord: row.baseOrders > 0 ? (row.goalOrders * k) / row.baseOrders : (row.goalRevenue * k) / row.baseRevenue,
      baseRevenue: row.baseRevenue,
      goalRevenue: row.goalRevenue * k,
      baseOrders: row.baseOrders,
      goalOrders: row.goalOrders * k,
      newGoalRevenue: newGoalOf(row, st, row.baseRevenue),
      found: true,
    };
  }
  const f = windowP75(cfg);
  return { rev: f, ord: f, baseRevenue: 0, goalRevenue: 0, baseOrders: 0, goalOrders: 0, newGoalRevenue: 0, found: false };
}
