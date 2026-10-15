import { v } from "convex/values";
import { drill, type ClinicRow } from "./clinics";
import { addDays } from "./dateUtils";
import { scopedQuery } from "./gated";
import { loadCfg } from "./config";
import { newClinicPace } from "./newPace";

/**
 * "What's working" companion to the shortfall RCA tree. Same clinic rows
 * `drill()` already computes (expected vs actual, orders, bundleDelta,
 * newGroups) — just re-sliced into positive-framed leaderboards instead of
 * the deficit-first tree. Requested by Shyam 2026-09-04 so sales sees
 * momentum/wins with the same weight as the drag list, not as a footnote.
 */

type WinRow = {
  clinic: string;
  name: string;
  state: string;
};

function slim(r: ClinicRow): WinRow {
  return { clinic: r.clinic, name: r.name, state: r.state };
}

export const winsSummary = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cur = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      teamLead: args.teamLead,
      sales: args.sales,
    });
    if (!cur.ready) return { ready: false as const };

    // Comeback list only makes sense for a week-shaped window, where we can
    // look at the immediately preceding week for the same clinics.
    let prevRows: ClinicRow[] | null = null;
    if (args.periodId.startsWith("w:")) {
      const wkStart = args.periodId.slice(2);
      const prevId = `w:${addDays(wkStart, -7)}`;
      const prev = await drill(ctx, {
        periodId: prevId,
        lens: "total",
        unlimited: true,
        teamLead: args.teamLead,
        sales: args.sales,
      });
      if (prev.ready) prevRows = prev.rows;
    }

    const rows = cur.rows;
    // New clinics have ~$0 baseline, so "delta >= 0" always counted them as
    // beating. Use the same on-pace/overdue rule as the shortfall tree
    // (Shyam, 2026-09-30: "logic should be consistent across the pages").
    const cfg = await loadCfg(ctx);
    const isNew = (r: ClinicRow) => r.newGroups.length > 0;
    const { onPace } = newClinicPace(rows.filter(isNew), cfg?.currentEnd ?? "");
    const ok = (r: ClinicRow) => (isNew(r) ? onPace.has(r.clinic) : true);
    const beaters = rows.filter(r => ok(r) && r.delta >= 0);
    const beatersRevenue = beaters.reduce((s, r) => s + r.delta, 0);

    const momentumAll = rows
      .filter(r => ok(r) && r.delta > 0 && r.orders > r.expectedOrders)
      .sort((a, b) => b.delta - a.delta);
    const momentum = momentumAll.slice(0, 15).map(r => ({
      ...slim(r),
      delta: r.delta,
      orderDelta: r.orders - r.expectedOrders,
    }));

    const newLogos = rows.filter(r => r.newGroups.length > 0);
    const newLogoRevenue = newLogos.reduce((s, r) => s + r.actual, 0);

    const bundleGainersAll = rows
      .filter(r => r.bundleDelta > 0)
      .sort((a, b) => b.bundleDelta - a.bundleDelta);
    const bundleGainers = bundleGainersAll.slice(0, 15).map(r => ({
      ...slim(r),
      bundleDelta: r.bundleDelta,
      bundleShare: r.bundleShare,
      baseBundleShare: r.baseBundleShare,
    }));

    let comebackAll: Array<
      WinRow & { prevDelta: number; curDelta: number; swing: number }
    > = [];
    if (prevRows) {
      const prevByClinic = new Map(prevRows.map(r => [r.clinic, r]));
      comebackAll = rows
        .filter(r => ok(r) && r.delta >= 0)
        .filter(r => (prevByClinic.get(r.clinic)?.delta ?? 0) < 0)
        .map(r => {
          const p = prevByClinic.get(r.clinic);
          const prevDelta = p ? p.delta : 0;
          return { ...slim(r), prevDelta, curDelta: r.delta, swing: r.delta - prevDelta };
        })
        .sort((a, b) => b.swing - a.swing);
    }
    const comeback = comebackAll.slice(0, 15);

    return {
      ready: true as const,
      totalCount: rows.length,
      beatersCount: beaters.length,
      beatersRevenue,
      beatersShare: rows.length ? beaters.length / rows.length : 0,
      // Full clinic-id lists behind each card (not just the top-15 shown),
      // so clicking a card can open the same standard clinic drill table
      // (all the usual columns) scoped to exactly this cohort, via the
      // `ids:` focus already used by the business-feed "show these clinics"
      // links. Requested by Shyam 2026-09-04.
      beatersIds: beaters.map(r => r.clinic),
      momentum,
      momentumIds: momentumAll.map(r => r.clinic),
      newLogos: newLogos.map(r => ({ ...slim(r), actual: r.actual })),
      newLogoCount: newLogos.length,
      newLogoRevenue,
      newLogoIds: newLogos.map(r => r.clinic),
      bundleGainers,
      bundleGainerIds: bundleGainersAll.map(r => r.clinic),
      comeback,
      comebackIds: comebackAll.map(r => r.clinic),
      comebackAvailable: prevRows !== null,
    };
  },
});
