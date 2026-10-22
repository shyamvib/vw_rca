/**
 * Membership for the New Clinics funnel. Order stages are cumulative;
 * each `fNdrop` stage is the disjoint cohort that reached order N-1 but not N.
 */
export function newClinicFunnelGroups(
  orders: number,
  silentDays: number,
): string[] {
  if (orders < 1) return [];
  const groups = ["f1"];
  if (orders < 2) {
    groups.push("f2drop");
    return groups;
  }
  groups.push("f2");
  if (orders < 3) {
    groups.push("f3drop");
    return groups;
  }
  groups.push("f3");
  if (silentDays < 14) groups.push("active");
  if (orders < 4) {
    groups.push("f4drop");
  } else {
    groups.push("f4");
  }
  return groups;
}

import { scopeMatcher, repsInScope } from "./scope";
import { v } from "convex/values";
import { addDays, diffDays, monthKey, prevMonthKey, quarterKey, prevQuarterKey, quarterStart } from "./dateUtils";
import { scopedQuery } from "./gated";
import { loadCfg } from "./config";
import { periodDays } from "./clinics";
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** % change helper — null when there's no prior-period base to compare
 * against (division by zero would otherwise read as a fake +Infinity). */
function pctChange(cur: number, prior: number): number | null {
  if (prior === 0) return cur === 0 ? 0 : null;
  return ((cur - prior) / prior) * 100;
}

/** Same cohort-membership + per-stage "reached order N" count logic
 * `orderRetentionFunnel` uses for its main window, reused unchanged so the
 * MoM/QoQ comparison periods are always apples-to-apples with the headline
 * numbers (same touch/clinical filters, same `firstOrder`-in-window rule). */
export function stageClinicCounts(
  seqRows: Array<{
    sales: string;
    firstOrder: string;
    orderDates: string[];
    touchDates?: string[];
    clinicalTouchDates?: string[];
  }>,
  sales: string | ((s: string) => boolean),
  start: string,
  end: string,
  touchFilter: string | undefined,
  clinicalFilter: string | undefined,
): number[] {
  const mine = typeof sales === "function" ? sales : (s: string) => s === sales;
  let cohort = seqRows.filter(
    r => mine(r.sales) && r.firstOrder >= start && r.firstOrder <= end,
  );
  const wasTouchedBeforeOrder1 = (
    r: (typeof cohort)[number],
    dates: string[] | undefined,
  ) => (dates ?? []).some(d => d <= r.orderDates[0]);
  if (touchFilter === "touched" || touchFilter === "untouched") {
    cohort = cohort.filter(r =>
      touchFilter === "touched"
        ? wasTouchedBeforeOrder1(r, r.touchDates)
        : !wasTouchedBeforeOrder1(r, r.touchDates),
    );
  }
  if (clinicalFilter === "touched" || clinicalFilter === "untouched") {
    cohort = cohort.filter(r =>
      clinicalFilter === "touched"
        ? wasTouchedBeforeOrder1(r, r.clinicalTouchDates)
        : !wasTouchedBeforeOrder1(r, r.clinicalTouchDates),
    );
  }
  return [1, 2, 3, 4, 5].map(n => cohort.filter(r => r.orderDates.length >= n).length);
}
/**
 * "Provider Retention Funnel — Orders 1→5" (Shyam, 2026-09-28): signup →
 * order 1 → ... → order 5, with avg days/median+total revenue per stage.
 * (Converted-vs-retargeted split was scoped out, 2026-09-28.) Only
 * meaningful over a window bigger than a month (enough new-clinic volume to
 * read as a funnel), so the frontend gates rendering to Quarter/Custom-over-
 * a-month; this query itself just answers for whatever periodId it's given.
 */
export const orderRetentionFunnel = scopedQuery({
  args: {
    periodId: v.string(),
    sales: v.string(),
    // "touched" = only clinics with a Call/Meeting touchpoint before their
    // order 1 (Shyam, 2026-09-29); "untouched" = the opposite; "" / undefined
    // = no filter.
    touchFilter: v.optional(v.string()),
    // Same as touchFilter but scoped to `touchpoint_category = "Clinical
    // Activity"` — confirmed live as the "Clinical Consult / VCT" bucket
    // Shyam asked for (Shyam, 2026-09-29); no literal "VCT" string exists
    // anywhere in the model, this category is the verified match.
    clinicalFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = await loadCfg(ctx);
    if (!cfg) return { ready: false as const, reason: "loading" };
    const days = periodDays(args.periodId, cfg.currentStart, cfg.currentEnd);
    if (!days.length) return { ready: false as const, reason: "bad-period" };
    const start = days[0];
    const end = days[days.length - 1];
    const gen = cfg.gen ?? 0;

    const seqRows = await ctx.db
      .query("newClinicOrderSeq")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    // One rep, or a whole team (a VP of sales' rep view): the cohort is every new clinic under the scope's reps.
    const inScope = await scopeMatcher(ctx, gen, args.sales);
    const scopeReps = await repsInScope(ctx, gen, args.sales);
    let cohort = seqRows.filter(
      r => inScope(r.sales) && r.firstOrder >= start && r.firstOrder <= end,
    );
    const wasTouchedBeforeOrder1 = (
      r: (typeof cohort)[number],
      dates: string[] | undefined,
    ) => (dates ?? []).some(d => d <= r.orderDates[0]);
    if (args.touchFilter === "touched" || args.touchFilter === "untouched") {
      cohort = cohort.filter(r =>
        args.touchFilter === "touched"
          ? wasTouchedBeforeOrder1(r, r.touchDates)
          : !wasTouchedBeforeOrder1(r, r.touchDates),
      );
    }
    if (args.clinicalFilter === "touched" || args.clinicalFilter === "untouched") {
      cohort = cohort.filter(r =>
        args.clinicalFilter === "touched"
          ? wasTouchedBeforeOrder1(r, r.clinicalTouchDates)
          : !wasTouchedBeforeOrder1(r, r.clinicalTouchDates),
      );
    }

    const stages = [1, 2, 3, 4, 5].map(n => {
      const reached = cohort.filter(r => r.orderDates.length >= n);
      const revenues = reached.map(r => r.orderRevenue[n - 1]);
      const dayGaps = reached
        .map(r =>
          n === 1
            ? r.signupDate
              ? diffDays(r.signupDate, r.orderDates[0])
              : null
            : diffDays(r.orderDates[n - 2], r.orderDates[n - 1]),
        )
        .filter((d): d is number => d !== null);
      return {
        n,
        clinics: reached.length,
        ids: reached.map(r => r.clinic),
        totalRevenue: revenues.reduce((a, b) => a + b, 0),
        medianRevenue: median(revenues),
        // Median, not mean (Shyam, 2026-09-29): a handful of outlier gaps
        // (e.g. a stale signup match) skewed the average badly; median is
        // the sturdier read on "typical" days between stages.
        medianDays: median(dayGaps),
      };
    });

    const signupRows = (
      await Promise.all(scopeReps.map(rep => ctx.db.query("signupDaily").withIndex("by_gen_sales", q => q.eq("gen", gen).eq("sales", rep)).collect()))
    ).flat();
    const signups = signupRows
      .filter(r => r.date >= start && r.date <= end)
      .reduce((s, r) => s + r.count, 0);
    // Signups in the window with no order by window end (Shyam, 2026-10-13).
    const noOrderLeads = (
      await Promise.all(scopeReps.map(rep => ctx.db.query("signupLead").withIndex("by_gen_sales", q => q.eq("gen", gen).eq("sales", rep)).collect()))
    ).flat()
      .filter(r => r.date >= start && r.date <= end && (!r.firstOrder || r.firstOrder > end))
      .map(r => ({ id: r.customerId, name: r.name, date: r.date, state: r.state ?? null, practice: r.practice ?? null }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // MoM / QoQ per stage — window-independent (Shyam, 2026-09-29): always
    // anchored on the MAIN refresh's latest data date and read from the MAIN
    // generation's sequence rows (which span baseline + current windows),
    // so the chips never change with the window tab or a rep's custom
    // window. Like-for-like: the current month/quarter to date vs the same
    // number of elapsed days of the prior month/quarter. A comparison whose
    // prior period starts before loaded history returns null.
    const mainCfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const tCfg = mainCfg && mainCfg.gen ? mainCfg : cfg;
    const tGen = tCfg.gen ?? 0;
    const tRows =
      tGen === gen
        ? seqRows
        : await ctx.db
            .query("newClinicOrderSeq")
            .withIndex("by_gen", q => q.eq("gen", tGen))
            .collect();
    const anchor = tCfg.currentEnd;
    const coverFrom =
      tCfg.baselineStart && tCfg.baselineStart < tCfg.currentStart
        ? tCfg.baselineStart
        : tCfg.currentStart;
    const mKey = monthKey(anchor);
    const qKey = quarterKey(anchor);
    const mStart = `${mKey}-01`;
    const qStart = quarterStart(qKey);
    const pmStart = `${prevMonthKey(mKey)}-01`;
    const pqStart = quarterStart(prevQuarterKey(qKey));
    const mElapsed = diffDays(mStart, anchor);
    const qElapsed = diffDays(qStart, anchor);
    // Same elapsed days into the prior period, capped at its last day.
    const capEnd = (from: string, elapsed: number, nextStart: string) => {
      const e = addDays(from, elapsed);
      const last = addDays(nextStart, -1);
      return e < last ? e : last;
    };
    const pmEnd = capEnd(pmStart, mElapsed, mStart);
    const pqEnd = capEnd(pqStart, qElapsed, qStart);
    const cnt = (s0: string, e0: string) =>
      stageClinicCounts(tRows, inScope, s0, e0, args.touchFilter, args.clinicalFilter);
    const curMCounts = cnt(mStart, anchor);
    const curQCounts = cnt(qStart, anchor);
    const prevMCounts = pmStart >= coverFrom ? cnt(pmStart, pmEnd) : null;
    const prevQCounts = pqStart >= coverFrom ? cnt(pqStart, pqEnd) : null;

    const stagesWithTrend = stages.map((s, i) => ({
      ...s,
      momPct: curMCounts && prevMCounts ? pctChange(curMCounts[i], prevMCounts[i]) : null,
      qoqPct: curQCounts && prevQCounts ? pctChange(curQCounts[i], prevQCounts[i]) : null,
    }));

    return {
      ready: true as const,
      start,
      end,
      signups,
      noOrderLeads,
      clinics: cohort.length,
      stages: stagesWithTrend,
      trendMonth: mKey,
      trendPrevMonth: prevMonthKey(mKey),
      trendQuarter: qKey,
      trendPrevQuarter: prevQuarterKey(qKey),
      trendCurM: `${mStart}–${anchor}`,
      trendPrevM: `${pmStart}–${pmEnd}`,
      trendCurQ: `${qStart}–${anchor}`,
      trendPrevQ: `${pqStart}–${pqEnd}`,
    };
  },
});

/** Order dates + signup per clinic for the staged touch Sankey (Shyam, 2026-10-13). */
export const seqFor = scopedQuery({
  args: { clinics: v.array(v.string()) },
  handler: async (ctx, { clinics }) => {
    const cfg = await loadCfg(ctx);
    const gen = cfg?.gen ?? 0;
    const want = new Set(clinics);
    const rows = await ctx.db.query("newClinicOrderSeq").withIndex("by_gen", q => q.eq("gen", gen)).collect();
    const out: Record<string, { signup?: string; orders: string[] }> = {};
    for (const r of rows) if (want.has(r.clinic)) out[r.clinic] = { signup: r.signupDate, orders: r.orderDates };
    return out;
  },
});
