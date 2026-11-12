/**
 * Clinics that ordered Gut Zoomer last calendar year and have not ordered it this year (Shyam, 2026-11-11).
 *
 * "Last year" and "this year" follow the data's end date, so the list is 2025 against 2026 now and rolls to 2026 against 2027 in January.
 * An order counts for Gut Zoomer when its family combination contains it (the same rule as the stopped-clinic lists). Each clinic also
 * carries how many orders of any other product it placed this year, so a clinic that dropped Gut Zoomer can be told from one that has
 * gone entirely. Rebuilt (replace-all) after each live refresh, like familyStops; not gen-scoped.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { addDays } from "./dateUtils";
import { eq, O, ordersRows } from "./cube";
import { resolveIdentities } from "./familyStops";
import { TABLE } from "./powerbi";
import { isCompanyLead, isTeamScope, teamOf } from "./scope";

const GZ = "Gut Zoomer";
const gzFilter = { member: `${O}.product_family`, operator: "contains" as const, values: [GZ] };

const rowSpec = {
  clinic: v.string(),
  name: v.string(),
  state: v.string(),
  sales: v.string(),
  teamLead: v.optional(v.string()),
  year: v.number(),
  orders: v.number(),
  lastOrder: v.string(),
  otherOrders: v.number(),
  revenue: v.optional(v.number()),
  revenueThis: v.optional(v.number()),
};

export const replaceAll = internalMutation({
  args: { rows: v.array(v.object(rowSpec)), clear: v.boolean() },
  handler: async (ctx, { rows, clear }) => {
    if (clear) for (const r of await ctx.db.query("gzLapsed").collect()) await ctx.db.delete(r._id);
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("gzLapsed", { ...r, builtAt: now });
  },
});

/** The clinics (with their last-year Gut Zoomer orders and last order date) not in `thisYear`. Pure, for the tests. */
export function lapsedOf(
  lastYear: Array<{ clinic: string; date: string; n: number }>,
  thisYear: Set<string>,
): Array<{ clinic: string; orders: number; lastOrder: string }> {
  const by = new Map<string, { orders: number; lastOrder: string }>();
  for (const r of lastYear) {
    if (!r.clinic || !r.n || thisYear.has(r.clinic)) continue;
    const cur = by.get(r.clinic) ?? { orders: 0, lastOrder: "" };
    cur.orders += r.n;
    if (r.date > cur.lastOrder) cur.lastOrder = r.date;
    by.set(r.clinic, cur);
  }
  return [...by].map(([clinic, x]) => ({ clinic, ...x }));
}

export const rebuild = internalAction({
  args: { dataEnd: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ rows: number; year?: number }> => {
    const { dataEnd: cfgEnd } = await ctx.runQuery(internal.familyStops.identityFor, { clinics: [] });
    const dataEnd = args.dataEnd ?? cfgEnd;
    if (!dataEnd) return { rows: 0 };
    const year = Number(dataEnd.slice(0, 4));
    const prevStart = `${year - 1}-01-01`;
    const prevEnd = `${year - 1}-12-31`;
    const yearStart = `${year}-01-01`;

    // Last year's Gut Zoomer orders per clinic per day (the date gives the last order), pulled in 90-day pieces to keep each query small.
    const lastYear: Array<{ clinic: string; date: string; n: number }> = [];
    for (let s = prevStart; s <= prevEnd; ) {
      const e = addDays(s, 89) < prevEnd ? addDays(s, 89) : prevEnd;
      for (const r of await ordersRows({ by: ["clinic_id"], day: true, start: s, end: e, m: { n: "orders" }, filters: [gzFilter] }))
        lastYear.push({ clinic: String(r[`${TABLE}[clinic_id]`] ?? ""), date: String(r[`${TABLE}[order_date]`] ?? "").slice(0, 10), n: Number(r["[n]"] ?? 0) });
      s = addDays(e, 1);
    }
    // Clinics with a Gut Zoomer order this year so far.
    const thisYear = new Set<string>();
    for (const r of await ordersRows({ by: ["clinic_id"], start: yearStart, end: dataEnd, m: { n: "orders" }, filters: [gzFilter] }))
      if (Number(r["[n]"] ?? 0) > 0) thisYear.add(String(r[`${TABLE}[clinic_id]`] ?? ""));

    const lapsed = lapsedOf(lastYear, thisYear);
    const ids = lapsed.map(l => l.clinic);
    // For the lapsed clinics only: orders and total revenue (all products) this year so far, and total revenue last year.
    const other = new Map<string, { orders: number; revenue: number }>();
    const lastRev = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 150) {
      const inIds = [eq(`${O}.clinic_id`, ...ids.slice(i, i + 150))];
      for (const r of await ordersRows({ by: ["clinic_id"], start: yearStart, end: dataEnd, m: { n: "orders", rev: "revenue" }, filters: inIds }))
        other.set(String(r[`${TABLE}[clinic_id]`] ?? ""), { orders: Number(r["[n]"] ?? 0), revenue: Number(r["[rev]"] ?? 0) });
      for (const r of await ordersRows({ by: ["clinic_id"], start: prevStart, end: prevEnd, m: { rev: "revenue" }, filters: inIds }))
        lastRev.set(String(r[`${TABLE}[clinic_id]`] ?? ""), Number(r["[rev]"] ?? 0));
    }

    const ident = await resolveIdentities(ctx, ids, prevStart, dataEnd);
    const rows = lapsed.map(l => {
      const id = ident[l.clinic];
      return {
        clinic: l.clinic,
        name: id?.name ?? `Clinic ${l.clinic}`,
        state: id?.state ?? "(blank)",
        sales: id?.sales ?? "—",
        ...(id?.teamLead ? { teamLead: id.teamLead } : {}),
        year,
        orders: l.orders,
        lastOrder: l.lastOrder,
        otherOrders: other.get(l.clinic)?.orders ?? 0,
        revenue: Math.round(lastRev.get(l.clinic) ?? 0),
        revenueThis: Math.round(other.get(l.clinic)?.revenue ?? 0),
      };
    });
    for (let i = 0; i < Math.max(rows.length, 1); i += 1000) await ctx.runMutation(internal.gzLapsed.replaceAll, { rows: rows.slice(i, i + 1000), clear: i === 0 });
    return { rows: rows.length, year };
  },
});

/** The lapsed clinics for a scope: one rep (`sales`), a team ("team:<lead>" or the company), or a team lead name. */
export async function loadLapsed(ctx: { db: QueryCtx["db"] }, scope?: { sales?: string; teamLead?: string }) {
  const all = await ctx.db.query("gzLapsed").collect();
  const sales = scope?.sales;
  if (sales && isTeamScope(sales)) {
    const lead = teamOf(sales);
    return isCompanyLead(lead) ? all : all.filter(r => r.teamLead === lead);
  }
  if (sales) return all.filter(r => r.sales === sales);
  if (scope?.teamLead) return all.filter(r => r.teamLead === scope.teamLead);
  return all;
}
