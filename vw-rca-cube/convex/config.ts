import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Viewer } from "./gated";
import { internal } from "./_generated/api";
import { gatedMutation, scopedMutation, scopedQuery } from "./gated";

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

/** Rep logins can pick their own date window (Shyam, 2026-09-25): each rep's
 * window is a full refresh written under its own gen + config key. */
export const repCfgKey = (email: string) => `rep:${email.trim().toLowerCase()}`;

export function viewerCfgKey(ctx: unknown): string | undefined {
  const pinned = (ctx as { __cfgKey?: string }).__cfgKey;
  if (pinned) return pinned;
  const v = (ctx as { viewer?: Viewer }).viewer;
  if (!v) return undefined;
  // Reps and signed-in team users each get their own window row.
  return v.email ? repCfgKey(v.email) : undefined;
}

/** Explicit key → exactly that row (snapshots). Otherwise a rep's own window
 * once it has been computed, falling back to the team window. */
export async function loadCfg(ctx: { db: QueryCtx["db"] }, explicit?: string) {
  const byKey = (k: string) =>
    ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", k))
      .unique();
  if (explicit) return await byKey(explicit);
  const rk = viewerCfgKey(ctx);
  if (rk) {
    const r = await byKey(rk);
    if (r && r.gen) return r;
  }
  return await byKey("main");
}

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

export const get = scopedQuery({
  args: {},
  handler: async ctx => {
    const row = await loadCfg(ctx);
    return row ?? { ...DEFAULTS, _id: null };
  },
});

/**
 * Hands out a fresh generation number and records it immediately, so a refresh
 * that dies mid-write never leaves rows a later refresh would reuse (that bug
 * stacked five copies of every fact row in production).
 */
export const reserveGen = internalMutation({
  args: { lease: v.optional(v.boolean()) },
  handler: async (ctx, { lease }): Promise<number> => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const next = Math.max(row?.gen ?? 0, row?.genSeq ?? 0) + 1;
    if (row) await ctx.db.patch(row._id, { genSeq: next });
    if (lease) {
      await ctx.db.insert("generationLeases", { gen: next, createdAt: Date.now() });
    }
    return next;
  },
});

export const write = internalMutation({
  args: {
    currentStart: v.string(),
    baselineStart: v.string(),
    baselineEnd: v.string(),
    currentEnd: v.string(),
    lagDays: v.number(),
    autoBaseline: v.boolean(),
    autoEnd: v.boolean(),
    baselineMode: v.optional(v.string()),
    annualTarget: v.optional(v.number()),
    p75: v.optional(
      v.object({ day: v.array(v.number()), week: v.number(), month: v.number() }),
    ),
    gen: v.optional(v.number()),
    genSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (row) await ctx.db.patch(row._id, args);
    else await ctx.db.insert("config", { key: "main", ...args });
  },
});

/**
 * Writes a config row under a non-"main" key — used for historical insight
 * snapshots (Shyam, 2026-09-23) so a backfilled weekly/monthly window never
 * touches the live dashboard's config row. `build()`/`drill()` accept a
 * `configKey` to read this instead of "main" when computing that snapshot.
 */
export const writeSnapshot = internalMutation({
  args: {
    key: v.string(),
    currentStart: v.string(),
    baselineStart: v.string(),
    baselineEnd: v.string(),
    currentEnd: v.string(),
    lagDays: v.number(),
    autoBaseline: v.boolean(),
    autoEnd: v.boolean(),
    baselineMode: v.optional(v.string()),
    p75: v.optional(
      v.object({ day: v.array(v.number()), week: v.number(), month: v.number() }),
    ),
    gen: v.number(),
    genSeq: v.number(),
  },
  handler: async (ctx, { key, ...args }) => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, args);
    else await ctx.db.insert("config", { key, ...args });
  },
});

/** User-facing window change: only stores intent; a refresh recomputes derived data. */
export const setWindow = gatedMutation({
  args: {
    currentStart: v.string(),
    currentEnd: v.optional(v.string()),
    autoEnd: v.boolean(),
    lagDays: v.number(),
    baselineMode: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (args.currentEnd && args.currentEnd < args.currentStart) {
      throw new Error("Window end must be after the start date.");
    }
    const patch = {
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

/** Year-end revenue target (dollars). Cheap: no refresh needed, applied at read time. */
export const setTarget = gatedMutation({
  args: { annualTarget: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.annualTarget) || args.annualTarget <= 0) {
      throw new Error("Target must be a positive number.");
    }
    const row = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    if (row) await ctx.db.patch(row._id, { annualTarget: args.annualTarget });
    else
      await ctx.db.insert("config", {
        ...DEFAULTS,
        annualTarget: args.annualTarget,
      });
  },
});

// ---------------------------------------------------------------------------
// Rep-picked date windows (Shyam, 2026-09-25). A rep's window is a full
// recompute (refreshSnapshot in rep mode) kept under "rep:<email>" with its own
// gen; loadCfg() serves it to that rep only. The team window is untouched.

async function repRow(ctx: { db: QueryCtx["db"] }, key: string) {
  return await ctx.db
    .query("config")
    .withIndex("by_key", q => q.eq("key", key))
    .unique();
}

/** The signed-in rep's window state (null for team viewers). */
export const repWindow = scopedQuery({
  args: {},
  handler: async ctx => {
    const key = viewerCfgKey(ctx);
    if (!key) return null;
    const r = await repRow(ctx, key);
    if (!r) return { status: "none" as const };
    return {
      status: (r.status ?? "ready") as "running" | "ready" | "error" | "none",
      reqStart: r.reqStart ?? null,
      reqEnd: r.reqEnd ?? null,
      hasData: !!r.gen,
      currentStart: r.gen ? r.currentStart : null,
      currentEnd: r.gen ? r.currentEnd : null,
      error: r.error ?? null,
    };
  },
});

export const setRepWindow = scopedMutation({
  args: { currentStart: v.string(), currentEnd: v.string() },
  handler: async (ctx, { currentStart, currentEnd }) => {
    const key = viewerCfgKey(ctx);
    if (!key) throw new Error("Sign out and back in to pick your own dates.");
    const main = await repRow(ctx, "main");
    const latest = main?.currentEnd ?? currentEnd;
    const end = currentEnd > latest ? latest : currentEnd;
    // Ending on the latest data date means "keep following the latest data".
    const followLatest = currentEnd >= latest;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentStart) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new Error("Pick valid dates.");
    }
    if (end < currentStart) throw new Error("End date must be after the start date.");
    if (currentStart < "2025-01-01") throw new Error("Start date must be in 2025 or later.");
    const r = await repRow(ctx, key);
    if (r?.status === "ready" && r.gen && r.currentStart === currentStart && r.currentEnd === end) {
      if (r.followLatest !== followLatest) await ctx.db.patch(r._id, { followLatest });
      return { queued: false };
    }
    const requestAt = Date.now();
    if (r?.status === "running" && r.requestedAt && Date.now() - r.requestedAt < 10 * 60_000) {
      if (r.reqStart === currentStart && r.reqEnd === end) return { queued: false };
    }
    const patch = {
      status: "running",
      reqStart: currentStart,
      reqEnd: end,
      followLatest,
      requestedAt: requestAt,
      error: undefined,
    };
    if (r) await ctx.db.patch(r._id, patch);
    else
      await ctx.db.insert("config", {
        ...DEFAULTS,
        key,
        gen: 0,
        ...patch,
      });
    await ctx.scheduler.runAfter(0, internal.refresh.refreshSnapshot, {
      asOf: end,
      cadence: "weekly",
      repKey: key,
      start: currentStart,
      requestAt,
    });
    return { queued: true };
  },
});

/** Back to the team window: drop the rep's own computation. */
export const clearRepWindow = scopedMutation({
  args: {},
  handler: async ctx => {
    const key = viewerCfgKey(ctx);
    if (!key) return;
    const r = await repRow(ctx, key);
    if (!r) return;
    const gen = r.gen;
    await ctx.db.delete(r._id);
    if (gen) await ctx.scheduler.runAfter(0, internal.ingest.deleteGen, { gen });
  },
});

export const finishRepWindow = internalMutation({
  args: {
    key: v.string(),
    currentStart: v.string(),
    currentEnd: v.string(),
    baselineStart: v.string(),
    baselineEnd: v.string(),
    baselineMode: v.string(),
    p75: v.optional(
      v.object({ day: v.array(v.number()), week: v.number(), month: v.number() }),
    ),
    gen: v.number(),
    reqStart: v.string(),
    reqEnd: v.string(),
    requestAt: v.optional(v.number()),
  },
  handler: async (ctx, { key, reqStart, reqEnd, requestAt, ...args }): Promise<boolean> => {
    const r = await repRow(ctx, key);
    // Rep reset or re-picked meanwhile: this result is stale — discard it.
    const stale = !r || r.reqStart !== reqStart || r.reqEnd !== reqEnd ||
      (requestAt !== undefined && r.requestedAt !== requestAt);
    if (stale) {
      await ctx.scheduler.runAfter(0, internal.ingest.deleteGen, { gen: args.gen });
      return false;
    }
    const old = r.gen;
    await ctx.db.patch(r._id, {
      ...args,
      lagDays: 0,
      autoBaseline: true,
      autoEnd: false,
      genSeq: args.gen,
      status: "ready",
      error: undefined,
    });
    if (old && old !== args.gen) {
      await ctx.scheduler.runAfter(0, internal.ingest.deleteGen, { gen: old });
    }
    return true;
  },
});

export const failRepWindow = internalMutation({
  args: { key: v.string(), error: v.string(), requestAt: v.optional(v.number()) },
  handler: async (ctx, { key, error, requestAt }) => {
    const r = await repRow(ctx, key);
    if (r && (requestAt === undefined || r.requestedAt === requestAt)) {
      await ctx.db.patch(r._id, { status: "error", error });
    }
  },
});

/** After the nightly team refresh: recompute every rep window on fresh data. */
export const requeueRepWindows = internalMutation({
  args: {},
  handler: async ctx => {
    const rows = (await ctx.db.query("config").collect()).filter(
      r => r.key.startsWith("rep:") && r.reqStart && r.reqEnd,
    );
    const latest = (await repRow(ctx, "main"))?.currentEnd;
    let delay = 60_000;
    for (const r of rows) {
      const requestAt = Date.now();
      // Windows that ended on the latest data date follow it forward.
      const end =
        r.followLatest && latest && latest > r.reqEnd! ? latest : r.reqEnd!;
      await ctx.db.patch(r._id, {
        status: "running",
        requestedAt: requestAt,
        reqEnd: end,
      });
      await ctx.scheduler.runAfter(delay, internal.refresh.refreshSnapshot, {
        asOf: end,
        cadence: "weekly",
        repKey: r.key,
        start: r.reqStart!,
        requestAt,
      });
      delay += 60_000;
    }
  },
});
