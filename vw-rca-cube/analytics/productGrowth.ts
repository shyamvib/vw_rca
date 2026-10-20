import { v } from "convex/values";
import { internal } from "./_generated/api";
import { viewerCfgKey } from "./config";
import { periodRange } from "./families";
import { scopedAction } from "./gated";
import { eq, ordersRows, rows as cubeRows } from "./cube";
import { dow, eachDay, windowP75 } from "./dateUtils";
import { familyOf, num, splitFamilies, TABLE } from "./powerbi";

/**
 * Product Growth pillar (Shyam, 2026-10-06): per-clinic product-family mix
 * for the rep's book — in the selected window and lifetime (2025-01-01 → end).
 * Feeds Product adoption (new clinics on 2+ families), Repeat product rate
 * (clinic×family pairs reordered in the window) and Product whitespace
 * (rep-marked eligible clinics that never ordered the family).
 */
export type PGClinic = { clinic: string; name: string; win: Record<string, number>; life: Record<string, number>; rev?: Record<string, number>;
  /** orders per family over the baseline period */
  base?: Record<string, number>;
  /** revenue per family over the baseline period (split evenly when an order spans families) */
  baseRev?: Record<string, number>;
  /** the window's share of the clinic's baseline (expected orders = base x share) */
  share?: number;
  isNew?: boolean;
  /** Portfolio Changes status per test (STOPPED / DECLINING / RESTARTED / NEW), last 28 days vs the prior 90 */
  tests?: Array<[string, string]>;
};

export const productGrowth = scopedAction({
  args: { periodId: v.string(), sales: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ready: boolean; start?: string; end?: string; baseWeeks?: number; clinics: PGClinic[] }> => {
    if (!args.sales) return { ready: false, clinics: [] };
    const cfgKey = viewerCfgKey(ctx);
    const key = (cfgKey ?? "") + `pg4|${args.periodId}|${args.sales}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const { cfg, clinics, goal } = await ctx.runQuery(internal.families.context, { cfgKey, periodId: args.periodId });
    if (!cfg) return { ready: false, clinics: [] };
    const mine = (clinics as Array<{ clinic: string; name: string; sales: string }>).filter(
      c => c.sales === args.sales && /^\d+$/.test(c.clinic),
    );
    if (!mine.length) return { ready: true, clinics: [] };
    const { start, end, days } = periodRange(args.periodId, cfg.currentStart, cfg.currentEnd);
    const ids = eq("rfm_orders.clinic_id", ...mine.map(c => c.clinic));
    const q = (s: string, e: string) =>
      ordersRows({ by: ["clinic_id"], family: true, start: s, end: e, m: { ord: "orders", rev: "revenue" }, filters: [ids] });
    const [win, life, baseRows, status] = await Promise.all([
      q(start, end),
      q("2025-01-01", cfg.currentEnd),
      q(cfg.baselineStart, cfg.baselineEnd),
      // Test-level movement for this book's clinics; without it the lists still work from orders vs expected.
      cubeRows(
        { dimensions: ["portfolio_changes.clinic_id", "portfolio_changes.test_name", "portfolio_changes.status"], filters: [eq("portfolio_changes.clinic_id", ...mine.map(c => Number(c.clinic)))] },
        { "portfolio_changes.clinic_id": "Portfolio Changes[Clinic Id]", "portfolio_changes.test_name": "Portfolio Changes[Test Name]", "portfolio_changes.status": "Portfolio Changes[Status]" },
      ).catch(() => [] as Array<Record<string, unknown>>),
    ]);
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
    // Expected orders per family = baseline-period orders x the window's share of the clinic's baseline (same as the clinic card).
    const meta = new Map((clinics as Array<{ clinic: string; rev: number[]; baseRev: number; isNew?: boolean }>).map(c => [c.clinic, c]));
    const gfR = goal?.rev ?? windowP75(cfg);
    const baseDays = eachDay(cfg.baselineStart, cfg.baselineEnd);
    for (const r of baseRows) {
      const c = acc.get(String(r[`${TABLE}[clinic_id]`] ?? ""));
      if (!c) continue;
      c.base ??= {};
      const fs = splitFamilies(familyOf(r));
      c.baseRev ??= {};
      for (const f of fs) {
        c.base[f] = (c.base[f] ?? 0) + num(r, "ord");
        c.baseRev[f] = (c.baseRev[f] ?? 0) + num(r, "rev") / fs.length;
      }
    }
    for (const c of acc.values()) {
      const m = meta.get(c.clinic);
      c.isNew = !!m?.isNew;
      let share = baseDays.length ? days.length / baseDays.length : 0;
      if (m?.baseRev) {
        let exp = 0, baseTot = 0;
        for (const d of days) exp += m.rev[dow(d)] * gfR;
        for (const d of baseDays) baseTot += m.rev[dow(d)];
        share = baseTot ? exp / baseTot : 0;
      }
      c.share = share;
    }
    for (const r of status) {
      const c = acc.get(String(r["Portfolio Changes[Clinic Id]"] ?? ""));
      const st = String(r["Portfolio Changes[Status]"] ?? "").trim();
      const test = String(r["Portfolio Changes[Test Name]"] ?? "").trim();
      if (!c || !st || st === "null" || !test) continue;
      (c.tests ??= []).push([test, st]);
    }
    const out = { ready: true, start, end, baseWeeks: baseDays.length / 7, clinics: [...acc.values()].filter(c => Object.keys(c.life).length || Object.keys(c.base ?? {}).length) };
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(out) });
    return out;
  },
});
