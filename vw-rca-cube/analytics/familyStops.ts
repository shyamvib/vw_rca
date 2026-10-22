/**
 * Gut Zoomer / Total Tox stopped-clinic lists (Shyam, 2026-10-13).
 *
 * Portfolio-status STOPPED rule, re-run per calendar month so the trend can
 * be read May → latest complete month:
 *   as-of   = last day of the month
 *   recent  = the 30 days ending on the as-of date
 *   prior   = the 90 days immediately before the recent window
 *   STOPPED = ≥3 orders of the family in the prior 90 days AND 0 in the
 *             recent 30 (same ≥3 / 0 thresholds as Power BI's
 *             'Portfolio Changes' table, which only carries "today").
 * An order counts for a family when any of its test lines carries that
 * product_family (distinct sample_id), so combo orders count once per family.
 *
 * Rebuilt (replace-all) after each live refresh; NOT gen-scoped. Small:
 * ~400 clinics × ~5 months.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { addDays } from "./dateUtils";
import { gatedQuery } from "./gated";
import { eq, O, ordersRows, rows as cubeRows } from "./cube";
import { TABLE } from "./powerbi";
import { growthFor, type PGClinic } from "./productGrowth";
import { MIN_BASE_ORDERS, MIN_EXPECTED_ORDERS } from "./families";

export const STOP_FAMILIES = ["Gut Zoomer", "Total Tox"] as const;
const FIRST_MONTH = "2026-05";
const RECENT_DAYS = 30;
const PRIOR_DAYS = 90;
const MIN_PRIOR = 3;

const monthEnd = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};
const nextMonth = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Months whose as-of date has full data (month end ≤ data end). */
export function stopMonths(dataEnd: string): string[] {
  const out: string[] = [];
  for (let ym = FIRST_MONTH; monthEnd(ym) <= dataEnd; ym = nextMonth(ym)) out.push(ym);
  return out;
}

export function windowsOf(ym: string) {
  const asOf = monthEnd(ym);
  const recentStart = addDays(asOf, -(RECENT_DAYS - 1));
  const priorEnd = addDays(recentStart, -1);
  const priorStart = addDays(recentStart, -PRIOR_DAYS);
  return { asOf, recentStart, priorStart, priorEnd };
}

/** Orders (distinct sample_id) per clinic-day whose family combination contains `fam` (DAX CONTAINSSTRING equivalent). */
const famDaily = (fam: string, start: string, end: string) =>
  ordersRows({ by: ["clinic_id"], day: true, start, end, m: { n: "orders" },
    filters: [{ member: `${O}.product_family`, operator: "contains", values: [fam] }] });

const rowSpec = {
  month: v.string(),
  family: v.string(),
  clinic: v.string(),
  name: v.string(),
  state: v.string(),
  sales: v.string(),
  teamLead: v.optional(v.string()),
  priorOrders: v.number(),
  lastOrder: v.string(),
  resumedOn: v.string(),
  priorStart: v.string(),
  recentStart: v.string(),
  asOf: v.string(),
};

export const identityFor = internalQuery({
  args: { clinics: v.array(v.string()) },
  handler: async (ctx, { clinics }) => {
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const gen = cfg?.gen ?? 0;
    const out: Record<string, { name: string; state: string; sales: string; teamLead?: string }> = {};
    for (const c of clinics) {
      const rows = await ctx.db
        .query("clinicMeta")
        .withIndex("by_clinic", q => q.eq("clinic", c))
        .collect();
      const m = rows.find(r => (r.gen ?? 0) === gen) ?? rows[rows.length - 1];
      if (m) out[c] = { name: m.name, state: m.state, sales: m.sales, teamLead: m.teamLead };
    }
    return { out, dataEnd: (cfg?.currentEnd as string | undefined) ?? "" };
  },
});

export const replaceAll = internalMutation({
  args: { rows: v.array(v.object(rowSpec)), clear: v.boolean() },
  handler: async (ctx, { rows, clear }) => {
    if (clear) {
      const old = await ctx.db.query("familyStops").collect();
      for (const r of old) await ctx.db.delete(r._id);
    }
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("familyStops", { ...r, builtAt: now });
  },
});

export const rebuild = internalAction({
  args: { dataEnd: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { dataEnd: cfgEnd } = await ctx.runQuery(internal.familyStops.identityFor, { clinics: [] });
    const dataEnd = args.dataEnd ?? cfgEnd;
    if (!dataEnd) return { months: 0, rows: 0 };
    const months = stopMonths(dataEnd);
    if (!months.length) return { months: 0, rows: 0 };

    // clinic|family -> date -> orders, from the first prior window to data end.
    const pullStart = windowsOf(months[0]).priorStart;
    const series = new Map<string, Map<string, number>>();
    let s = pullStart;
    while (s <= dataEnd) {
      const e0 = addDays(s, 44) < dataEnd ? addDays(s, 44) : dataEnd;
      for (const fam of STOP_FAMILIES) {
        for (const r of await famDaily(fam, s, e0)) {
          const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
          const date = String(r[`${TABLE}[order_date]`] ?? "").slice(0, 10);
          const n = Number(r["[n]"] ?? 0);
          if (!clinic || !date || !n) continue;
          const key = `${clinic}|${fam}`;
          const m = series.get(key) ?? new Map<string, number>();
          m.set(date, (m.get(date) ?? 0) + n);
          series.set(key, m);
        }
      }
      s = addDays(e0, 1);
    }

    type Hit = {
      month: string; family: string; clinic: string; priorOrders: number; lastOrder: string;
      resumedOn: string; priorStart: string; recentStart: string; asOf: string;
    };
    const hits: Hit[] = [];
    for (const ym of months) {
      const w = windowsOf(ym);
      for (const [key, days] of series) {
        let prior = 0;
        let recent = 0;
        let last = "";
        let resumed = "";
        for (const [d, n] of days) {
          if (d >= w.priorStart && d <= w.priorEnd) {
            prior += n;
            if (d > last) last = d;
          } else if (d >= w.recentStart && d <= w.asOf) recent += n;
          else if (d > w.asOf && (!resumed || d < resumed)) resumed = d;
        }
        if (prior >= MIN_PRIOR && recent === 0) {
          const [clinic, family] = key.split("|");
          hits.push({ month: ym, family, clinic, priorOrders: prior, lastOrder: last, resumedOn: resumed, priorStart: w.priorStart, recentStart: w.recentStart, asOf: w.asOf });
        }
      }
    }

    // Identity: the dashboard's own clinicMeta first (same owner attribution
    // as every other list); clinics outside the current roster via DAX.
    const ids = [...new Set(hits.map(h => h.clinic))];
    const ident: Record<string, { name: string; state: string; sales: string; teamLead?: string }> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { out } = await ctx.runQuery(internal.familyStops.identityFor, { clinics: ids.slice(i, i + 200) });
      Object.assign(ident, out);
    }
    const missing = ids.filter(c => !ident[c]);
    if (missing.length) {
      const users = new Map<string, string>();
      for (const r of await cubeRows({ dimensions: ["internal_user.internal_user_id", "internal_user.name"] }, {
        "internal_user.internal_user_id": "internal_user[internal_user_id]",
        "internal_user.name": "internal_user[internal_user_name]",
      })) {
        const id = String(r["internal_user[internal_user_id]"] ?? "");
        const nm = String(r["internal_user[internal_user_name]"] ?? "");
        if (id && nm && nm !== "null") users.set(id, nm);
      }
      for (let i = 0; i < missing.length; i += 150) {
        const rows = await ordersRows({
          by: ["clinic_id", "customer_practice_name", "state", "team_lead", "sales_id"],
          start: pullStart, end: dataEnd, m: { ord: "orders" },
          filters: [eq(`${O}.clinic_id`, ...missing.slice(i, i + 150))],
        });
        const best = new Map<string, { ord: number; r: Record<string, unknown> }>();
        for (const r of rows) {
          const c = String(r[`${TABLE}[clinic_id]`] ?? "");
          const o = Number(r["[ord]"] ?? 0);
          if (!best.has(c) || best.get(c)!.ord < o) best.set(c, { ord: o, r });
        }
        for (const [c, { r }] of best) {
          const sid = String(r[`${TABLE}[sales_id]`] ?? "").trim();
          const tl = String(r[`${TABLE}[team_lead]`] ?? "").trim();
          ident[c] = {
            name: String(r[`${TABLE}[customer_practice_name]`] ?? `Clinic ${c}`),
            state: String(r[`${TABLE}[state]`] ?? "(blank)"),
            sales: !sid || sid === "null" ? "—" : (users.get(sid) ?? `Sales ${sid}`),
            teamLead: tl && tl !== "null" ? tl : undefined,
          };
        }
      }
    }

    const rows = hits.map(h => {
      const id = ident[h.clinic];
      return {
        ...h,
        name: id?.name ?? `Clinic ${h.clinic}`,
        state: id?.state ?? "(blank)",
        sales: id?.sales ?? "—",
        ...(id?.teamLead ? { teamLead: id.teamLead } : {}),
      };
    });
    for (let i = 0; i < Math.max(rows.length, 1); i += 1000) {
      await ctx.runMutation(internal.familyStops.replaceAll, { rows: rows.slice(i, i + 1000), clear: i === 0 });
    }
    return { months: months.length, rows: rows.length };
  },
});

/**
 * Shared reader for the feed card and the list modal.
 * Shyam 2026-10-13: show only clinics that STAYED stopped (no order of the
 * family since the stop, i.e. resumedOn empty) and list each clinic|family
 * once, under the first month it stopped and never came back.
 * Raw month rows stay in the table for audit.
 */
export async function loadStops(ctx: { db: QueryCtx["db"] }, teamLead?: string) {
  const all = await ctx.db.query("familyStops").collect();
  const scoped = teamLead ? all.filter(r => r.teamLead === teamLead) : all;
  const first = new Map<string, (typeof scoped)[number]>();
  for (const r of scoped) {
    if (r.resumedOn) continue;
    const k = `${r.clinic}|${r.family}`;
    const cur = first.get(k);
    if (!cur || r.month < cur.month) first.set(k, r);
  }
  return [...first.values()];
}

export const list = gatedQuery({
  args: { teamLead: v.optional(v.string()) },
  handler: async (ctx, { teamLead }) => {
    const rows = await loadStops(ctx, teamLead);
    const months = [...new Set(rows.map(r => r.month))].sort();
    const cfg = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "main")).unique();
    return {
      months,
      dataEnd: (cfg?.currentEnd as string | undefined) ?? "",
      rule: `STOPPED = ≥${MIN_PRIOR} orders in the ${PRIOR_DAYS} days before, 0 in the last ${RECENT_DAYS} days (as of month end), and no order since; listed under the month it first stopped`,
      rows: rows.map(r => ({
        month: r.month,
        family: r.family,
        clinic: r.clinic,
        name: r.name,
        state: r.state,
        sales: r.sales,
        teamLead: r.teamLead ?? "",
        priorOrders: r.priorOrders,
        lastOrder: r.lastOrder,
        resumedOn: r.resumedOn,
        priorStart: r.priorStart,
        recentStart: r.recentStart,
        asOf: r.asOf,
      })),
    };
  },
});


const DECLINE_FAMILIES = ["Gut Zoomer"];
const STATUS_RANK = ["STOPPED", "DECLINING", "RESTARTED", "NEW"];

/** Still ordering the family in the window, and either flagged DECLINING or below the orders its baseline implies (the scorecard's rule). */
export function declineOf(c: PGClinic, fam: string): { orders: number; expected: number; status: string } | null {
  const orders = c.win[fam] ?? 0;
  if (orders <= 0) return null;
  const f = fam.toLowerCase();
  const hit = (c.tests ?? []).filter(([t]) => t.toLowerCase().startsWith(f)).map(([, st]) => st);
  const status = STATUS_RANK.find(st => hit.includes(st)) ?? "";
  const base = c.base?.[fam] ?? 0;
  const expected = c.isNew || base < MIN_BASE_ORDERS ? 0 : base * (c.share ?? 0);
  return status === "DECLINING" || (expected >= MIN_EXPECTED_ORDERS && orders < expected) ? { orders, expected, status } : null;
}

export const declineRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query("config").withIndex("by_key", q => q.eq("key", "main")).unique();
    const gen = cfg?.gen ?? 0;
    const meta = await ctx.db.query("clinicMeta").withIndex("by_gen", q => q.eq("gen", gen)).collect();
    const leads = [...new Set(meta.map(m => m.teamLead ?? "—").filter(l => l && l !== "—"))];
    const byClinic: Record<string, { name: string; state: string; sales: string; teamLead?: string }> = {};
    for (const m of meta) byClinic[m.clinic] = { name: m.name, state: m.state, sales: m.sales, teamLead: m.teamLead };
    return { leads, byClinic, asOf: (cfg?.currentEnd as string | undefined) ?? "" };
  },
});

export const replaceDecline = internalMutation({
  args: { rows: v.array(v.object({ family: v.string(), clinic: v.string(), name: v.string(), state: v.string(), sales: v.string(), teamLead: v.optional(v.string()), orders: v.number(), expected: v.number(), status: v.string(), asOf: v.string() })) },
  handler: async (ctx, { rows }) => {
    for (const r of await ctx.db.query("familyDecline").collect()) await ctx.db.delete(r._id);
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("familyDecline", { ...r, builtAt: now });
  },
});

/**
 * Clinics still ordering a family but below what their baseline expects (or flagged DECLINING by Portfolio Changes): the
 * scorecard's product-list rule (3+ baseline orders, 1+ expected in the window, a clinic new this year has none) applied
 * to each team's book over the whole analysis window. Stopped clinics are left to familyStops.
 */
export const rebuildDecline = internalAction({
  args: {},
  handler: async (ctx): Promise<{ leads: number; rows: number }> => {
    const { leads, byClinic, asOf }: { leads: string[]; byClinic: Record<string, { name: string; state: string; sales: string; teamLead?: string }>; asOf: string } = await ctx.runQuery(internal.familyStops.declineRows, {});
    const out: Array<{ family: string; clinic: string; name: string; state: string; sales: string; teamLead?: string; orders: number; expected: number; status: string; asOf: string }> = [];
    const seen = new Set<string>();
    for (const lead of leads) {
      const pg = await growthFor(ctx, { periodId: "all", sales: `team:${lead}`, noCache: true });
      for (const c of pg.clinics) {
        const id = byClinic[c.clinic];
        if (!id || id.teamLead !== lead) continue;
        for (const fam of DECLINE_FAMILIES) {
          const d = declineOf(c, fam);
          if (!d || seen.has(`${c.clinic}|${fam}`)) continue;
          seen.add(`${c.clinic}|${fam}`);
          out.push({ family: fam, clinic: c.clinic, name: id.name, state: id.state, sales: id.sales, ...(id.teamLead ? { teamLead: id.teamLead } : {}), orders: d.orders, expected: d.expected, status: d.status, asOf });
        }
      }
    }
    await ctx.runMutation(internal.familyStops.replaceDecline, { rows: out });
    return { leads: leads.length, rows: out.length };
  },
});
