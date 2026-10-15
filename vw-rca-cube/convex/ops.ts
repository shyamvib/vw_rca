/**
 * Operational records the analytics service writes back to Convex.
 * Internal: called with the deployment admin key.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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

/** The analytics service announces its public URL here (quick tunnels change URL on restart). */
export const setServiceUrl = internalMutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const row = await ctx.db.query("appMeta").withIndex("by_key", q => q.eq("key", "serviceUrl")).unique();
    if (row) await ctx.db.patch(row._id, { value: url, updatedAt: Date.now() });
    else await ctx.db.insert("appMeta", { key: "serviceUrl", value: url, updatedAt: Date.now() });
  },
});

/** Where the browser finds the analytics service when VITE_RCA_API_URL isn't baked in. Public: the URL is not a secret, the service checks credentials itself. */
export const serviceUrl = query({
  args: {},
  handler: async ctx => {
    const row = await ctx.db.query("appMeta").withIndex("by_key", q => q.eq("key", "serviceUrl")).unique();
    return row?.value ?? null;
  },
});
