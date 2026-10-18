import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { gatedMutation, scopedMutation, scopedQuery } from "./gated";

/**
 * User-edited settings only (Phase 3: Convex holds app state, the analytics
 * service computes everything else). The "main" row carries the analysis
 * window and the annual target; the analytics service reads it when it
 * rebuilds its snapshot, and applies the target at read time.
 */
export const DEFAULTS = {
  key: "main",
  currentStart: "2026-05-01",
  baselineStart: "2026-01-16",
  baselineEnd: "2026-04-30",
  currentEnd: "2026-08-13",
  lagDays: 1,
  autoBaseline: true,
  autoEnd: true,
  baselineMode: "p75",
  annualTarget: 130_000_000,
  gen: 0,
};

export const getInternal = internalQuery({
  args: {},
  handler: async ctx => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    return row ?? { ...DEFAULTS, _id: null };
  },
});

/** User-facing window change: only stores intent; the next rebuild recomputes the data. */
export const setWindow = gatedMutation({
  args: {
    currentStart: v.string(),
    currentEnd: v.optional(v.string()),
    autoEnd: v.boolean(),
    lagDays: v.number(),
    baselineMode: v.string(),
    baselineSource: v.optional(v.string()),
    baselineStart: v.optional(v.string()),
    baselineEnd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (args.currentEnd && args.currentEnd < args.currentStart) {
      throw new Error("Window end must be after the start date.");
    }
    const source = args.baselineSource ?? "best";
    if (!["trailing", "best", "custom"].includes(source)) throw new Error("Unknown baseline source.");
    if (source === "custom") {
      if (!args.baselineStart || !args.baselineEnd) throw new Error("Pick a baseline start and end date.");
      if (args.baselineEnd < args.baselineStart) throw new Error("Baseline end must be after its start.");
      if (args.baselineEnd >= args.currentStart) throw new Error("The baseline must end before the analysis window starts.");
      if (args.baselineStart < "2025-01-01") throw new Error("Baseline start must be in 2025 or later.");
    }
    const patch = {
      baselineSource: source,
      ...(source === "custom" ? { baselineStart: args.baselineStart!, baselineEnd: args.baselineEnd! } : {}),
      currentStart: args.currentStart,
      currentEnd: args.currentEnd ?? row?.currentEnd ?? DEFAULTS.currentEnd,
      autoEnd: args.autoEnd,
      lagDays: args.lagDays,
      autoBaseline: true,
      baselineMode: args.baselineMode,
    };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("config", { ...DEFAULTS, ...patch });
  },
});

/** Year-end revenue target (dollars). Cheap: no rebuild needed, applied at read time. */
export const setTarget = gatedMutation({
  args: { annualTarget: v.number(), newBusinessGoal: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.annualTarget) || args.annualTarget <= 0) {
      throw new Error("Target must be a positive number.");
    }
    if (args.newBusinessGoal !== undefined && (!Number.isFinite(args.newBusinessGoal) || args.newBusinessGoal < 0 || args.newBusinessGoal > args.annualTarget)) {
      throw new Error("The new-business goal must be between 0 and the target.");
    }
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (row) await ctx.db.patch(row._id, { annualTarget: args.annualTarget, ...(args.newBusinessGoal === undefined ? {} : { newBusinessGoal: args.newBusinessGoal }) });
    else await ctx.db.insert("config", { ...DEFAULTS, annualTarget: args.annualTarget });
  },
});

// Personal date windows are gone (reps and team share the one window), so the
// picker has nothing to show. These keep the existing UI calls well-typed.
export const repWindow = scopedQuery({
  args: {},
  handler: async () =>
    null as null | {
      status: "none" | "running" | "ready" | "error";
      reqStart: string | null;
      reqEnd: string | null;
      hasData: boolean;
      currentStart: string | null;
      currentEnd: string | null;
      error: string | null;
    },
});

export const setRepWindow = scopedMutation({
  args: { currentStart: v.string(), currentEnd: v.string() },
  handler: async () => {
    throw new Error("Personal date windows are no longer available; everyone uses the shared window.");
  },
});

export const clearRepWindow = scopedMutation({
  args: {},
  handler: async () => undefined,
});
