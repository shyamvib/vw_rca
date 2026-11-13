/**
 * Inputs for the Growth page that are not already on the scorecard (company-wide, so team logins only).
 */
import { gatedQuery } from "./gated";
import { loadLapsed } from "./gzLapsed";

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
