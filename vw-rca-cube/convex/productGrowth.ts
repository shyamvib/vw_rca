import { v } from "convex/values";
import { scopedMutation, scopedQuery } from "./gated";

/** Product whitespace flags: which clinics a rep marked eligible for a product family (app state). */
export const eligible = scopedQuery({
  args: { sales: v.optional(v.string()) },
  handler: async (ctx, { sales }) => {
    if (!sales) return [];
    const rows = await ctx.db.query("productEligible").withIndex("by_sales", q => q.eq("sales", sales)).collect();
    return rows.map(r => ({ clinic: r.clinic, family: r.family }));
  },
});

export const toggleEligible = scopedMutation({
  args: { sales: v.optional(v.string()), clinic: v.string(), family: v.string() },
  handler: async (ctx, { sales, clinic, family }) => {
    if (!sales) throw new Error("Pick a rep first.");
    const rows = await ctx.db.query("productEligible").withIndex("by_sales", q => q.eq("sales", sales)).collect();
    const hit = rows.find(r => r.clinic === clinic && r.family === family);
    if (hit) await ctx.db.delete(hit._id);
    else await ctx.db.insert("productEligible", { sales, clinic, family, at: Date.now() });
  },
});
