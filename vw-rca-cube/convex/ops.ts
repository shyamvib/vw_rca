/**
 * Operational records the analytics service writes back to Convex.
 * Internal: called with the deployment admin key.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const recordRefresh = internalMutation({
  args: {
    startedAt: v.number(),
    finishedAt: v.number(),
    status: v.string(),
    scope: v.optional(v.string()),
    message: v.string(),
    dataThrough: v.optional(v.string()),
    rows: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("refreshLog", args);
    // Keep the log small: only the most recent 200 entries matter.
    const old = await ctx.db.query("refreshLog").withIndex("by_started").order("desc").collect();
    for (const r of old.slice(200)) await ctx.db.delete(r._id);
  },
});
