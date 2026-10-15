import { v } from "convex/values";
import { gatedQuery } from "./gated";

/**
 * $400 Foundation Zoomer launch target list (Shyam, 2026-09-15): clinics
 * whose VA-only order behaviour (trailing 12 months, refreshed alongside
 * everything else) shows they already pay a premium price point for VA
 * panels and order often enough to be a live outreach target — not a
 * one-off Excel pull, so thresholds can move without re-pulling data.
 *
 * "VA order" = an order made of only VA-type test lines
 * (`sample_test_type_v2 = "VA"` on the orders table — matches the dataset's
 * own [VA Orders] measure exactly, see engineering notes 2026-09-15).
 */
export const targetList = gatedQuery({
  args: {
    // Minimum average VA order value over the window. Defaults to Shyam's
    // $275 threshold for the $400 panel launch.
    minAov: v.optional(v.number()),
    // Minimum VA order cadence, in orders/week over the window. Defaults to
    // Shyam's 3/wk floor (2026-09-15) — cuts noise from clinics with only a
    // stray high-value VA order.
    minOrdersPerWeek: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        clinic: v.string(),
        name: v.string(),
        state: v.string(),
        sales: v.string(),
        teamLead: v.string(),
        vaOrders: v.number(),
        vaRevenue: v.number(),
        vaAov: v.number(),
        ordersPerWeek: v.number(),
        allOrders: v.number(),
        allRevenue: v.number(),
      }),
    ),
    totalClinics: v.number(),
    totalVaRevenue: v.number(),
    totalVaOrders: v.number(),
    windowDays: v.number(),
    minAov: v.number(),
    minOrdersPerWeek: v.number(),
  }),
  handler: async (ctx, args) => {
    const minAov = args.minAov ?? 275;
    const minOrdersPerWeek = args.minOrdersPerWeek ?? 3;
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const gen = cfg?.gen ?? 0;
    const raw = await ctx.db
      .query("vaClinicTarget")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    const windowDays = raw[0]?.windowDays ?? 365;
    const weeks = windowDays / 7;
    const rows = raw
      .map(r => ({
        clinic: r.clinic,
        name: r.name,
        state: r.state,
        sales: r.sales,
        teamLead: r.teamLead,
        vaOrders: r.vaOrders,
        vaRevenue: Math.round(r.vaRevenue * 100) / 100,
        vaAov: r.vaOrders ? Math.round((r.vaRevenue / r.vaOrders) * 100) / 100 : 0,
        ordersPerWeek: Math.round((r.vaOrders / weeks) * 100) / 100,
        allOrders: r.allOrders,
        allRevenue: Math.round(r.allRevenue * 100) / 100,
      }))
      .filter(r => r.vaAov >= minAov && r.ordersPerWeek >= minOrdersPerWeek)
      .sort((a, b) => b.vaRevenue - a.vaRevenue);
    return {
      rows,
      totalClinics: rows.length,
      totalVaRevenue: Math.round(rows.reduce((s, r) => s + r.vaRevenue, 0)),
      totalVaOrders: rows.reduce((s, r) => s + r.vaOrders, 0),
      windowDays,
      minAov,
      minOrdersPerWeek,
    };
  },
});
