import { v } from "convex/values";
import { internal } from "./_generated/api";
import { viewerCfgKey } from "./config";
import { periodRange } from "./families";
import { scopedAction, scopedMutation, scopedQuery } from "./gated";
import { eq, ordersRows } from "./cube";
import { familyOf, num, splitFamilies, TABLE } from "./powerbi";

/**
 * Product Growth pillar (Shyam, 2026-10-06): per-clinic product-family mix
 * for the rep's book — in the selected window and lifetime (2025-01-01 → end).
 * Feeds Product adoption (new clinics on 2+ families), Repeat product rate
 * (clinic×family pairs reordered in the window) and Product whitespace
 * (rep-marked eligible clinics that never ordered the family).
 */
export type PGClinic = { clinic: string; name: string; win: Record<string, number>; life: Record<string, number>; rev?: Record<string, number> };

export const productGrowth = scopedAction({
  args: { periodId: v.string(), sales: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ready: boolean; start?: string; end?: string; clinics: PGClinic[] }> => {
    if (!args.sales) return { ready: false, clinics: [] };
    const cfgKey = viewerCfgKey(ctx);
    const key = (cfgKey ?? "") + `pg2|${args.periodId}|${args.sales}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const { cfg, clinics } = await ctx.runQuery(internal.families.context, { cfgKey, periodId: args.periodId });
    if (!cfg) return { ready: false, clinics: [] };
    const mine = (clinics as Array<{ clinic: string; name: string; sales: string }>).filter(
      c => c.sales === args.sales && /^\d+$/.test(c.clinic),
    );
    if (!mine.length) return { ready: true, clinics: [] };
    const { start, end } = periodRange(args.periodId, cfg.currentStart, cfg.currentEnd);
    const ids = eq("rfm_orders.clinic_id", ...mine.map(c => c.clinic));
    const q = (s: string, e: string) =>
      ordersRows({ by: ["clinic_id"], family: true, start: s, end: e, m: { ord: "orders", rev: "revenue" }, filters: [ids] });
    const [win, life] = await Promise.all([q(start, end), q("2025-01-01", cfg.currentEnd)]);
    const acc = new Map<string, PGClinic>(mine.map(c => [c.clinic, { clinic: c.clinic, name: c.name, win: {}, life: {}, rev: {} }]));
    const add = (rows: Record<string, unknown>[], field: "win" | "life") => {
      for (const r of rows) {
        const c = acc.get(String(r[`${TABLE}[clinic_id]`] ?? ""));
        if (!c) continue;
        const fs = splitFamilies(familyOf(r));
        for (const f of fs) {
          c[field][f] = (c[field][f] ?? 0) + num(r, "ord");
          if (field === "win" && c.rev) c.rev[f] = (c.rev[f] ?? 0) + num(r, "rev") / fs.length;
        }
      }
    };
    add(win, "win");
    add(life, "life");
    const out = { ready: true, start, end, clinics: [...acc.values()].filter(c => Object.keys(c.life).length) };
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(out) });
    return out;
  },
});

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
