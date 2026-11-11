import { v } from "convex/values";
import { internal } from "./_generated/api";
import { viewerCfgKey } from "./config";
import { eq, O, ordersRows } from "./cube";
import { gatedAction } from "./gated";
import { dateOf, num, splitFamilies } from "./powerbi";
import { isCompanyLead } from "./scope";

/**
 * Weekly and monthly trend of every product family, from the first day of the current year to today. It is independent of the
 * analysis window and of the baseline: it reads the orders straight from Cube, so the Overview family cards can draw a trend
 * whatever period they are showing. An order that carries several families counts once under each, its revenue split evenly
 * (the same rule as the family lists).
 */
export type TrendBucket = { k: string; start: string; end: string; partial: boolean };
export type FamilyTrend = {
  start: string;
  end: string;
  weeks: TrendBucket[];
  months: TrendBucket[];
  /** per family: orders and revenue for each week / month, in the order of `weeks` / `months` */
  series: Record<string, { wOrd: number[]; wRev: number[]; mOrd: number[]; mRev: number[] }>;
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** The Monday of the week a day falls in. */
const monday = (d: string) => day(ms(d) - ((new Date(ms(d)).getUTCDay() + 6) % 7) * 86_400_000);
const addDays = (d: string, n: number) => day(ms(d) + n * 86_400_000);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => day(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0));

/** Buckets covering start..end: each with its first and last day, flagged partial when it is cut by the range at either edge. */
export function buckets(start: string, end: string, grain: "week" | "month"): TrendBucket[] {
  const out: TrendBucket[] = [];
  let s = grain === "week" ? monday(start) : monthStart(start);
  while (s <= end) {
    const e = grain === "week" ? addDays(s, 6) : monthEnd(s);
    out.push({ k: s, start: s < start ? start : s, end: e > end ? end : e, partial: s < start || e > end });
    s = addDays(e, 1);
  }
  return out;
}

export function buildTrend(
  data: Array<{ d: string; family: string; ord: number; rev: number }>,
  start: string,
  end: string,
): FamilyTrend {
  const weeks = buckets(start, end, "week");
  const months = buckets(start, end, "month");
  const wAt = new Map(weeks.map((b, i) => [b.k, i]));
  const mAt = new Map(months.map((b, i) => [b.k, i]));
  const series: FamilyTrend["series"] = {};
  for (const r of data) {
    if (r.d < start || r.d > end) continue;
    const fams = splitFamilies(r.family);
    const wi = wAt.get(monday(r.d));
    const mi = mAt.get(monthStart(r.d));
    for (const f of fams) {
      const s = (series[f] ??= {
        wOrd: weeks.map(() => 0),
        wRev: weeks.map(() => 0),
        mOrd: months.map(() => 0),
        mRev: months.map(() => 0),
      });
      if (wi !== undefined) {
        s.wOrd[wi] += r.ord;
        s.wRev[wi] += r.rev / fams.length;
      }
      if (mi !== undefined) {
        s.mOrd[mi] += r.ord;
        s.mRev[mi] += r.rev / fams.length;
      }
    }
  }
  return { start, end, weeks, months, series };
}

export const familyTrend = gatedAction({
  args: { teamLead: v.optional(v.string()) },
  handler: async (ctx, args): Promise<FamilyTrend> => {
    const end = day(Date.now());
    const start = `${end.slice(0, 4)}-01-01`;
    const lead = args.teamLead && !isCompanyLead(args.teamLead) ? args.teamLead : "";
    const key = (viewerCfgKey(ctx) ?? "") + `ftrend1|${end}|${lead}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const rows = await ordersRows({
      family: true,
      day: true,
      m: { ord: "orders", rev: "revenue" },
      start,
      end,
      filters: lead ? [eq(`${O}.team_lead`, lead)] : [],
    });
    const data = rows.map(r => ({
      d: dateOf(r, "order_date"),
      family: String(r["fact_order_tests_enriched[product_family]"] ?? "").trim() || "Unmapped",
      ord: num(r, "ord"),
      rev: num(r, "rev"),
    }));
    const result = buildTrend(data, start, end);
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(result) });
    return result;
  },
});
