/**
 * Inputs for the Growth page that are not already on the scorecard (company-wide, so team logins only).
 */
import { internal } from "./_generated/api";
import { viewerCfgKey } from "./config";
import { ordersRows } from "./cube";
import { addDays } from "./dateUtils";
import { gatedAction, gatedQuery } from "./gated";
import { loadLapsed } from "./gzLapsed";
import { TABLE } from "./powerbi";

/** Clinics that ordered Gut Zoomer last year and not this year, with what they ordered. Empty until the daily rebuild has run. */
export const lapsed = gatedQuery({
  args: {},
  handler: async ctx => {
    const rows = await loadLapsed(ctx);
    return {
      ready: rows.length > 0,
      year: rows[0]?.year ?? null,
      rows: rows.map(r => ({
        clinic: r.clinic, name: r.name, state: r.state, sales: r.sales, orders: r.orders, lastOrder: r.lastOrder, otherOrders: r.otherOrders,
        revenue: r.revenue ?? 0, revenueThis: r.revenueThis ?? 0, gzRevenue: r.gzRevenue,
      })),
    };
  },
});

export type ProviderClinic = { clinic: string; providers: number; active: number; dormant: number; dormantRevenue: number };

/**
 * Clinics where several providers have ordered over two years but only some still do (2026-11). A provider is a customer of the clinic.
 * Candidates: 3+ providers ordered in the last 24 months, the clinic itself ordered in the last 90 days, and 2+ providers have not ordered in
 * those 90 days. `dormantRevenue` is what those dormant providers brought in a year, from their last 24 months. Pure, for the tests.
 */
export function providerCandidates(
  all: Array<{ clinic: string; provider: string; orders: number; revenue: number }>,
  recent: Array<{ clinic: string; provider: string; orders: number }>,
): ProviderClinic[] {
  const active = new Set(recent.filter(r => r.orders > 0).map(r => `${r.clinic}|${r.provider}`));
  const by = new Map<string, { providers: number; active: number; dormant: number; rev: number }>();
  for (const r of all) {
    if (!r.clinic || !r.provider || r.orders <= 0) continue;
    const x = by.get(r.clinic) ?? { providers: 0, active: 0, dormant: 0, rev: 0 };
    x.providers += 1;
    if (active.has(`${r.clinic}|${r.provider}`)) x.active += 1;
    else {
      x.dormant += 1;
      x.rev += r.revenue / 2;
    }
    by.set(r.clinic, x);
  }
  return [...by]
    .filter(([, x]) => x.providers >= 3 && x.active >= 1 && x.dormant >= 2)
    .map(([clinic, x]) => ({ clinic, providers: x.providers, active: x.active, dormant: x.dormant, dormantRevenue: Math.round(x.rev) }));
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const providers = gatedAction({
  args: {},
  handler: async (ctx): Promise<{ ready: true; rows: ProviderClinic[] }> => {
    const end = dayOf(Date.now());
    const key = `${viewerCfgKey(ctx) ?? ""}gprov1|${end}`;
    const hit: string | null = await ctx.runQuery(internal.ingest.getCache, { key });
    if (hit) return JSON.parse(hit);
    const [all, recent] = await Promise.all([
      ordersRows({ by: ["clinic_id", "customer_id"], start: addDays(end, -729), end, m: { n: "orders", rev: "revenue" } }),
      ordersRows({ by: ["clinic_id", "customer_id"], start: addDays(end, -89), end, m: { n: "orders" } }),
    ]);
    const cl = (r: Record<string, unknown>) => String(r[`${TABLE}[clinic_id]`] ?? "");
    const pr = (r: Record<string, unknown>) => String(r[`${TABLE}[customer_id]`] ?? "");
    const num = (r: Record<string, unknown>, k: string) => (typeof r[`[${k}]`] === "number" ? (r[`[${k}]`] as number) : 0);
    const result = {
      ready: true as const,
      rows: providerCandidates(
        all.map(r => ({ clinic: cl(r), provider: pr(r), orders: num(r, "n"), revenue: num(r, "rev") })),
        recent.map(r => ({ clinic: cl(r), provider: pr(r), orders: num(r, "n") })),
      ),
    };
    await ctx.runMutation(internal.ingest.putCache, { key, payload: JSON.stringify(result) });
    return result;
  },
});
