import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { scopedQuery } from "./gated";
import { loadCfg } from "./config";
import { ordersRows } from "./cube";
import { dateOf, familyOf, num, splitFamilies } from "./powerbi";
import { addDays } from "./dateUtils";

/**
 * New product releases (Shyam, 2026-10-16). A product family is "new" when its first order is recent: the
 * expected-orders logic (a baseline window's run rate) is not fair to a family that was still ramping up
 * or did not exist during the baseline. Rule, one place:
 *   - first order within the last NEW_WITHIN_DAYS of the data end, and
 *   - not at the very start of the data (DATA_START + buffer): those families only look new because the
 *     history we pull begins there.
 */
export const DATA_START = "2025-01-01";
export const NEW_WITHIN_DAYS = 365;
const LEFT_CENSOR_BUFFER_DAYS = 14;

/** Snapshot build step: first order date and order count per family, straight from Cube. */
export const build = internalAction({
  args: { end: v.optional(v.string()) },
  handler: async (ctx, { end }) => {
    const through = end ?? new Date().toISOString().slice(0, 10);
    const rows = await ordersRows({ family: true, day: true, m: { ord: "orders" }, start: DATA_START, end: through });
    const acc = new Map<string, { first: string; orders: number }>();
    for (const r of rows) {
      const d = dateOf(r, "order_date");
      const n = num(r, "ord");
      if (!d || n <= 0) continue;
      for (const f of splitFamilies(familyOf(r))) {
        const a = acc.get(f);
        if (!a) acc.set(f, { first: d, orders: n });
        else {
          if (d < a.first) a.first = d;
          a.orders += n;
        }
      }
    }
    const out = [...acc].map(([family, a]) => ({ family, firstOrder: a.first, orders: a.orders }));
    await ctx.runMutation(internal.familyLaunch.put, { rows: out });
    return { families: out.length };
  },
});

export const put = internalMutation({
  args: { rows: v.array(v.object({ family: v.string(), firstOrder: v.string(), orders: v.number() })) },
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("familyLaunch").collect()) await ctx.db.delete(old._id);
    for (const r of rows) await ctx.db.insert("familyLaunch", r);
  },
});

/** Launch info per family for the scorecard: first order date, days live, and whether it counts as new. */
export const launches = scopedQuery({
  args: {},
  handler: async ctx => {
    const cfg = await loadCfg(ctx);
    const rows = await ctx.db.query("familyLaunch").collect();
    if (!cfg || !rows.length) return { ready: false as const, launches: [] as Array<{ family: string; firstOrder: string; daysLive: number; isNew: boolean }> };
    const asOf = cfg.currentEnd;
    const newSince = addDays(asOf, -NEW_WITHIN_DAYS);
    const atStart = addDays(DATA_START, LEFT_CENSOR_BUFFER_DAYS);
    const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    return {
      ready: true as const,
      launches: rows.map(r => ({
        family: r.family,
        firstOrder: r.firstOrder,
        daysLive: days(r.firstOrder, asOf) + 1,
        isNew: r.firstOrder >= newSince && r.firstOrder > atStart && r.family !== "Unmapped",
      })),
    };
  },
});
