import { targetScale } from "./baseline";
import { loadCfg } from "./config";
import { calibrate } from "./lifecycle";
import { v } from "convex/values";
import { drill } from "./clinics";
import { geoKeyOf } from "./geoKey";
import { gatedQuery, scopedQuery } from "./gated";

export { geoKeyOf };

/**
 * Geography view of the shortfall: every US state and every international
 * country a clinic bills from, with the regional sales managers that own the
 * clinics in it. Everything is derived from the clinic rows, so the map, the
 * RSM table and the clinic list below always agree with each other.
 */

export type GeoRow = {
  /** "us:CA" for a US state, "c:DE" for a country. */
  key: string;
  code: string;
  kind: "state" | "country";
  label: string;
  actual: number;
  expected: number;
  delta: number;
  orders: number;
  expectedOrders: number;
  clinics: number;
  /** Year-end run-rate projection for this geography: this state/country's
   * share of the trailing-13-week company run rate, applied to its own
   * year-to-date actuals, against its pro-rata slice of the annual target. */
  ytdRevenue: number;
  projectedClose: number;
  target: number;
  neededRemaining: number;
  rsms: Array<{
    name: string;
    delta: number;
    clinics: number;
    actual: number;
    ytdRevenue: number;
    projectedClose: number;
    target: number;
    neededRemaining: number;
  }>;
};

export const geoSummary = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    ready: boolean;
    rows: GeoRow[];
    total: number;
  }> => {
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      teamLead: args.teamLead,
      sales: args.sales,
    });
    if (!res.ready) return { ready: false, rows: [], total: 0 };

    // Year-end run-rate projection inputs, at clinic grain: each clinic's own
    // year-to-date revenue and its share of the trailing-13-week company run
    // rate, so any state or rep's projected close and revenue-still-needed
    // can be built the same way the year-end projection card is, just summed
    // over a different set of clinics.
    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    const annualTarget = cfg?.annualTarget ?? 130_000_000;
    const proj = await ctx.db
      .query("projection")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .first();
    // res.rows already carries every clinic's own ytdRevenue/fwdRevenue
    // (loaded once inside drill() off clinicMeta) — reuse it instead of a
    // second full clinicMeta.collect(), which was pushing this query over
    // Convex's 1s budget for the full-window "all" period.
    const companyFwdRev = res.rows.reduce((s, r) => s + (r.fwdRevenue ?? 0), 0);
    const remainingRev = proj ? proj.days.reduce((s, d) => s + d.rev, 0) : 0;
    // A clinic's projected close: its own YTD plus its slice of the
    // remaining-year curve, sized by its share of the trailing run rate.
    const projFor = (ytdRevenue: number, fwdRevenue: number) => {
      const share = companyFwdRev ? fwdRevenue / companyFwdRev : 0;
      const target = annualTarget * share;
      const projectedClose = ytdRevenue + remainingRev * share;
      return {
        target,
        projectedClose,
        neededRemaining: Math.max(0, target - ytdRevenue),
      };
    };

    type Acc = GeoRow & {
      fwdRevenue: number;
      reps: Map<
        string,
        {
          delta: number;
          clinics: number;
          actual: number;
          ytdRevenue: number;
          fwdRevenue: number;
        }
      >;
    };
    const byGeo = new Map<string, Acc>();
    for (const r of res.rows) {
      const g = geoKeyOf(r);
      const ytd = r.ytdRevenue ?? 0;
      const fwd = r.fwdRevenue ?? 0;
      let row = byGeo.get(g.key);
      if (!row) {
        row = {
          ...g,
          actual: 0,
          expected: 0,
          delta: 0,
          orders: 0,
          expectedOrders: 0,
          clinics: 0,
          ytdRevenue: 0,
          projectedClose: 0,
          target: 0,
          neededRemaining: 0,
          fwdRevenue: 0,
          rsms: [],
          reps: new Map(),
        };
        byGeo.set(g.key, row);
      }
      row.actual += r.actual;
      row.expected += r.expected;
      row.delta += r.delta;
      row.orders += r.orders;
      row.expectedOrders += r.expectedOrders;
      row.clinics += 1;
      row.ytdRevenue += ytd;
      row.fwdRevenue += fwd;
      const rep = row.reps.get(r.sales) ?? {
        delta: 0,
        clinics: 0,
        actual: 0,
        ytdRevenue: 0,
        fwdRevenue: 0,
      };
      rep.delta += r.delta;
      rep.actual += r.actual;
      rep.clinics += 1;
      rep.ytdRevenue += ytd;
      rep.fwdRevenue += fwd;
      row.reps.set(r.sales, rep);
    }

    // Top-down plan [Shyam, 2026-10-12]: geo expected = allocated share of
    // the company P75 (geo total, or sum of this scope's rep×geo cells), so
    // states add up to overall and reps add up to overall. Clinic P75 is not
    // summed here any more.
    const alloc = await ctx.db
      .query("geoPeriodBaseline")
      .withIndex("by_gen_period", q => q.eq("gen", gen).eq("periodId", args.periodId))
      .collect();
    if (alloc.length) {
      const cell = new Map(alloc.map(a => [`${a.geo}|${a.sales}`, a]));
      const scoped = !!(args.sales || args.teamLead);
      for (const row of byGeo.values()) {
        let er = 0, eo = 0;
        if (!scoped) {
          const t = cell.get(`${row.key}|`);
          er = t?.expectedRevenue ?? 0;
          eo = t?.expectedOrders ?? 0;
        }
        for (const [name, rep] of row.reps) {
          const c = cell.get(`${row.key}|${name}`);
          const cr = c?.expectedRevenue ?? 0;
          rep.delta = rep.actual - cr;
          if (scoped) {
            er += cr;
            eo += c?.expectedOrders ?? 0;
          }
        }
        row.expected = er;
        row.expectedOrders = eo;
        row.delta = row.actual - er;
      }
    }

    const rows: GeoRow[] = [...byGeo.values()].map(row => {
      const { reps, fwdRevenue, ...rest } = row;
      const p = projFor(rest.ytdRevenue, fwdRevenue);
      return {
        ...rest,
        ...p,
        rsms: [...reps]
          .map(([name, x]) => {
            const { fwdRevenue: repFwd, ...repRest } = x;
            return { name, ...repRest, ...projFor(x.ytdRevenue, repFwd) };
          })
          .sort((a, b) => a.delta - b.delta),
      };
    });
    rows.sort((a, b) => a.delta - b.delta);
    const total = rows.reduce((s, r) => s + r.delta, 0);
    return { ready: true, rows, total };
  },
});

/** Team leads present in the data, for the dashboard-wide filter. */
export const teamLeads = gatedQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const gen = cfg?.gen ?? 0;
    const meta = await ctx.db
      .query("clinicMeta")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    const set = new Set<string>();
    for (const m of meta) {
      const t = (m.teamLead ?? "—").trim();
      if (t && t !== "—") set.add(t);
    }
    return [...set].sort();
  },
});

/**
 * Sales-rep leaderboard for the "what's working" section: every rep with
 * activity in the window, ranked by how far they are above (or below) their
 * own baseline. Optionally scoped to one team lead's book, same as the rest
 * of the dashboard's team-lead filter. Requested by Shyam 2026-09-04 to sit
 * above the wins panel and let a rep click drive the rest of the page.
 */
export const salesReps = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    // Set automatically for rep logins: the leaderboard then holds only
    // that rep's own row.
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<
    Array<{
      name: string;
      actual: number;
      expected: number;
      delta: number;
      orders: number;
      clinics: number;
      teamLead: string;
    }>
  > => {
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      // Leaderboard only returns rep-level totals (no clinic rows), so rep
      // logins see every rep here; clinic data stays scoped elsewhere.
      teamLead: ctx.viewer.kind === "rep" ? undefined : args.teamLead,
      sales: ctx.viewer.kind === "rep" ? undefined : args.sales,
    });
    if (!res.ready) return [];
    type Acc = {
      name: string;
      actual: number;
      expected: number;
      delta: number;
      orders: number;
      clinics: number;
      teamLead: string;
      leads: Map<string, number>;
    };
    const byRep = new Map<string, Acc>();
    for (const r of res.rows) {
      const name = (r.sales ?? "—").trim() || "—";
      if (name === "—") continue;
      const row = byRep.get(name) ?? {
        name,
        actual: 0,
        expected: 0,
        delta: 0,
        orders: 0,
        clinics: 0,
        teamLead: "—",
        leads: new Map<string, number>(),
      };
      const tl = r.teamLead || "—";
      if (tl !== "—") row.leads.set(tl, (row.leads.get(tl) ?? 0) + 1);
      row.actual += r.actual;
      row.expected += r.expected;
      row.delta += r.delta;
      row.orders += r.orders;
      row.clinics += 1;
      byRep.set(name, row);
    }
    // Rep expected = top-down allocated plan (sum of rep×geo cells).
    const cfgL = await loadCfg(ctx);
    const sp = await ctx.db
      .query("salesPeriodBaseline")
      .withIndex("by_gen_period", q => q.eq("gen", cfgL?.gen ?? 0).eq("periodId", args.periodId))
      .collect();
    if (sp.length) {
      const k = await targetScale(ctx, cfgL, args.periodId);
      const by = new Map(sp.map(x => [x.sales, x.expectedRevenue * k]));
      for (const r of byRep.values()) {
        r.expected = by.get(r.name) ?? 0;
        r.delta = r.actual - r.expected;
      }
    }
    return [...byRep.values()]
      .map(({ leads, ...r }) => ({ ...r, teamLead: [...leads].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—" }))
      .sort((a, b) => b.delta - a.delta);
  },
});

/**
 * Headline numbers restricted to one team lead's book. Used to re-scope the
 * tree when the team-lead filter is on; the arithmetic mirrors the clinic
 * rows so the filtered tree and the filtered list agree.
 */
export const scopeTotals = scopedQuery({
  args: {
    periodId: v.string(),
    teamLead: v.optional(v.string()),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const res = await drill(ctx, {
      periodId: args.periodId,
      lens: "total",
      unlimited: true,
      teamLead: args.teamLead,
      sales: args.sales,
    });
    if (!res.ready) return { ready: false as const };
    let actual = 0,
      expected = 0,
      orders = 0,
      expectedOrders = 0,
      volume = 0,
      aovEffect = 0,
      bundleDelta = 0,
      nonBundleDelta = 0,
      patients = 0,
      expectedPatients = 0;
    const cohorts = new Map<string, { actual: number; expected: number; baseline: number; clinics: number }>();
    let baselineSum = 0;
    for (const r of res.rows) {
      actual += r.actual;
      orders += r.orders;
      bundleDelta += r.bundleDelta;
      nonBundleDelta += r.nonBundleDelta;
      patients += r.patients;
      expectedPatients += r.expectedPatients;
      const c = cohorts.get(r.cohort) ?? { actual: 0, expected: 0, baseline: 0, clinics: 0 };
      c.actual += r.actual;
      c.expected += r.expected;
      c.baseline += r.baseline;
      baselineSum += r.baseline;
      c.clinics += 1;
      cohorts.set(r.cohort, c);
    }
    // Rolling P75 baseline for this RSM's / team lead's own book: sourced
    // from leadPeriodBaseline/salesPeriodBaseline, which is the trailing
    // P75 of THIS SCOPE'S OWN aggregated daily revenue (computed at refresh
    // time) — not a sum of each clinic's individual baseline. Percentile
    // does not distribute over a sum, so summing clinic rows here would not
    // match what Power BI's RSM-filtered measure shows (validated 2026-09-28
    // against Andrea Whitmarsh, week Sep 7-13: sum-of-clinics diverges from
    // Power BI, this scope-level lookup matches it exactly).
    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    if (args.teamLead) {
      const row = await ctx.db
        .query("leadPeriodBaseline")
        .withIndex("by_gen_period", q =>
          q.eq("gen", gen).eq("periodId", args.periodId),
        )
        .filter(q => q.eq(q.field("lead"), args.teamLead))
        .unique();
      const k = await targetScale(ctx, cfg, args.periodId);
      expected = (row?.expectedRevenue ?? 0) * k;
      expectedOrders = (row?.expectedOrders ?? 0) * k;
    } else if (args.sales) {
      const row = await ctx.db
        .query("salesPeriodBaseline")
        .withIndex("by_gen_period", q =>
          q.eq("gen", gen).eq("periodId", args.periodId),
        )
        .filter(q => q.eq(q.field("sales"), args.sales))
        .unique();
      const k = await targetScale(ctx, cfg, args.periodId);
      expected = (row?.expectedRevenue ?? 0) * k;
      expectedOrders = (row?.expectedOrders ?? 0) * k;
    } else {
      // No scope filter — sum of clinic rows is fine here (this branch isn't
      // used by the dashboard today since scopeTotals is only queried with
      // one of teamLead/sales set, but kept as a safe fallback).
      for (const r of res.rows) {
        expected += r.expected;
        expectedOrders += r.expectedOrders;
      }
    }
    const scopeBaseAov = expectedOrders ? expected / expectedOrders : 0;
    volume = (orders - expectedOrders) * scopeBaseAov;
    aovEffect = actual - expected - volume;
    return {
      ready: true as const,
      clinics: res.rows.length,
      actual,
      expected,
      delta: actual - expected,
      baseline: baselineSum,
      realChange: actual - baselineSum,
      ambition: expected - baselineSum,
      orders,
      expectedOrders,
      volume,
      aovEffect,
      bundleDelta,
      nonBundleDelta,
      patients,
      expectedPatients,
      aov: orders ? actual / orders : 0,
      baseAov: scopeBaseAov,
      // Calibrated to the scope's headline baseline, so the cohort rows add up to `delta` (analytics/lifecycle.ts).
      ...(() => {
        const cal = calibrate([...cohorts].map(([cohort, c]) => ({ cohort, actual: c.actual, expected: c.expected, clinics: c.clinics })), expected);
        return {
          cohorts: cal.rows.map(r => ({
            cohort: r.cohort,
            delta: r.delta,
            clinics: r.clinics,
            real: r.actual - (cohorts.get(r.cohort)?.baseline ?? 0),
            ambition: r.expected * cal.factor - (cohorts.get(r.cohort)?.baseline ?? 0),
          })),
          cohortCalibration: cal.factor,
        };
      })(),
    };
  },
});

