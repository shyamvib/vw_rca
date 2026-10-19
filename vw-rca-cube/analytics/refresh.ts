"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { DEFAULTS } from "./config";
import {
  addDays,
  type BaselineMode,
  baselinePlan,
  baselineWindow,
  bucketing,
  computeP75Factors,
  dayCountsOf,
  diffDays,
  dow,
  eachDay,
  FIXED_DATE_HOLIDAYS,
  monthsBackStart,
  type P75Factors,
  periodDefs,
  priorYearSameWeekday,
  quarterKey,
  ratesFrom,
  rollingBaseline,
  weekStart,
} from "./dateUtils";
import { buyingRhythm } from "./flags";
import { classifyClinic, type Lifecycle } from "./lifecycleRules";
import { gatedAction } from "./gated";
import { topDownAllocate } from "./topDown";
import { newClinicFunnelGroups } from "./newClinicFunnel";
import { eq, O, ordersRows, rows as cubeRows } from "./cube";
import { dateOf, familyOf, num, splitFamilies, TABLE } from "./powerbi";

// Lifecycle stages (Shyam, 2026-10-16): new = first order in the window; retained_* = ordered in the baseline AND the
// window (top 20% by baseline $ is a value tier of "active"); churned = ordered in the baseline, nothing in the window;
// reactivated = first order before the window, nothing in the baseline, ordering again now (baseline is zero).
const COHORTS = ["churned", "new", "retained_top20", "retained_rest", "reactivated"] as const;
type Cohort = (typeof COHORTS)[number];

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Month-sized [start, end] slices covering a window (keeps DAX payloads small). */
function monthSlices(start: string, end: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cursor = start;
  while (cursor <= end) {
    const y = Number(cursor.slice(0, 4));
    const m = Number(cursor.slice(5, 7));
    const firstNext = new Date(
      Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1),
    )
      .toISOString()
      .slice(0, 10);
    const sliceEnd =
      addDays(firstNext, -1) < end ? addDays(firstNext, -1) : end;
    out.push([cursor, sliceEnd]);
    cursor = addDays(sliceEnd, 1);
  }
  return out;
}

/** Runs promise-returning tasks with a bounded number in flight. */
async function runAll(limit: number, tasks: Array<() => Promise<unknown>>) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        await task();
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Baseline window (Shyam, 2026-10-17): by default the 91 days before the analysis window; "best" picks the 91-day
 * stretch of data with the highest revenue that ends before the window starts; "custom" uses the dates saved in
 * Settings. Both fall back to the default when they cannot be honoured (too little data, overlap with the window).
 */
const BEST_FROM = "2025-01-01";
export async function resolveBaseline(
  cfg: { autoBaseline?: boolean; baselineSource?: string; baselineStart: string; baselineEnd: string },
  mode: BaselineMode,
  currentStart: string,
  currentEnd: string,
): Promise<{ start: string; end: string }> {
  const trailing = baselineWindow(mode, currentStart, currentEnd);
  if (mode === "yoy") return trailing;
  const source = cfg.baselineSource ?? (cfg.autoBaseline === false ? "custom" : "best");
  if (source === "custom" && cfg.baselineStart && cfg.baselineEnd && cfg.baselineEnd < currentStart)
    return { start: cfg.baselineStart, end: cfg.baselineEnd };
  if (source === "best") {
    const last = addDays(currentStart, -1);
    const rows = await ordersRows({ day: true, start: BEST_FROM, end: last, m: { rev: "revenue" } });
    const rev = new Map(rows.map(r => [dateOf(r, "order_date"), num(r, "rev")]));
    const N = 91;
    if (diffDays(BEST_FROM, last) + 1 >= N) {
      let sum = 0, best = -1, bestEnd = last;
      const win: number[] = [];
      for (let d = BEST_FROM; d <= last; d = addDays(d, 1)) {
        const x = rev.get(d) ?? 0;
        win.push(x); sum += x;
        if (win.length > N) sum -= win[win.length - N - 1];
        if (win.length >= N && sum > best) { best = sum; bestEnd = d; }
      }
      if (best > 0) return { start: addDays(bestEnd, -(N - 1)), end: bestEnd };
    }
  }
  return trailing;
}

/**
 * Distinct order dates per clinic up to `cutoff` (no future leak), pulled in
 * month slices from the first order date to keep each DAX payload small.
 */
export async function fetchOrderDateHistory(
  cutoff: string,
): Promise<Map<string, string[]>> {
  const first = await ordersRows({ start: "2000-01-01", end: cutoff, m: { first: "first_order" } });
  const start = String(first[0]?.["[first]"] ?? "").slice(0, 10);
  const out = new Map<string, string[]>();
  if (!start) return out;
  await runAll(
    4,
    monthSlices(`${start.slice(0, 7)}-01`, cutoff).map(([a, b]) => async () => {
      const rows = await ordersRows({ by: ["clinic_id"], day: true, start: a, end: b, m: { ord: "orders" } });
      for (const r of rows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        const d = String(r[`${TABLE}[order_date]`] ?? "").slice(0, 10);
        if (!id || !d || d > cutoff) continue;
        const list = out.get(id);
        if (list) list.push(d);
        else out.set(id, [d]);
      }
    }),
  );
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Retries a write that hit the deployment's per-second write-rate cap. Backs
 * off long enough for the budget to refill; other errors propagate at once.
 */
async function withWriteRetry(task: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await task();
      return;
    } catch (error) {
      const msg = String(error);
      if (attempt >= 4 || !msg.includes("Too many writes")) throw error;
      await sleep(1500 * (attempt + 1));
    }
  }
}

export const refreshData = internalAction({
  args: {},
  handler: async (ctx): Promise<{ dataThrough: string; rows: number }> => {
    const logId: Id<"refreshLog"> = await ctx.runMutation(
      internal.ingest.startLog,
      {
        message: "Refreshing from Cube…",
      },
    );
    try {
      const startedAt = Date.now();
      const cfg = await ctx.runQuery(internal.config.getInternal, {});

      // 1. How fresh is the dataset?
      const maxRows = await cubeRows({ measures: [`${O}.last_order`] }, { [`${O}.last_order`]: "[maxd]" });
      const maxDate = String(maxRows[0]["[maxd]"] ?? "").slice(0, 10);

      const currentStart = cfg.currentStart;
      // Bundle flags now come from the line-level test table, which has no lag,
      // so we only trim today's partial day. DEFAULTS.lagDays is the floor so a
      // stale stored config cannot hold the window back. (Shyam, 2026-08-31)
      const lagDays = Math.min(cfg.lagDays, DEFAULTS.lagDays);
      const latest = addDays(maxDate, -lagDays);
      // Main window always rolls forward to the latest data (Shyam, 2026-10-04):
      // the admin UI no longer edits the shared window, so a fixed end froze reps.
      const currentEnd = true
        ? latest
        : cfg.currentEnd < latest
          ? cfg.currentEnd
          : latest;
      const windowLen = diffDays(currentStart, currentEnd) + 1;
      const mode = (cfg.baselineMode ?? "prior_equal") as BaselineMode;
      const bucket = bucketing(mode);
      const win = await resolveBaseline(cfg, mode, currentStart, currentEnd);
      const baselineStart = win.start;
      const baselineEnd = win.end;
      void windowLen;

      // Every Power BI pull below is independent of the others, so fire them
      // all now and await where the rows are needed. dax() caps how many are
      // actually in flight; the refresh becomes bound by the slowest query
      // rather than the sum of ~15 sequential ones.
      let rangeStart =
        baselineStart < currentStart ? baselineStart : currentStart;
      // The P75 baseline also needs the three prior full calendar months, which
      // can start a day or two before the trailing-13-week baseline does.
      if (mode === "p75") {
        // Needs the year-to-date full calendar months (with a 3-prior-month
        // fallback) *and* 13 full trailing weeks, all of which can start
        // before the trailing-13-week baseline does.
        const m3 = monthsBackStart(currentStart, 3);
        const ytd = `${currentStart.slice(0, 4)}-01-01`;
        const w13 = weekStart(addDays(currentStart, -91));
        let earliest = m3 < w13 ? m3 : w13;
        if (ytd < earliest) earliest = ytd;
        if (earliest < rangeStart) rangeStart = earliest;
      }
      const rangeEnd = baselineEnd > currentEnd ? baselineEnd : currentEnd;
      const baseSlices = monthSlices(baselineStart, baselineEnd);
      const curSlices = monthSlices(currentStart, currentEnd);
      const clinicQuery = (s0: string, e0: string) =>
        ordersRows({ by: ["clinic_id"], day: true, start: s0, end: e0,
          m: { rev: "revenue", ord: "orders", pat: "patients", brev: "bundle_revenue", bord: "bundle_orders" } });
      const familyQuery = (s0: string, e0: string) =>
        ordersRows({ by: ["team_lead", "sales_id"], family: true, day: true, start: s0, end: e0,
          m: { rev: "revenue", ord: "orders", brev: "bundle_revenue", bord: "bundle_orders" } });

      const pDaily = ordersRows({ day: true, start: rangeStart, end: rangeEnd,
        m: { ord: "orders", rev: "revenue", pat: "patients", bord: "bundle_orders", brev: "bundle_revenue" } });
      const pStateCur = ordersRows({ by: ["state"], day: true, start: currentStart, end: currentEnd, m: { rev: "revenue" } });
      const pChannel = ordersRows({ by: ["charge_method"], day: true, start: rangeStart, end: rangeEnd, m: { rev: "revenue", ord: "orders" } });
      const pStateBase = ordersRows({ by: ["state"], day: true, start: baselineStart, end: baselineEnd, m: { rev: "revenue" } });
      let pClinicBase: Array<Promise<any>> | null = baseSlices.map(([s0, e0]) =>
        clinicQuery(s0, e0),
      );
      let pClinicCur: Array<Promise<any>> | null = curSlices.map(([s0, e0]) => clinicQuery(s0, e0));
      let pFamBase: Array<Promise<any>> | null = baseSlices.map(([s0, e0]) => familyQuery(s0, e0));
      let pFamCur: Array<Promise<any>> | null = curSlices.map(([s0, e0]) => familyQuery(s0, e0));
      const pIdentity = ordersRows({ by: ["clinic_id", "customer_practice_name", "state", "country_name", "team_lead", "sales_id"],
        start: rangeStart, end: rangeEnd, m: { rev: "revenue" } });
      const pUsers = cubeRows({ dimensions: ["internal_user.internal_user_id", "internal_user.name"] }, {
        "internal_user.internal_user_id": "internal_user[internal_user_id]",
        "internal_user.name": "internal_user[internal_user_name]" });
      const pSales = cubeRows({ dimensions: ["sales_commission.sales_id", "sales_commission.sales_name"] }, {
        "sales_commission.sales_id": "sales_commission_summary[sales_id]",
        "sales_commission.sales_name": "sales_commission_summary[sales_name]" });
      // Year-end projection inputs: 2026 year-to-date actuals, and the prior
      // year's daily revenue for the remaining stretch of the year (it carries
      // the holidays and the Nov–Dec slowdown as data instead of a hardcoded
      // calendar).
      const yearStart = `${currentEnd.slice(0, 4)}-01-01`;
      const pYtd = ordersRows({ start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const priorStart = addDays(yearStart, -364).slice(0, 4) + "-06-01";
      const priorEnd = `${Number(currentEnd.slice(0, 4)) - 1}-12-31`;
      const pPrior = ordersRows({ day: true, start: priorStart, end: priorEnd, m: { rev: "revenue", ord: "orders" } });
      const pYtdLead = ordersRows({ by: ["team_lead"], start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const pFwdLead = ordersRows({ by: ["team_lead"], start: addDays(currentEnd, -90), end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      // Same year-to-date and trailing-13-week actuals, at clinic grain, so
      // the year-end projection can be re-scoped to any state or salesperson
      // (not just team lead) by summing whichever clinics fall in that scope,
      // without a bespoke DAX query per grouping.
      const pClinicYtd = ordersRows({ by: ["clinic_id"], start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const pClinicFwd = ordersRows({ by: ["clinic_id"], start: addDays(currentEnd, -90), end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      // First-ever order date per clinic. Drives the tenure-aligned cohort
      // split: a clinic is a NEW LOGO in a window if its first order falls in
      // that window, so the new-clinic branch can be measured against the
      // baseline window's own new logos instead of against $0.
      const pFirst = ordersRows({ by: ["clinic_id"], m: { first: "first_order" } });
      // Earliest HubSpot signup per clinic (Shyam, 2026-09-28, Provider
      // Retention Funnel): customer_signup_time is a per-order attribute
      // (repeated across every order of the same customer), so MIN over
      // ALL of a clinic's orders gives its earliest-signed-up provider.
      // Kept for clinicMeta (unused elsewhere today) but NOT used for the
      // funnel's signup->order1 gap anymore — see pClinicSignupByDay below.
      const pClinicSignup = ordersRows({ by: ["clinic_id"], m: { signup: "first_signup" } });
      // Signup->order1 fix (Shyam, 2026-09-29): the clinic-wide MIN above
      // picks up ANY provider ever signed up at that clinic_id, which for a
      // multi-provider practice can predate the specific provider who
      // placed the clinic's first order by months/years — producing wild
      // "signup to order 1" gaps (e.g. 400+ days) that don't describe the
      // actual conversion. Grouping by clinic_id + order_date instead scopes
      // MIN(customer_signup_time) to just the customer(s) who ordered that
      // day, a much tighter proxy for "the provider who placed this order".
      // Bounded to the refresh window (same bound as the per-clinic-day
      // pulls elsewhere in this file) to keep row count sane.
      const pClinicSignupByDay = ordersRows({ by: ["clinic_id"], day: true, start: currentStart, end: currentEnd, m: { signup: "first_signup" } });
      // Lead signups by owning salesperson, day-grain (same funnel): a much
      // broader population than clinics that ever ordered — most signups
      // never place an order. customers_bq has no clinic_id, only sales_id,
      // so this is scoped by rep, not by clinic. Row-level (not
      // SUMMARIZECOLUMNS-aggregated) because customer_signup_time carries a
      // time-of-day component with no clean DAX date-truncation; bucketed to
      // day in JS below. Bounded to the refresh window to keep row count
      // small (~1-2k, not the whole company's lifetime lead list).
      const pSignups = cubeRows({
          dimensions: ["customers.customer_id", "customers.sales_id", "customers.signup_time",
            "customers.first_name", "customers.last_name", "customers.credential", "customers.state"],
          timeDimensions: [{ dimension: "customers.signup_time", dateRange: [currentStart, currentEnd] }],
        }, {
          "customers.customer_id": "customers_bq[customer_id]",
          "customers.sales_id": "customers_bq[sales_id]",
          "customers.signup_time": "customers_bq[customer_signup_time]",
          "customers.first_name": "customers_bq[customer_first_name]",
          "customers.last_name": "customers_bq[customer_last_name]",
          "customers.credential": "customers_bq[customer_suffix]",
          "customers.state": "customers_bq[state]",
        });
      // First order per window signup (Shyam, 2026-10-13): which leads never
      // ordered. rfm_orders carries customer_signup_time per customer; Cube
      // has no MIN over dimensions, so group by clinic/practice and keep the
      // smallest per customer (DAX MIN() equivalent).
      const pSignupOrd = cubeRows({
          measures: ["rfm_orders.first_order"],
          dimensions: ["rfm_orders.customer_id", "rfm_orders.clinic_id", "rfm_orders.practice_name"],
          timeDimensions: [{ dimension: "rfm_orders.customer_signup_time", dateRange: [currentStart, currentEnd] }],
        }, {
          "rfm_orders.customer_id": `${TABLE}[customer_id]`,
          "rfm_orders.clinic_id": "cl",
          "rfm_orders.practice_name": "pr",
          "rfm_orders.first_order": "fo",
        }).then(rs => {
          const best = new Map<string, Record<string, unknown>>();
          for (const r of rs) {
            const id = String(r[`${TABLE}[customer_id]`] ?? "");
            const b = best.get(id);
            if (!b) { best.set(id, { ...r }); continue; }
            if (String(r.fo ?? "") && (!String(b.fo ?? "") || String(r.fo) < String(b.fo))) b.fo = r.fo;
            if (r.cl != null && (b.cl == null || Number(r.cl) < Number(b.cl))) b.cl = r.cl;
            if (r.pr != null && (b.pr == null || String(r.pr) < String(b.pr))) b.pr = r.pr;
          }
          return [...best.values()].map(r => ({
            [`${TABLE}[customer_id]`]: r[`${TABLE}[customer_id]`], "[fo]": r.fo, "[cl]": r.cl, "[pr]": r.pr,
          }));
        });
      const pPortfolio = cubeRows({ dimensions: ["portfolio_changes.clinic_id", "portfolio_changes.status"] }, {
        "portfolio_changes.clinic_id": "Portfolio Changes[Clinic Id]",
        "portfolio_changes.status": "Portfolio Changes[Status]" });
      // Trailing-12-month VA (VA-only order) stats per clinic, for the $400
      // Foundation Zoomer launch target list (Shyam, 2026-09-15). VA order =
      // sample_test_type_v2 = "VA" (order-level field; exactly matches the
      // dataset's own [VA Orders] measure — no line-level join needed).
      const vaEnd = maxDate;
      const vaStart = addDays(vaEnd, -364);
      const vaWindowDays = diffDays(vaStart, vaEnd) + 1;
      const pVaTarget = ordersRows({ by: ["clinic_id"], start: vaStart, end: vaEnd,
        m: { vaRev: "va_revenue", vaOrd: "va_orders", allRev: "revenue", allOrd: "orders" } })
        .then(rs => rs.filter(r => Number(r["[vaOrd]"] ?? 0) > 0));

      // Clinic-health source inputs (RCA-computed flags, see convex/flags.ts)
      // — all as-of `currentEnd`, the same cutoff the Power BI "Time Machine"
      // slicer anchored on, so nothing here can see past the reporting date.
      // A sentinel far before any real order lets one dateFilter cover "all
      // time up to the cutoff" without a separate unbounded-date code path.
      const EARLIEST = "2000-01-01";

      // True last order date per clinic across its WHOLE history (not just
      // the refresh window) — needed for reliable churn/launch/slipping
      // classification; the window-scoped `lastOrder` field is not enough
      // for a clinic whose last order predates the refresh window.
      const pLastOrderAsOf = ordersRows({ by: ["clinic_id"], start: EARLIEST, end: currentEnd, m: { last: "last_order" } });
      // Revenue and orders in the 12 months up to the end of the baseline period, per clinic: the own-history baseline of
      // a slow buyer that skipped the baseline period (analytics/lifecycleRules.ts).
      const pPriorRev = ordersRows({ by: ["clinic_id"], start: addDays(baselineEnd, -364), end: baselineEnd, m: { rev: "revenue", ord: "orders" } });
      // Last year's revenue by month, per clinic: joined with first-order dates it gives last year's new-clinic revenue by
      // month, the shape the new-business goal is phased by (and its total is the default new-business goal).
      const priorYearNum = Number(currentEnd.slice(0, 4)) - 1;
      const pPriorYearMonths = Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          ordersRows({
            by: ["clinic_id"],
            start: `${priorYearNum}-${String(i + 1).padStart(2, "0")}-01`,
            end: new Date(Date.UTC(priorYearNum, i + 1, 0)).toISOString().slice(0, 10),
            m: { rev: "revenue" },
          }),
        ),
      );

      // Lifetime (as-of-cutoff) revenue and fee/deduction total per clinic —
      // for the High Margin Bleed flag's lifetime deduction rate.
      const pLifetimeAsOf = ordersRows({ by: ["clinic_id"], start: EARLIEST, end: currentEnd, m: { rev: "revenue", ded: "deductions" } });

      // Year-to-date VA-only orders per clinic — paired with the existing
      // YTD order total (pClinicYtd) for the High VA Dependency share.
      const pYtdVa = ordersRows({ by: ["clinic_id"], start: yearStart, end: currentEnd, m: { vaOrd: "va_orders" } })
        .then(rs => rs.filter(r => Number(r["[vaOrd]"] ?? 0) > 0));

      // Thiru approved exactly these two source-owned flags from the
      // Revenue Intelligence dashboard: import only their titles from Note;
      // every other source Note flag remains RCA-computed (or omitted).
      // Buying Overdue: every distinct (clinic, order date) up to cutoff.
      const pOrderDateHistory = fetchOrderDateHistory(currentEnd);

      // Ghosted VIP's "last HubSpot touch": the model's OWN relationship
      // (verified live via `INFO.VIEW.RELATIONSHIPS()`, 2026-09-21) is
      // `${TABLE}[hubspot_id] *[<->]1 bi_hubspot_contacts[contact_id]` —
      // i.e. `hubspot_id` IS a contact_id, directly, in the same key space
      // customer_journey_final.contact_id uses. No intermediate table or
      // `bi_hubspot_contacts[customer_id]` involved: an earlier version of
      // this join went through that column, which turned out to be an
      // unrelated field (it duplicates `portal_id`, not a customer/clinic
      // key) — confirmed by spot-checking live rows, its ~14% overlap with
      // orders[hubspot_id] was a coincidental numeric collision, not a real
      // relationship, and undercounted real coverage badly. Direct
      // hubspot_id<->contact_id matching covers ~365K of ~367.6K order rows
      // (~99.4%) and ~364K of the journey table's contact_ids likewise.
      const pOrderHubspotClinic = ordersRows({ by: ["hubspot_id", "clinic_id"], start: EARLIEST, end: currentEnd, m: { rev: "revenue" },
        filters: [{ member: `${O}.hubspot_id`, operator: "set" }] });
      // Scoped to Call/Meeting touchpoints only (Shyam, 2026-09-28): this
      // previously used MAX() over every touchpoint_type — including
      // Ticket/Note/First Order/Repeat Order rows — so "last touch" could
      // be a system-logged order event, not an actual rep call or meeting.
      const pTouchAsOf = cubeRows({
          measures: ["journey.last_touch"],
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", dateRange: [EARLIEST, currentEnd] }],
          filters: [eq("journey.touchpoint_type", "Call", "Meeting")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]", "journey.last_touch": "[last]" });
      // Full Call/Meeting touchpoint date list per contact, bounded to the
      // refresh window (Shyam, 2026-09-29, Provider Retention Funnel "had a
      // call/meeting" filter): pTouchAsOf above only keeps the single most
      // recent date, which can't tell us whether a touch fell inside a
      // specific signup->order1 or orderN-1->orderN gap. Only "Call" and
      // "Meeting" exist as touchpoint_type values in this table (checked
      // live via SUMMARIZECOLUMNS(touchpoint_type, COUNTROWS) — no
      // "Clinical Consult"/"VCT" type exists here or in any other reachable
      // table/column; flagged to Shyam rather than guessed).
      const pTouchDatesRaw = cubeRows({
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", granularity: "day",
            dateRange: [baselineStart < currentStart ? baselineStart : currentStart, currentEnd] }],
          filters: [eq("journey.touchpoint_type", "Call", "Meeting")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]",
             "journey.touchpoint_date": "customer_journey_final[touchpoint_date]" });
      // "Clinical Consult or VCT" touchpoints (Shyam, 2026-09-28): confirmed
      // live this is `customer_journey_final[touchpoint_category] =
      // "Clinical Activity"` (activityType values like "Clinical - Provider
      // Consult", "Meeting - Clinical consults", "Clinical - Provider
      // Training" etc.) — a distinct, narrower bucket than the generic
      // Sales Activity Call/Meeting rows already pulled above. No literal
      // "VCT" string exists anywhere in the model; this category is the
      // closest verified match. Same shape/join as pTouchDatesRaw.
      const pClinicalTouchDatesRaw = cubeRows({
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", granularity: "day",
            dateRange: [baselineStart < currentStart ? baselineStart : currentStart, currentEnd] }],
          filters: [eq("journey.touchpoint_category", "Clinical Activity")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]",
             "journey.touchpoint_date": "customer_journey_final[touchpoint_date]" });

      await ctx.runMutation(internal.ingest.progressLog, { id: logId, message: `Refreshing… phase 402 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss/1e6)}MB` });
      // 2. Daily totals across both windows.
      const dailyRows = await pDaily;
      const daily = dailyRows.map(r => ({
        date: dateOf(r, "order_date"),
        orders: num(r, "ord"),
        revenue: num(r, "rev"),
        bundleOrders: num(r, "bord"),
        bundleRevenue: num(r, "brev"),
        patients: num(r, "pat"),
      }));

      const dailyOrders = new Map(daily.map(d => [d.date, d.orders]));
      const p75: P75Factors | undefined =
        mode === "p75"
          ? computeP75Factors(d => dailyOrders.get(d), currentStart)
          : undefined;

      // 3. State revenue: current-window actuals + baseline rates by weekday.
      const stateRows = await pStateCur;
      const stateDaily = stateRows.map(r => ({
        date: dateOf(r, "order_date"),
        state: String(r[`${TABLE}[state]`] ?? "(blank)"),
        revenue: num(r, "rev"),
      }));

      const baseDays = eachDay(baselineStart, baselineEnd);
      const baseCounts = dayCountsOf(baseDays);

      const stateBaseRows = await pStateBase;
      const stateTotals = new Map<string, number[]>();
      for (const r of stateBaseRows) {
        const st = String(r[`${TABLE}[state]`] ?? "(blank)");
        const arr = stateTotals.get(st) ?? [0, 0, 0, 0, 0, 0, 0];
        arr[dow(dateOf(r, "order_date"))] += num(r, "rev");
        stateTotals.set(st, arr);
      }

      // 3b. Charge channel (wellProz / customerPay / ...): current actuals and
      // baseline day-type rates, so the feed can answer "is channel X down?".
      const channelRows = await pChannel;
      const channelDaily: Array<{
        date: string;
        channel: string;
        orders: number;
        revenue: number;
      }> = [];
      const channelBase = new Map<string, { rev: number[]; ord: number[] }>();
      for (const r of channelRows) {
        const date = dateOf(r, "order_date");
        const channel = String(r[`${TABLE}[charge_method]`] ?? "(blank)");
        if (date >= currentStart && date <= currentEnd) {
          channelDaily.push({
            date,
            channel,
            orders: num(r, "ord"),
            revenue: num(r, "rev"),
          });
        }
        if (date >= baselineStart && date <= baselineEnd) {
          const b = channelBase.get(channel) ?? {
            rev: [0, 0, 0, 0, 0, 0, 0],
            ord: [0, 0, 0, 0, 0, 0, 0],
          };
          b.rev[dow(date)] += num(r, "rev");
          b.ord[dow(date)] += num(r, "ord");
          channelBase.set(channel, b);
        }
      }
      const channelBaseline = [...channelBase].map(([channel, b]) => ({
        channel,
        rates: ratesFrom(b.rev, baseCounts, bucket),
        ordRates: ratesFrom(b.ord, baseCounts, bucket),
      }));

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 480 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 4. Clinic cohorts: baseline clinic-days (aggregated per weekday) + current clinic-days.
      type ClinicBase = {
        rev: number[];
        ord: number[];
        bRev: number[];
        bOrd: number[];
        pat: number[];
        total: number;
        orders: number;
        patients: number;
      };
      const zero = (): number[] => [0, 0, 0, 0, 0, 0, 0];
      const baseByClinic = new Map<string, ClinicBase>();
      /** Last order date inside the baseline window, per clinic. */
      const baseLast = new Map<string, string>();
      // Per-clinic-per-day rows from the baseline window, kept alongside the
      // day-of-week aggregation above (not instead of it) — this is the
      // trailing lookback the new rolling P75 baseline needs for periods
      // early in the current window (2026-09-28, see clinicDaysAll below).
      const clinicBaseDays: Array<{
        clinic: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      // OOM fix 2026-10-08: drop the promise array so raw DAX rows are GC'd after this loop
      for (const rows of await (async () => {
        const r = await Promise.all(pClinicBase!);
        pClinicBase = null;
        return r;
      })()) {
        for (const r of rows) {
          const id = String(r[`${TABLE}[clinic_id]`]);
          const d = dateOf(r, "order_date");
          if ((baseLast.get(id) ?? "") < d) baseLast.set(id, d);
          const i = dow(d);
          const b =
            baseByClinic.get(id) ??
            ({
              rev: zero(),
              ord: zero(),
              bRev: zero(),
              bOrd: zero(),
              pat: zero(),
              total: 0,
              orders: 0,
              patients: 0,
            } as ClinicBase);
          const rev = num(r, "rev");
          const ord = num(r, "ord");
          const pat = num(r, "pat");
          b.rev[i] += rev;
          b.ord[i] += ord;
          b.bRev[i] += num(r, "brev");
          b.bOrd[i] += num(r, "bord");
          b.pat[i] += pat;
          b.total += rev;
          b.orders += ord;
          b.patients += pat;
          baseByClinic.set(id, b);
          clinicBaseDays.push({
            clinic: id,
            date: d,
            revenue: rev,
            orders: ord,
          });
        }
      }

      const clinicDays: Array<{
        clinic: string;
        date: string;
        revenue: number;
        orders: number;
        bundleRevenue: number;
        bundleOrders: number;
        patients: number;
      }> = [];
      // OOM fix 2026-10-08: drop the promise array so raw DAX rows are GC'd after this loop
      for (const rows of await (async () => {
        const r = await Promise.all(pClinicCur!);
        pClinicCur = null;
        return r;
      })()) {
        for (const r of rows) {
          clinicDays.push({
            clinic: String(r[`${TABLE}[clinic_id]`]),
            date: dateOf(r, "order_date"),
            revenue: num(r, "rev"),
            orders: num(r, "ord"),
            bundleRevenue: num(r, "brev"),
            bundleOrders: num(r, "bord"),
            patients: num(r, "pat"),
          });
        }
      }

      const currentByClinic = new Map<string, number>();
      for (const row of clinicDays) {
        currentByClinic.set(
          row.clinic,
          (currentByClinic.get(row.clinic) ?? 0) + row.revenue,
        );
      }

      // Cohort assignment — tenure aligned.
      //
      // Each clinic gets two labels: one for where its BASELINE revenue is
      // expected (expectedCohort) and one for where its CURRENT revenue lands
      // (actualCohort). They differ only for new logos: the "new clinics"
      // branch is now measured against the baseline window's own new logos
      // rather than against $0, which is what makes the branch answer "is new
      // business up or down" instead of "new business exists".
      const firstOrderOf = new Map<string, string>();
      for (const r of await pFirst) {
        firstOrderOf.set(
          String(r[`${TABLE}[clinic_id]`]),
          dateOf(r, "first") || String(r["[first]"] ?? "").slice(0, 10),
        );
      }
      const clinicSignupOf = new Map<string, string>();
      for (const r of await pClinicSignup) {
        const s = String(r["[signup]"] ?? "").slice(0, 10);
        if (s) clinicSignupOf.set(String(r[`${TABLE}[clinic_id]`]), s);
      }
      // Day-scoped signup map (see pClinicSignupByDay comment above) — key
      // is `${clinic}|${order_date}`, used only for the funnel's order-1 gap.
      const signupByClinicDay = new Map<string, string>();
      for (const r of await pClinicSignupByDay) {
        const s = String(r["[signup]"] ?? "").slice(0, 10);
        const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
        const date = dateOf(r, "order_date");
        if (s && clinic && date) signupByClinicDay.set(`${clinic}|${date}`, s);
      }
      const firstIn = (id: string, from: string, to: string) => {
        const f = firstOrderOf.get(id);
        return !!f && f >= from && f <= to;
      };

      // Retained ranking: clinics with revenue in both windows, ranked on
      // baseline size so the top-20% split is unchanged.
      // Lifecycle (Shyam, 2026-10-18): analytics/lifecycleRules.ts, CLINIC_LIFECYCLE.md.
      //  New = first-ever order this calendar year (no baseline, whatever the dates); churned = silent past the clinic's
      //  threshold (45 days, or max(45, 3 x its own typical gap) for established clinics); reactivated = no baseline and an
      //  unusual gap ended by an order in the last 90 days; a slow buyer with no baseline revenue gets its own 12-month
      //  history as a baseline and stays Existing.
      const orderDatesForLife = await pOrderDateHistory;
      const priorOf = new Map<string, { rev: number; ord: number }>();
      for (const r of await pPriorRev) {
        priorOf.set(String(r[`${TABLE}[clinic_id]`] ?? ""), { rev: num(r, "rev"), ord: num(r, "ord") });
      }
      const lifeYear = currentEnd.slice(0, 4);
      const lifeOf = new Map<string, Lifecycle>();
      const lifeScope = new Set<string>([...baseByClinic.keys(), ...currentByClinic.keys()]);
      for (const [lid, fo] of firstOrderOf) if (fo.startsWith(lifeYear)) lifeScope.add(lid);
      const newBaseRemoved = new Map<string, ClinicBase>();
      const ownHistoryAdded = new Map<string, ClinicBase>();
      for (const id of lifeScope) {
        const lc = classifyClinic({
          firstOrder: firstOrderOf.get(id) ?? "",
          orderDates: orderDatesForLife.get(id) ?? [],
          cutoff: currentEnd,
          hasBaselineRevenue: (baseByClinic.get(id)?.total ?? 0) > 0,
          hasWindowRevenue: (currentByClinic.get(id) ?? 0) > 0,
          priorRevenue: priorOf.get(id)?.rev ?? 0,
        });
        lifeOf.set(id, lc);
        if (lc.isNew) {
          // New clinics carry no baseline: take whatever the baseline window gave them out of every baseline sum.
          const b0 = baseByClinic.get(id);
          if (b0) {
            newBaseRemoved.set(id, b0);
            baseByClinic.delete(id);
          }
        } else if (lc.ownHistoryBaseline) {
          const pr = priorOf.get(id)!;
          const rRev = pr.rev / 365, rOrd = pr.ord / 365;
          const flat = (r: number) => baseCounts.map(c => r * c);
          const nDays = baseDays.length;
          const b1: ClinicBase = {
            rev: flat(rRev), ord: flat(rOrd), bRev: zero(), bOrd: zero(), pat: zero(),
            total: rRev * nDays, orders: rOrd * nDays, patients: 0,
          };
          ownHistoryAdded.set(id, b1);
          baseByClinic.set(id, b1);
        }
      }
      const newMonthRev: number[] = Array(12).fill(0);
      (await pPriorYearMonths).forEach((mrows, mi) => {
        for (const r of mrows) {
          const cid = String(r[`${TABLE}[clinic_id]`] ?? "");
          if ((firstOrderOf.get(cid) ?? "").startsWith(String(priorYearNum))) newMonthRev[mi] += num(r, "rev");
        }
      });
      const priorNewTotal = newMonthRev.reduce((t, x) => t + x, 0);
      const newPhasing = priorNewTotal > 0 ? newMonthRev.map(x => x / priorNewTotal) : undefined;
      const retained: string[] = [];
      for (const [id] of baseByClinic) {
        const lc = lifeOf.get(id);
        if (lc && lc.life === "active" && (currentByClinic.get(id) ?? 0) > 0) retained.push(id);
      }
      retained.sort(
        (a, b) =>
          (baseByClinic.get(b)?.total ?? 0) - (baseByClinic.get(a)?.total ?? 0),
      );
      const topCount = Math.floor(retained.length / 5);
      const retainedLabel = new Map<string, Cohort>();
      retained.forEach((id, i) => {
        retainedLabel.set(
          id,
          i < topCount ? "retained_top20" : "retained_rest",
        );
      });
      // One label per clinic. Active new clinics are the "new" cohort (an Active tier in the trees); silent ones are
      // churned and reactivated ones reactivated, whether they are new or older.
      const actualCohortOf = new Map<string, Cohort>();
      for (const [id, lc] of lifeOf) {
        actualCohortOf.set(
          id,
          lc.life === "churned" ? "churned" : lc.life === "reactivated" ? "reactivated" : lc.isNew ? "new" : (retainedLabel.get(id) ?? "retained_rest"),
        );
      }
      const expectedCohortOf = actualCohortOf;
      const cohortOf = actualCohortOf;

      // Cohort baseline rates by weekday + clinic counts.
      const agg = new Map<Cohort, { totals: number[]; clinics: number }>();
      for (const c of COHORTS) agg.set(c, { totals: zero(), clinics: 0 });
      for (const [id, base] of baseByClinic) {
        const c = expectedCohortOf.get(id);
        if (!c) continue;
        const a = agg.get(c)!;
        for (let i = 0; i < 7; i++) a.totals[i] += base.rev[i];
      }
      for (const [, c] of cohortOf) agg.get(c)!.clinics += 1;
      const cohortBaseline = COHORTS.map(c => ({
        cohort: c,
        rates: ratesFrom(agg.get(c)!.totals, baseCounts, bucket),
        clinics: agg.get(c)!.clinics,
      }));

      // Cohort × day actuals.
      const cohortDayMap = new Map<string, number>();
      for (const row of clinicDays) {
        const c = actualCohortOf.get(row.clinic);
        if (!c) continue;
        const key = `${row.date}|${c}`;
        cohortDayMap.set(key, (cohortDayMap.get(key) ?? 0) + row.revenue);
      }
      const cohortDaily = [...cohortDayMap].map(([key, revenue]) => {
        const [date, cohort] = key.split("|");
        return { date, cohort, revenue };
      });

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 681 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 4c. Product families (level 2 under volume / product mix).
      // product_family lives on the line-level test table but resolves to one
      // combination string per order, so revenue and orders reconcile exactly
      // to the totals above.
      // Sales-rep display names, resolved early (pUsers/pSales are fetched at
      // the top of this action) so the family split below can key by rep name
      // directly instead of carrying raw sales_id through to a later pass.
      const salesName = new Map<string, string>();
      const userRows = await pUsers;
      for (const r of userRows) {
        const id = String(r["internal_user[internal_user_id]"] ?? "");
        const name = String(r["internal_user[internal_user_name]"] ?? "");
        if (id && name && name !== "null") salesName.set(id, name);
      }
      const salesRows = await pSales;
      for (const r of salesRows) {
        const id = String(r["sales_commission_summary[sales_id]"] ?? "");
        const name = String(r["sales_commission_summary[sales_name]"] ?? "");
        if (id && name && !salesName.has(id)) salesName.set(id, name);
      }
      const salesLabelOf = (r: Record<string, unknown>): string => {
        const id = String(r[`${TABLE}[sales_id]`] ?? "").trim();
        if (!id || id === "null") return "—";
        return salesName.get(id) ?? `Sales ${id}`;
      };
      // Keyed `scope|lead|family` — the book-wide view is the sum over leads.
      // A separate, same-shaped `famBaseSales` map (keyed `scope|sales|family`)
      // is filled in the same pass below for the per-rep series; kept as its
      // own map instead of adding a 4th key segment to famBase because
      // scope×lead×sales×family is a much bigger cross-product than
      // scope×lead×family + scope×sales×family and blew the action's memory
      // budget when tried (OOM at 64MB, 2026-09-04).
      const famBase = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      const famBaseSales = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      const leadOf = (r: Record<string, unknown>): string => {
        const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
        return t.length ? t : "—";
      };
      // Each family row is also split by bundle membership so the level-2 list
      // under the product-mix branch only shows families inside bundle orders
      // (and vice versa), instead of repeating the volume branch's list.
      // OOM fix 2026-10-08: drop the promise array so raw DAX rows are GC'd after this loop
      for (const rows of await (async () => {
        const r = await Promise.all(pFamBase!);
        pFamBase = null;
        return r;
      })()) {
        for (const r of rows) {
          const fams = splitFamilies(familyOf(r));
          const i = dow(dateOf(r, "order_date"));
          const rev = num(r, "rev") / fams.length;
          const ord = num(r, "ord");
          const bRev = num(r, "brev") / fams.length;
          const bOrd = num(r, "bord");
          const sales = salesLabelOf(r);
          for (const f of fams) {
            for (const [scope, sRev, sOrd] of [
              ["all", rev, ord],
              ["bundle", bRev, bOrd],
              ["nonbundle", rev - bRev, ord - bOrd],
            ] as Array<[string, number, number]>) {
              if (sRev === 0 && sOrd === 0) continue;
              const k = `${scope}|${leadOf(r)}|${f}`;
              const b = famBase.get(k) ?? {
                rev: zero(),
                ord: zero(),
                total: 0,
                orders: 0,
              };
              b.rev[i] += sRev;
              b.ord[i] += sOrd;
              b.total += sRev;
              b.orders += sOrd;
              famBase.set(k, b);
              const ks = `${scope}|${sales}|${f}`;
              const bs = famBaseSales.get(ks) ?? {
                rev: zero(),
                ord: zero(),
                total: 0,
                orders: 0,
              };
              bs.rev[i] += sRev;
              bs.ord[i] += sOrd;
              bs.total += sRev;
              bs.orders += sOrd;
              famBaseSales.set(ks, bs);
            }
          }
        }
      }
      // New clinics carry no baseline (analytics/lifecycleRules.ts), so what they ordered in the baseline period comes
      // out of the family baselines too, keeping family goals consistent with the headline goal (2026-10-18).
      if (newBaseRemoved.size) {
        const newIdList = [...newBaseRemoved.keys()].filter(cid => /^\d+$/.test(cid));
        const newFamRows: any[][] = await Promise.all(
          Array.from({ length: Math.ceil(newIdList.length / 500) }, (_, ci) =>
            ordersRows({
              by: ["team_lead", "sales_id"], family: true, day: true, start: baselineStart, end: baselineEnd,
              m: { rev: "revenue", ord: "orders", brev: "bundle_revenue", bord: "bundle_orders" },
              filters: [eq(`${O}.clinic_id`, ...newIdList.slice(ci * 500, ci * 500 + 500))],
            }),
          ),
        );
        for (const nrows of newFamRows) {
          for (const r of nrows) {
            const fams = splitFamilies(familyOf(r));
            const i = dow(dateOf(r, "order_date"));
            const rev = num(r, "rev") / fams.length;
            const ord = num(r, "ord");
            const bRev = num(r, "brev") / fams.length;
            const bOrd = num(r, "bord");
            const sales = salesLabelOf(r);
            for (const f of fams) {
              for (const [scope, sRev, sOrd] of [
                ["all", rev, ord],
                ["bundle", bRev, bOrd],
                ["nonbundle", rev - bRev, ord - bOrd],
              ] as Array<[string, number, number]>) {
                if (sRev === 0 && sOrd === 0) continue;
                for (const m2 of [famBase.get(`${scope}|${leadOf(r)}|${f}`), famBaseSales.get(`${scope}|${sales}|${f}`)]) {
                  if (!m2) continue;
                  m2.rev[i] = Math.max(0, m2.rev[i] - sRev);
                  m2.ord[i] = Math.max(0, m2.ord[i] - sOrd);
                  m2.total = Math.max(0, m2.total - sRev);
                  m2.orders = Math.max(0, m2.orders - sOrd);
                }
              }
            }
          }
        }
      }
      const famDays: Array<{
        scope: string;
        lead: string;
        family: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      const famDaysSales: Array<{
        scope: string;
        sales: string;
        family: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      // OOM fix 2026-10-08: drop the promise array so raw DAX rows are GC'd after this loop
      for (const rows of await (async () => {
        const r = await Promise.all(pFamCur!);
        pFamCur = null;
        return r;
      })()) {
        for (const r of rows) {
          const fams = splitFamilies(familyOf(r));
          const date = dateOf(r, "order_date");
          const rev = num(r, "rev") / fams.length;
          const ord = num(r, "ord");
          const bRev = num(r, "brev") / fams.length;
          const bOrd = num(r, "bord");
          const sales = salesLabelOf(r);
          for (const f of fams) {
            for (const [scope, sRev, sOrd] of [
              ["all", rev, ord],
              ["bundle", bRev, bOrd],
              ["nonbundle", rev - bRev, ord - bOrd],
            ] as Array<[string, number, number]>) {
              if (sRev === 0 && sOrd === 0) continue;
              famDays.push({
                scope,
                lead: leadOf(r),
                family: f,
                date,
                revenue: sRev,
                orders: sOrd,
              });
              famDaysSales.push({
                scope,
                sales,
                family: f,
                date,
                revenue: sRev,
                orders: sOrd,
              });
            }
          }
        }
      }

      // Keep the meaningful families; everything small rolls into one bucket so
      // the level-2 list stays readable and still sums to the branch total.
      const famSize = new Map<string, number>();
      for (const [k, b] of famBase) {
        const [scope, , family] = k.split("|");
        if (scope !== "all") continue;
        famSize.set(family, (famSize.get(family) ?? 0) + b.total);
      }
      for (const r of famDays) {
        if (r.scope !== "all") continue;
        famSize.set(r.family, (famSize.get(r.family) ?? 0) + r.revenue);
      }
      const keep = new Set(
        [...famSize]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([f]) => f),
      );
      const OTHER = "Other families";
      const label = (f: string) => (keep.has(f) ? f : OTHER);

      const famBaseRolled = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      for (const [key, b] of famBase) {
        const [scope, , family] = key.split("|");
        const k = `${scope}|${label(family)}`;
        const t = famBaseRolled.get(k) ?? {
          rev: zero(),
          ord: zero(),
          total: 0,
          orders: 0,
        };
        for (let i = 0; i < 7; i++) {
          t.rev[i] += b.rev[i];
          t.ord[i] += b.ord[i];
        }
        t.total += b.total;
        t.orders += b.orders;
        famBaseRolled.set(k, t);
      }
      const familyBaseline = [...famBaseRolled].map(([key, b]) => ({
        scope: key.slice(0, key.indexOf("|")),
        family: key.slice(key.indexOf("|") + 1),
        rates: ratesFrom(b.rev, baseCounts, bucket),
        ordRates: ratesFrom(b.ord, baseCounts, bucket),
        baseRev: b.total,
        baseOrders: b.orders,
      }));

      const famPeriodAgg = new Map<
        string,
        Map<string, { revenue: number; orders: number }>
      >();
      const addFam = (
        periodId: string,
        family: string,
        row: { revenue: number; orders: number },
      ) => {
        const m =
          famPeriodAgg.get(periodId) ??
          new Map<string, { revenue: number; orders: number }>();
        const a = m.get(family) ?? { revenue: 0, orders: 0 };
        a.revenue += row.revenue;
        a.orders += row.orders;
        m.set(family, a);
        famPeriodAgg.set(periodId, m);
      };
      for (const row of famDays) {
        const f = `${row.scope}|${label(row.family)}`;
        addFam("all", f, row);
        addFam(`m:${row.date.slice(0, 7)}`, f, row);
        addFam(`w:${weekStart(row.date)}`, f, row);
        addFam(`d:${row.date}`, f, row);
      }
      const familyPeriod: Array<{
        periodId: string;
        scope: string;
        family: string;
        revenue: number;
        orders: number;
      }> = [];
      for (const [periodId, m] of famPeriodAgg) {
        for (const [key, a] of m) {
          const bar = key.indexOf("|");
          familyPeriod.push({
            periodId,
            scope: key.slice(0, bar),
            family: key.slice(bar + 1),
            ...a,
          });
        }
      }

      // Lead-scoped family series: one document per lead × scope × family with
      // the whole current window inline, so a filtered family list is a few
      // hundred reads instead of a per-period table four times the size.
      type LeadSeries = {
        lead: string;
        scope: string;
        family: string;
        days: Map<string, { rev: number; ord: number }>;
        rev: number[];
        ord: number[];
        baseRev: number;
        baseOrders: number;
      };
      const leadSeries = new Map<string, LeadSeries>();
      const seriesFor = (lead: string, scope: string, family: string) => {
        const k = `${lead}|${scope}|${family}`;
        let e = leadSeries.get(k);
        if (!e) {
          e = {
            lead,
            scope,
            family,
            days: new Map(),
            rev: zero(),
            ord: zero(),
            baseRev: 0,
            baseOrders: 0,
          };
          leadSeries.set(k, e);
        }
        return e;
      };
      for (const [key, b] of famBase) {
        const [scope, lead, family] = key.split("|");
        if (lead === "—") continue;
        const e = seriesFor(lead, scope, label(family));
        for (let i = 0; i < 7; i++) {
          e.rev[i] += b.rev[i];
          e.ord[i] += b.ord[i];
        }
        e.baseRev += b.total;
        e.baseOrders += b.orders;
      }
      for (const row of famDays) {
        if (row.lead === "—") continue;
        const e = seriesFor(row.lead, row.scope, label(row.family));
        const d = e.days.get(row.date) ?? { rev: 0, ord: 0 };
        d.rev += row.revenue;
        d.ord += row.orders;
        e.days.set(row.date, d);
      }
      const familyLeadSeries = [...leadSeries.values()].map(e => ({
        lead: e.lead,
        scope: e.scope,
        family: e.family,
        days: [...e.days]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([d, v2]) => ({ d, rev: v2.rev, ord: v2.ord })),
        rates: ratesFrom(e.rev, baseCounts, bucket),
        ordRates: ratesFrom(e.ord, baseCounts, bucket),
        baseRev: e.baseRev,
        baseOrders: e.baseOrders,
      }));

      // Sales-rep-scoped family series: same shape as familyLeadSeries above,
      // just keyed by individual rep instead of team lead, built from the
      // same famBase/famDays rows so the two views always reconcile — a
      // rep's numbers roll up exactly into their lead's numbers because both
      // are sums over the identical underlying rows, just grouped
      // differently. Requested by Shyam 2026-09-04 so the product-mix panel
      // re-scopes with the rest of the page when a rep is picked.
      type SalesSeries = {
        sales: string;
        scope: string;
        family: string;
        days: Map<string, { rev: number; ord: number }>;
        rev: number[];
        ord: number[];
        baseRev: number;
        baseOrders: number;
      };
      const salesSeries = new Map<string, SalesSeries>();
      const seriesForSales = (sales: string, scope: string, family: string) => {
        const k = `${sales}|${scope}|${family}`;
        let e = salesSeries.get(k);
        if (!e) {
          e = {
            sales,
            scope,
            family,
            days: new Map(),
            rev: zero(),
            ord: zero(),
            baseRev: 0,
            baseOrders: 0,
          };
          salesSeries.set(k, e);
        }
        return e;
      };
      for (const [key, b] of famBaseSales) {
        const [scope, sales, family] = key.split("|");
        if (sales === "—") continue;
        const e = seriesForSales(sales, scope, label(family));
        for (let i = 0; i < 7; i++) {
          e.rev[i] += b.rev[i];
          e.ord[i] += b.ord[i];
        }
        e.baseRev += b.total;
        e.baseOrders += b.orders;
      }
      for (const row of famDaysSales) {
        if (row.sales === "—") continue;
        const e = seriesForSales(row.sales, row.scope, label(row.family));
        const d = e.days.get(row.date) ?? { rev: 0, ord: 0 };
        d.rev += row.revenue;
        d.ord += row.orders;
        e.days.set(row.date, d);
      }
      const familySalesSeries = [...salesSeries.values()].map(e => ({
        sales: e.sales,
        scope: e.scope,
        family: e.family,
        days: [...e.days]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([d, v2]) => ({ d, rev: v2.rev, ord: v2.ord })),
        rates: ratesFrom(e.rev, baseCounts, bucket),
        ordRates: ratesFrom(e.ord, baseCounts, bucket),
        baseRev: e.baseRev,
        baseOrders: e.baseOrders,
      }));

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 1052 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 4b. Clinic identity (practice name, dominant state, owning salesperson).
      // salesName was already built above, right before the family split.
      const identityRows = await pIdentity;
      type Identity = {
        name: string;
        state: string;
        country: string;
        teamLead: string;
        sales: string;
        rev: number;
      };
      const identity = new Map<string, Identity>();
      for (const r of identityRows) {
        const id = String(r[`${TABLE}[clinic_id]`]);
        const rev = num(r, "rev");
        const prev = identity.get(id);
        if (prev && prev.rev >= rev) continue;
        const salesId = String(r[`${TABLE}[sales_id]`] ?? "");
        identity.set(id, {
          name: String(r[`${TABLE}[customer_practice_name]`] ?? `Clinic ${id}`),
          state: String(r[`${TABLE}[state]`] ?? "(blank)"),
          country: String(r[`${TABLE}[country_name]`] ?? "").trim() || "—",
          teamLead: (() => {
            const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
            return t && t !== "null" ? t : "—";
          })(),
          sales:
            salesName.get(salesId) ??
            (salesId && salesId !== "null" ? `Sales ${salesId}` : "—"),
          rev,
        });
      }

      // State baseline (order-level state pull) made consistent with the clinic baselines: new clinics carry none, and
      // clinics on an own-history baseline add theirs, each in the clinic's dominant state.
      for (const [cid, b0] of newBaseRemoved) {
        const st = identity.get(cid)?.state ?? "(blank)";
        const arr = stateTotals.get(st);
        if (arr) for (let i = 0; i < 7; i++) arr[i] = Math.max(0, arr[i] - b0.rev[i]);
      }
      for (const [cid, b1] of ownHistoryAdded) {
        const st = identity.get(cid)?.state ?? "(blank)";
        const arr = stateTotals.get(st) ?? [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 7; i++) arr[i] += b1.rev[i];
        stateTotals.set(st, arr);
      }
      const stateBaseline = [...stateTotals].map(([state, totals]) => ({
        state,
        rates: ratesFrom(totals, baseCounts, bucket),
      }));

      // VA target list rows: join the trailing-12-month VA stats onto the
      // same clinic identity map used everywhere else.
      const vaTargetRows = await pVaTarget;
      const vaClinicTarget = vaTargetRows
        .map(r => {
          const id = String(r[`${TABLE}[clinic_id]`]);
          const idty = identity.get(id);
          return {
            clinic: id,
            name: idty?.name ?? `Clinic ${id}`,
            state: idty?.state ?? "(blank)",
            sales: idty?.sales ?? "—",
            teamLead: idty?.teamLead ?? "—",
            vaOrders: num(r, "vaOrd"),
            vaRevenue: num(r, "vaRev"),
            allOrders: num(r, "allOrd"),
            allRevenue: num(r, "allRev"),
            windowDays: vaWindowDays,
          };
        })
        .filter(row => row.vaOrders > 0);

      const orderDatesOf = await pOrderDateHistory;
      const rhythmOf = new Map<
        string,
        { medianGapBd: number; bdSinceLastOrder: number }
      >();
      for (const [clinic, dates] of orderDatesOf) {
        const r = buyingRhythm(dates, currentEnd);
        if (r) rhythmOf.set(clinic, r);
      }

      const lastOrderRows = await pLastOrderAsOf;
      const lastOrderAllTimeOf = new Map<string, string>();
      for (const r of lastOrderRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        const last = String(r["[last]"] ?? "").slice(0, 10);
        if (id && last) lastOrderAllTimeOf.set(id, last);
      }

      const lifetimeRows = await pLifetimeAsOf;
      const lifetimeRevOf = new Map<string, number>();
      const lifetimeDedRateOf = new Map<string, number>();
      for (const r of lifetimeRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (!id) continue;
        const rev = num(r, "rev");
        const ded = num(r, "ded");
        lifetimeRevOf.set(id, rev);
        if (rev > 0) lifetimeDedRateOf.set(id, ded / rev);
      }

      const ytdVaRows = await pYtdVa;
      const ytdVaOrdersOf = new Map<string, number>();
      for (const r of ytdVaRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (id) ytdVaOrdersOf.set(id, num(r, "vaOrd"));
      }

      // Last HubSpot touch date per clinic: orders[hubspot_id] IS a
      // contact_id (see the query comment above), so the join is a direct
      // lookup — no intermediate mapping table. A missing entry still means
      // "couldn't verify" (blank hubspot_id on every one of the clinic's
      // orders, or no touchpoint row for that contact), not "never touched"
      // (flags.ts keeps those cases apart via touchDataAvailable).
      const hubspotRows = await pOrderHubspotClinic;
      const clinicOfHubspotId = new Map<
        string,
        { clinic: string; rev: number }
      >();
      for (const r of hubspotRows) {
        const hubspotId = String(r[`${TABLE}[hubspot_id]`] ?? "");
        const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (!hubspotId || !clinic) continue;
        const rev = num(r, "rev");
        const prev = clinicOfHubspotId.get(hubspotId);
        if (!prev || rev > prev.rev)
          clinicOfHubspotId.set(hubspotId, { clinic, rev });
      }
      const touchRows = await pTouchAsOf;
      const lastTouchOf = new Map<string, string>();
      for (const r of touchRows) {
        // The touchpoint table's contact_id IS the order table's hubspot_id
        // (same key space, direct model relationship) — no customer_id hop.
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const last = String(r["[last]"] ?? "").slice(0, 10);
        if (!contact || !last) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const cur = lastTouchOf.get(clinic);
        if (!cur || last > cur) lastTouchOf.set(clinic, last);
      }
      // Per-clinic sorted Call/Meeting touch dates within window, for the
      // Provider Retention Funnel's "had a call/meeting" filter.
      const touchDatesOf = new Map<string, string[]>();
      for (const r of await pTouchDatesRaw) {
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const date = String(
          r["customer_journey_final[touchpoint_date]"] ?? "",
        ).slice(0, 10);
        if (!contact || !date) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const arr = touchDatesOf.get(clinic) ?? [];
        arr.push(date);
        touchDatesOf.set(clinic, arr);
      }
      for (const arr of touchDatesOf.values()) arr.sort();
      // Per-clinic sorted Clinical Activity (consult/VCT) touch dates
      // within window — same shape as touchDatesOf, separate bucket.
      const clinicalTouchDatesOf = new Map<string, string[]>();
      for (const r of await pClinicalTouchDatesRaw) {
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const date = String(
          r["customer_journey_final[touchpoint_date]"] ?? "",
        ).slice(0, 10);
        if (!contact || !date) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const arr = clinicalTouchDatesOf.get(clinic) ?? [];
        arr.push(date);
        clinicalTouchDatesOf.set(clinic, arr);
      }
      for (const arr of clinicalTouchDatesOf.values()) arr.sort();

      // Portfolio Changes gives per-clinic test-level movement; roll it up to
      // a set of statuses per clinic so the drill lists can be filtered by it.
      const pcRows = await pPortfolio;
      const statusOf = new Map<string, string[]>();
      for (const r of pcRows) {
        const id = String(r["Portfolio Changes[Clinic Id]"] ?? "");
        const st = String(r["Portfolio Changes[Status]"] ?? "").trim();
        if (!id || !st || st === "null") continue;
        const cur = statusOf.get(id) ?? [];
        if (!cur.includes(st)) cur.push(st);
        statusOf.set(id, cur);
      }

      // New-logo risk groups (level 2 under the new-clinics branch). Computed
      // over the current window only, from the clinic's own order days.
      const curStat = new Map<string, { last: string; orders: number }>();
      for (const row of clinicDays) {
        const st = curStat.get(row.clinic) ?? { last: "", orders: 0 };
        if (row.date > st.last) st.last = row.date;
        // Count distinct order-DAYS, not raw order rows (Shyam, 2026-09-28:
        // "getting to order 4" numbers didn't match the Provider Retention
        // Funnel). newClinicOrderSeq below defines "order N" as the Nth
        // calendar day with orders > 0 (a clinic that places two orders the
        // same day is still one "order-day"); this stage classification has
        // to use the identical definition or the two funnels drift apart
        // whenever a clinic places >1 order on a single day.
        if (row.orders > 0) st.orders += 1;
        curStat.set(row.clinic, st);
      }
      // Simple funnel (level 2 under the new-clinics branch): every new client
      // reached order 1; membership is CUMULATIVE, so a clinic with 3 orders
      // counts in f1, f2 and f3. "active" is the last rung of the ladder —
      // it requires having reached order 3 AND still ordering (last order in
      // the last 14 days of the window), not a separate recency-only flag.
      // Each stage is compared with the baseline window's own new clients on
      // the same daily pace.
      const newGroupsOf = new Map<string, string[]>();
      for (const [id, rev] of currentByClinic) {
        // New in the analysis window, silent or not: the funnel shows drop-offs.
        if (rev <= 0 || !firstIn(id, currentStart, currentEnd)) continue;
        const st = curStat.get(id);
        if (!st) continue;
        newGroupsOf.set(
          id,
          newClinicFunnelGroups(st.orders, diffDays(st.last, currentEnd)),
        );
      }

      // The same grouping over the baseline window's own new logos, so each
      // group can be read as up or down rather than as a raw count.
      const baseNewGroups = new Map<
        string,
        { clinics: number; orders: number; revenue: number }
      >();
      const bump = (
        key: string,
        lead: string,
        orders: number,
        revenue: number,
      ) => {
        const k = `${lead}\u0000${key}`;
        const cur = baseNewGroups.get(k) ?? {
          clinics: 0,
          orders: 0,
          revenue: 0,
        };
        cur.clinics += 1;
        cur.orders += orders;
        cur.revenue += revenue;
        baseNewGroups.set(k, cur);
      };
      for (const [id, b] of baseByClinic) {
        if (!firstIn(id, baselineStart, baselineEnd)) continue;
        const last = baseLast.get(id) ?? baselineStart;
        const lead = identity.get(id)?.teamLead ?? "—";
        for (const k of [
          ...newClinicFunnelGroups(b.orders, diffDays(last, baselineEnd)),
          "__all__",
        ]) {
          bump(k, "", b.orders, b.total);
          bump(k, lead, b.orders, b.total);
        }
      }
      const baseDaysCount = diffDays(baselineStart, baselineEnd) + 1;
      const curDaysCount = diffDays(currentStart, currentEnd) + 1;
      const newLogoBaseline = [...baseNewGroups].map(([k, v2]) => {
        const [lead, key] = k.split("\u0000");
        return {
          key,
          lead,
          clinics: v2.clinics,
          orders: v2.orders,
          revenue: v2.revenue,
          baseDays: baseDaysCount,
          curDays: curDaysCount,
        };
      });

      const clinicYtdRows = await pClinicYtd;
      const ytdOf = new Map<string, { rev: number; ord: number }>();
      for (const r of clinicYtdRows) {
        ytdOf.set(String(r[`${TABLE}[clinic_id]`]), {
          rev: num(r, "rev"),
          ord: num(r, "ord"),
        });
      }
      const clinicFwdRows = await pClinicFwd;
      const fwdOf = new Map<string, { rev: number; ord: number }>();
      for (const r of clinicFwdRows) {
        fwdOf.set(String(r[`${TABLE}[clinic_id]`]), {
          rev: num(r, "rev"),
          ord: num(r, "ord"),
        });
      }

      // Clinic actuals rolled up to every selectable period.
      type Agg = {
        revenue: number;
        orders: number;
        bundleRevenue: number;
        bundleOrders: number;
        patients: number;
      };
      const periodAgg = new Map<string, Map<string, Agg>>();
      const addTo = (periodId: string, clinic: string, row: Agg) => {
        const m = periodAgg.get(periodId) ?? new Map<string, Agg>();
        const a = m.get(clinic) ?? {
          revenue: 0,
          orders: 0,
          bundleRevenue: 0,
          bundleOrders: 0,
          patients: 0,
        };
        a.revenue += row.revenue;
        a.orders += row.orders;
        a.bundleRevenue += row.bundleRevenue;
        a.bundleOrders += row.bundleOrders;
        a.patients += row.patients;
        m.set(clinic, a);
        periodAgg.set(periodId, m);
      };
      for (const row of clinicDays) {
        addTo("all", row.clinic, row);
        addTo(`q:${quarterKey(row.date)}`, row.clinic, row);
        addTo(`m:${row.date.slice(0, 7)}`, row.clinic, row);
        addTo(`w:${weekStart(row.date)}`, row.clinic, row);
        addTo(`d:${row.date}`, row.clinic, row);
      }
      const clinicPeriod: Array<
        {
          periodId: string;
          clinic: string;
          expectedRevenue?: number;
          expectedOrdersP75?: number;
        } & Agg
      > = [];
      for (const [periodId, m] of periodAgg) {
        for (const [clinic, a] of m) {
          clinicPeriod.push({ periodId, clinic, ...a });
        }
      }

      // Last-3-months order cadence per clinic, precomputed here (not at
      // dashboard query time) so the feed's "cheap top-20%"/"slipping" cards
      // don't need extra full-book collects — reuses `periodAgg`'s already-
      // built "m:{month}" buckets, same window definition feed.ts itself
      // uses (eachDay(currentStart, currentEnd) grouped by month).
      const cadenceMonths = [
        ...new Set(eachDay(currentStart, currentEnd).map(d => d.slice(0, 7))),
      ]
        .sort()
        .slice(-3);
      const monthOrdersOf = new Map<string, number>();
      const monthSeriesOf = new Map<string, number[]>();
      for (const clinic of cohortOf.keys()) {
        const series = cadenceMonths.map(
          mk => periodAgg.get(`m:${mk}`)?.get(clinic)?.orders ?? 0,
        );
        monthSeriesOf.set(clinic, series);
        monthOrdersOf.set(clinic, series.filter(o => o > 0).length);
      }

      const clinicMeta = [...cohortOf].map(([clinic, cohort]) => {
        const b = baseByClinic.get(clinic);
        const idty = identity.get(clinic);
        const ytd = ytdOf.get(clinic);
        const fwd = fwdOf.get(clinic);
        return {
          clinic,
          name: idty?.name ?? `Clinic ${clinic}`,
          state: idty?.state ?? "(blank)",
          country: idty?.country ?? "—",
          teamLead: idty?.teamLead ?? "—",
          sales: idty?.sales ?? "—",
          cohort,
          isNew: lifeOf.get(clinic)?.isNew ?? false,
          life: lifeOf.get(clinic)?.life ?? "active",
          typicalGap: lifeOf.get(clinic)?.typicalGap ?? undefined,
          ownBaseline: lifeOf.get(clinic)?.ownHistoryBaseline ?? false,
          rev: ratesFrom(b?.rev ?? zero(), baseCounts, bucket),
          ord: ratesFrom(b?.ord ?? zero(), baseCounts, bucket),
          bRev: ratesFrom(b?.bRev ?? zero(), baseCounts, bucket),
          bOrd: ratesFrom(b?.bOrd ?? zero(), baseCounts, bucket),
          pat: ratesFrom(b?.pat ?? zero(), baseCounts, bucket),
          baseRev: b?.total ?? 0,
          baseOrders: b?.orders ?? 0,
          basePatients: b?.patients ?? 0,
          pstatus: statusOf.get(clinic) ?? [],
          firstOrder: firstOrderOf.get(clinic) ?? "",
          lastOrder: curStat.get(clinic)?.last ?? "",
          newGroups: newGroupsOf.get(clinic) ?? [],
          // Distinct order-DAYS this window (Shyam, 2026-09-28 mismatch
          // report): the new-clinic funnel's stage fallback in
          // matchesFocus() needs the SAME "one order = one calendar day"
          // definition newClinicOrderSeq uses, not the raw transaction
          // count `windowOrders`/`orders` carries elsewhere (a clinic
          // placing two orders one day is one order-day, not two).
          windowOrderDays: curStat.get(clinic)?.orders ?? 0,
          ytdRevenue: ytd?.rev ?? 0,
          ytdOrders: ytd?.ord ?? 0,
          fwdRevenue: fwd?.rev ?? 0,
          fwdOrders: fwd?.ord ?? 0,
          monthOrders: monthOrdersOf.get(clinic) ?? 0,
          monthSeries: monthSeriesOf.get(clinic) ?? [],
          // Clinic-health source inputs — see convex/flags.ts.
          lastOrderAllTime: lastOrderAllTimeOf.get(clinic) ?? "",
          vaYtdPct: (() => {
            const ytdOrders = ytd?.ord ?? 0;
            if (!ytdOrders) return undefined;
            const vaOrders = ytdVaOrdersOf.get(clinic) ?? 0;
            return vaOrders / ytdOrders;
          })(),
          lifetimeRevenue: lifetimeRevOf.get(clinic) ?? 0,
          lifetimeDeductionRate: lifetimeDedRateOf.get(clinic),
          lastTouchDate: lastTouchOf.get(clinic),
          touchDataAvailable: lastTouchOf.has(clinic),
          medianGapBd: rhythmOf.get(clinic)?.medianGapBd,
          bdSinceLastOrder: rhythmOf.get(clinic)?.bdSinceLastOrder,
          signupDate: clinicSignupOf.get(clinic),
        };
      });

      // Provider Retention Funnel (Shyam, 2026-09-28): per-new-clinic order
      // sequence, built from `clinicDays` we already pulled for this window
      // (no extra Power BI cost) — every "new" clinic's first order is
      // guaranteed inside [currentStart, currentEnd], and so is every later
      // order up to the data cutoff, so this window's clinicDays fully
      // covers the cohort. One "order" = one calendar day with orders > 0
      // (a day's total revenue stands in for that day's order revenue —
      // approximate when a clinic places >1 order the same day, acceptable
      // for a funnel read). Capped at the first 5 order-days per clinic.
      // MoM/QoQ decoupling (Shyam, 2026-09-29): the sequence now spans the
      // baseline window too (baselineStart..currentEnd, already pulled — no
      // extra Power BI cost), so prior month/quarter cohorts (e.g. Q2 new
      // clinics) exist for the comparison regardless of the window selected.
      // The headline funnel still filters on firstOrder-in-window, so its
      // numbers are unchanged.
      const seqStart =
        baselineStart < currentStart ? baselineStart : currentStart;
      const daysByClinic = new Map<
        string,
        Array<{ date: string; revenue: number }>
      >();
      const seenDay = new Set<string>();
      for (const row of [...clinicBaseDays, ...clinicDays]) {
        if (row.orders <= 0) continue;
        const k = `${row.clinic}|${row.date}`;
        if (seenDay.has(k)) continue;
        seenDay.add(k);
        const arr = daysByClinic.get(row.clinic) ?? [];
        arr.push({ date: row.date, revenue: row.revenue });
        daysByClinic.set(row.clinic, arr);
      }
      const newClinicOrderSeq = [...firstOrderOf]
        .filter(([, f]) => f >= seqStart && f <= currentEnd)
        .map(([clinic]) => {
          const seq = (daysByClinic.get(clinic) ?? [])
            .sort((a, b) => (a.date < b.date ? -1 : 1))
            .slice(0, 5);
          const idty = identity.get(clinic);
          return {
            clinic,
            name: idty?.name ?? `Clinic ${clinic}`,
            sales: idty?.sales ?? "—",
            teamLead: idty?.teamLead,
            firstOrder: firstOrderOf.get(clinic) ?? "",
            // Day-scoped signup for the order-1 conversion gap (falls back
            // to the clinic-wide earliest signup if that specific day has
            // no match, e.g. a data gap) — see pClinicSignupByDay comment.
            signupDate:
              (seq[0] && signupByClinicDay.get(`${clinic}|${seq[0].date}`)) ??
              clinicSignupOf.get(clinic),
            orderDates: seq.map(s => s.date),
            orderRevenue: seq.map(s => s.revenue),
            // Sorted Call/Meeting touch dates in-window (Shyam, 2026-09-29
            // funnel filter) — undefined/[] means "no mapped touch data",
            // same caveat as touchDataAvailable elsewhere in this file.
            touchDates: touchDatesOf.get(clinic) ?? [],
            // Clinical Activity (consult/VCT) touch dates in-window, same
            // shape/caveat as touchDates.
            clinicalTouchDates: clinicalTouchDatesOf.get(clinic) ?? [],
          };
        })
        .filter(r => r.firstOrder && r.orderDates.length > 0);

      // Lead signups by rep, day-grain (same funnel's top "Signup" bar).
      const signupDayMap = new Map<string, number>();
      for (const r of await pSignups) {
        const id = String(r["customers_bq[sales_id]"] ?? "").trim();
        const sales =
          id && id !== "null" ? (salesName.get(id) ?? `Sales ${id}`) : "—";
        const date = String(
          r["customers_bq[customer_signup_time]"] ?? "",
        ).slice(0, 10);
        if (!date) continue;
        const key = `${date}|${sales}`;
        signupDayMap.set(key, (signupDayMap.get(key) ?? 0) + 1);
      }
      const signupDaily = [...signupDayMap].map(([key, count]) => {
        const [date, sales] = key.split("|");
        return { date, sales, count };
      });
      const ordOf = new Map<string, { fo: string; cl: string; pr: string }>();
      for (const r of await pSignupOrd) {
        ordOf.set(String(r[`${TABLE}[customer_id]`]), {
          fo: String(r["[fo]"] ?? "").slice(0, 10),
          cl: String(r["[cl]"] ?? ""),
          pr: String(r["[pr]"] ?? ""),
        });
      }
      const signupLead = (await pSignups).flatMap(r => {
        const date = String(r["customers_bq[customer_signup_time]"] ?? "").slice(0, 10);
        if (!date) return [];
        const id = String(r["customers_bq[sales_id]"] ?? "").trim();
        const sales = id && id !== "null" ? (salesName.get(id) ?? `Sales ${id}`) : "—";
        const customerId = String(r["customers_bq[customer_id]"] ?? "");
        const nm = [r["customers_bq[customer_first_name]"], r["customers_bq[customer_last_name]"]]
          .map(x => String(x ?? "").trim()).filter(x => x && x !== "null").join(" ");
        const suf = String(r["customers_bq[customer_suffix]"] ?? "").trim();
        const st = String(r["customers_bq[state]"] ?? "").trim();
        const o = ordOf.get(customerId);
        return [{
          date, sales, customerId,
          name: (nm || `Customer ${customerId}`) + (suf && suf !== "null" ? `, ${suf}` : ""),
          ...(st && st !== "null" ? { state: st } : {}),
          ...(o?.fo ? { firstOrder: o.fo } : {}),
          ...(o?.cl && o.cl !== "null" ? { clinic: o.cl } : {}),
          ...(o?.pr && o.pr !== "null" ? { practice: o.pr } : {}),
        }];
      });

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 1525 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 4c. Year-end projection.
      const ytdRow = (await pYtd)[0] ?? {};
      const ytdRevenue = num(ytdRow, "rev");
      const ytdOrders = num(ytdRow, "ord");

      // Forward run rate: the trailing 13 weeks of actuals, per weekday.
      const fwdStart = addDays(currentEnd, -90);
      const fwdRev = [0, 0, 0, 0, 0, 0, 0];
      const fwdOrd = [0, 0, 0, 0, 0, 0, 0];
      const fwdN = [0, 0, 0, 0, 0, 0, 0];
      for (const d of daily) {
        if (d.date < fwdStart || d.date > currentEnd) continue;
        const i = dow(d.date);
        fwdRev[i] += d.revenue;
        fwdOrd[i] += d.orders;
        fwdN[i] += 1;
      }
      const fwdRates = fwdRev.map((v2, i) => (fwdN[i] ? v2 / fwdN[i] : 0));
      const fwdOrdRates = fwdOrd.map((v2, i) => (fwdN[i] ? v2 / fwdN[i] : 0));

      // Prior-year seasonal factor per calendar day: that day's revenue last
      // year against the median of the same weekday in a normal stretch of last
      // year. Holidays land near zero on their own.
      const priorRows = await pPrior;
      const priorRev = new Map<string, number>();
      for (const row of priorRows) {
        priorRev.set(dateOf(row, "order_date"), num(row, "rev"));
      }
      const refFrom = `${Number(currentEnd.slice(0, 4)) - 1}-06-01`;
      const refTo = `${Number(currentEnd.slice(0, 4)) - 1}-10-31`;
      const refByDow: number[][] = [[], [], [], [], [], [], []];
      for (const [d, v2] of priorRev) {
        if (d >= refFrom && d <= refTo) refByDow[dow(d)].push(v2);
      }
      const median = (xs: number[]): number => {
        if (!xs.length) return 0;
        const s = [...xs].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };
      const refMedian = refByDow.map(median);

      const projDays: Array<{
        date: string;
        factor: number;
        rev: number;
        ord: number;
      }> = [];
      const holidays: string[] = [];
      const yearEnd = `${currentEnd.slice(0, 4)}-12-31`;
      for (const d of eachDay(addDays(currentEnd, 1), yearEnd)) {
        // Prior-year counterpart: same weekday and occurrence in the month, so
        // floating holidays line up. Fixed-date holidays use the calendar date.
        const shadow = FIXED_DATE_HOLIDAYS.includes(d.slice(5))
          ? `${Number(d.slice(0, 4)) - 1}-${d.slice(5)}`
          : priorYearSameWeekday(d);
        const ref = refMedian[dow(d)];
        const seen = priorRev.get(shadow);
        let factor = 1;
        // A fixed-date holiday fell on a different weekday last year, so
        // normalise it against that weekday's median, not this one's.
        const refShadow = refMedian[dow(shadow)] || ref;
        if (refShadow > 0 && seen !== undefined) factor = seen / refShadow;
        else if (refShadow > 0 && seen === undefined) factor = 0; // closed last year
        factor = Math.max(0, Math.min(2, factor));
        if (factor < 0.5 && dow(d) >= 1 && dow(d) <= 5) holidays.push(d);
        projDays.push({
          date: d,
          factor,
          rev: fwdRates[dow(d)] * factor,
          ord: fwdOrdRates[dow(d)] * factor,
        });
      }

      // Per-team-lead projection inputs: their own year-to-date, and their
      // share of the trailing-13-week run rate that the forward curve is built
      // from, so a filtered projection uses the filtered book's own pace.
      const leadName = (r: Record<string, unknown>) => {
        const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
        return t.length ? t : "—";
      };
      const fwdLeadRows = await pFwdLead;
      const fwdLeadTotal = fwdLeadRows.reduce((s2, r) => s2 + num(r, "rev"), 0);
      const fwdLeadOrdTotal = fwdLeadRows.reduce(
        (s2, r) => s2 + num(r, "ord"),
        0,
      );
      const fwdShare = new Map<string, { rev: number; ord: number }>();
      for (const r of fwdLeadRows) {
        fwdShare.set(leadName(r), {
          rev: fwdLeadTotal ? num(r, "rev") / fwdLeadTotal : 0,
          ord: fwdLeadOrdTotal ? num(r, "ord") / fwdLeadOrdTotal : 0,
        });
      }
      const projLeads = (await pYtdLead)
        .map(r => {
          const lead = leadName(r);
          const sh = fwdShare.get(lead) ?? { rev: 0, ord: 0 };
          return {
            lead,
            ytdRevenue: num(r, "rev"),
            ytdOrders: num(r, "ord"),
            share: sh.rev,
            ordShare: sh.ord,
          };
        })
        .filter(l => l.lead !== "—");

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 1633 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 4d. Rolling P75 baselines scoped to clinic / team lead / RSM
      // (2026-09-28, Thiru: the earlier company-wide rolling-P75 fix left
      // these scoped views on the old static day-of-week-rate × flat P75
      // scalar; validated against Power BI that a team lead's/RSM's own
      // headline baseline has to come from THEIR OWN aggregated daily
      // revenue run through the same trailing formula, not a sum of each
      // clinic's individual baseline — P75 does not distribute over a sum).
      //
      // clinicBaseDays (baseline window, per-clinic-per-day, collected above)
      // + clinicDays (current window, per-clinic-per-day) together already
      // span baselineStart..currentEnd with no gap (baselineEnd is the day
      // before currentStart), which is enough trailing history for every
      // selectable period's own rolling lookback — no extra Power BI pull
      // needed, this data was already being fetched and discarded into
      // day-of-week averages only.
      const clinicDateRev = new Map<string, Map<string, number>>();
      const clinicDateOrd = new Map<string, Map<string, number>>();
      const addClinicDay = (
        clinic: string,
        date: string,
        rev: number,
        ord: number,
      ) => {
        const rm = clinicDateRev.get(clinic) ?? new Map<string, number>();
        rm.set(date, (rm.get(date) ?? 0) + rev);
        clinicDateRev.set(clinic, rm);
        const om = clinicDateOrd.get(clinic) ?? new Map<string, number>();
        om.set(date, (om.get(date) ?? 0) + ord);
        clinicDateOrd.set(clinic, om);
      };
      for (const r of clinicBaseDays)
        addClinicDay(r.clinic, r.date, r.revenue, r.orders);
      for (const r of clinicDays)
        addClinicDay(r.clinic, r.date, r.revenue, r.orders);

      // Same daily history, aggregated by team lead and by RSM (sales rep)
      // via the identity map already built above — this is the "filter by
      // RSM first, then sum revenue per day" step Power BI's slicer does.
      const leadDateRev = new Map<string, Map<string, number>>();
      const leadDateOrd = new Map<string, Map<string, number>>();
      const salesDateRev = new Map<string, Map<string, number>>();
      const salesDateOrd = new Map<string, Map<string, number>>();
      const bumpScope = (
        store: Map<string, Map<string, number>>,
        key: string,
        date: string,
        v2: number,
      ) => {
        const m = store.get(key) ?? new Map<string, number>();
        m.set(date, (m.get(date) ?? 0) + v2);
        store.set(key, m);
      };
      const allClinicDays = [...clinicBaseDays, ...clinicDays];
      for (const r of allClinicDays) {
        const idty = identity.get(r.clinic);
        const lead = idty?.teamLead ?? "—";
        const sales = idty?.sales ?? "—";
        if (lead !== "—") {
          bumpScope(leadDateRev, lead, r.date, r.revenue);
          bumpScope(leadDateOrd, lead, r.date, r.orders);
        }
        if (sales !== "—") {
          bumpScope(salesDateRev, sales, r.date, r.revenue);
          bumpScope(salesDateOrd, sales, r.date, r.orders);
        }
      }

      const defs = periodDefs(currentStart, currentEnd);
      // Merged straight into the existing `clinicPeriod` rows (not a new
      // table) — drill()'s per-clinic query already collects the whole
      // clinicMeta + clinicPeriod tables every call, and adding a THIRD
      // ~7k-row collect for a separate baseline table pushed a few callers
      // (wins.ts's company-wide drill) over Convex's 16MB per-query byte
      // cap. Two more optional numbers on an already-collected row costs far
      // less than an extra collect.
      const clinicBaselineMap = new Map<
        string,
        { expectedRevenue: number; expectedOrders: number }
      >();
      // Perf (2026-10-08): prod refresh stalled here — baselinePlan was
      // rebuilt for every clinic×period and baselines were computed for
      // pairs with no clinicPeriod row. Build each plan once; only compute
      // needed pairs.
      const planOf = new Map(
        defs.map(d => [d.id, baselinePlan(d.kind, d.days)]),
      );
      const defById = new Map(defs.map(d => [d.id, d]));
      for (const row of clinicPeriod) {
        const key = `${row.periodId}|${row.clinic}`;
        if (clinicBaselineMap.has(key)) continue;
        const def = defById.get(row.periodId);
        const rm = clinicDateRev.get(row.clinic);
        if (!def || !rm) continue;
        const om = clinicDateOrd.get(row.clinic)!;
        const plan = planOf.get(def.id)!;
        clinicBaselineMap.set(key, {
          expectedRevenue: rollingBaseline(
            def.kind,
            def.days,
            d => rm.get(d) ?? 0,
            plan,
            { sparseFallback: true },
          ),
          expectedOrders: rollingBaseline(
            def.kind,
            def.days,
            d => om.get(d) ?? 0,
            plan,
            { sparseFallback: true },
          ),
        });
      }
      for (const row of clinicPeriod) {
        const b = clinicBaselineMap.get(`${row.periodId}|${row.clinic}`);
        if (b) {
          row.expectedRevenue = b.expectedRevenue;
          row.expectedOrdersP75 = b.expectedOrders;
        }
      }
      // Top-down allocation [Shyam, 2026-10-12]: overall → geo → rep×geo;
      // reps/leads are sums of their cells. Clinic P75 stays unscaled.
      const td = topDownAllocate({ defs, planOf, days: allClinicDays, identity, rates: clinicMeta.map(m => ({ clinic: m.clinic, rev: m.rev, ord: m.ord })), companyDaily: daily, target: { annual: cfg.annualTarget ?? 130_000_000, year: Number(currentEnd.slice(0, 4)), newSlice: (cfg as { newBusinessGoal?: number }).newBusinessGoal ?? (priorNewTotal || 0.05 * (cfg.annualTarget ?? 130_000_000)), newPhasing, newDefaultSlice: priorNewTotal || undefined } });
      const leadPeriodBaseline = td.lead;
      const salesPeriodBaseline = td.sales;
      // Clinic expectations are no longer scaled to reps: every clinic's goal is its baseline x the period goal factor (baseline.ts).
      // Reverted state layer [Shyam, 2026-10-12]: no geo plan rows; geo views
      // sum the (top-down scaled) clinic rows instead.
      const geoPeriodBaseline: Array<any> = [];

      const pullSecs = Math.round((Date.now() - startedAt) / 1000);

      await ctx.runMutation(internal.ingest.progressLog, {
        id: logId,
        message: `Refreshing… phase 1828 @${Math.round((Date.now() - startedAt) / 1000)}s rss ${Math.round((globalThis as any).process.memoryUsage().rss / 1e6)}MB`,
      });
      // 5. Swap in the new data. Rows carry a generation number and readers
      // only see the current one, so we insert first, flip the pointer, and
      // delete the previous generation afterwards off the critical path —
      // deleting ~85k rows inline used to cost about two minutes.
      const gen: number = await ctx.runMutation(internal.config.reserveGen, {});
      const writes: Array<() => Promise<unknown>> = [
        ...chunk(daily, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putDailyTotals, { rows, gen }),
        ),
        ...chunk(stateDaily, 800).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putStateDaily, { rows, gen }),
        ),
        ...chunk(stateBaseline, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putStateBaseline, { rows, gen }),
        ),
        ...chunk(cohortDaily, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putCohortDaily, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putCohortBaseline, {
            rows: cohortBaseline,
            gen,
          }),
        ...chunk(newLogoBaseline, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putNewLogoBaseline, { rows, gen }),
        ),
        ...chunk(clinicMeta, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putClinicMeta, { rows, gen }),
        ),
        ...chunk(newClinicOrderSeq, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putNewClinicOrderSeq, {
              rows,
              gen,
            }),
        ),
        ...chunk(signupDaily, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSignupDaily, { rows, gen }),
        ),
        ...chunk(signupLead, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSignupLead, { rows, gen }),
        ),
        ...chunk(vaClinicTarget, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putVaClinicTarget, { rows, gen }),
        ),
        ...chunk(clinicPeriod, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putClinicPeriod, { rows, gen }),
        ),
        ...chunk(leadPeriodBaseline, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putLeadPeriodBaseline, {
              rows,
              gen,
            }),
        ),
        ...chunk(salesPeriodBaseline, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSalesPeriodBaseline, {
              rows,
              gen,
            }),
        ),
        ...chunk(td.periodGoal, 500).map(
          rows => () => ctx.runMutation(internal.ingest.putPeriodGoal, { rows, gen }),
        ),
        ...chunk(geoPeriodBaseline, 150).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putGeoPeriodBaseline, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putFamilyBaseline, {
            rows: familyBaseline,
            gen,
          }),
        ...chunk(familyPeriod, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilyPeriod, { rows, gen }),
        ),
        ...chunk(familyLeadSeries, 40).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilyLeadSeries, { rows, gen }),
        ),
        ...chunk(familySalesSeries, 40).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilySalesSeries, {
              rows,
              gen,
            }),
        ),
        ...chunk(channelDaily, 800).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putChannelDaily, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putProjection, {
            row: {
              ytdStart: yearStart,
              ytdEnd: currentEnd,
              ytdRevenue,
              ytdOrders,
              fwdRates,
              fwdOrdRates,
              days: projDays,
              holidays,
              leads: projLeads,
            },
            gen,
          }),
        () =>
          ctx.runMutation(internal.ingest.putChannelBaseline, {
            rows: channelBaseline,
            gen,
          }),
      ];
      // Inserts of distinct documents don't conflict, so these can overlap —
      // but Convex caps bytes written per second per deployment, and a wide
      // burst trips "Too many writes per second" and kills the whole refresh.
      // Keep the fan-out modest, pace each worker, and retry a throttled write
      // instead of failing the run.
      let doneWrites = 0;
      // 2 workers: 4 concurrent large payloads pushed the Node action past its
      // 512 MB cap on top of the retained pull data (OOM, 2026-10-01).
      await runAll(
        2,
        writes.map(w => async () => {
          await withWriteRetry(w);
          await sleep(200);
          doneWrites++;
          if (doneWrites % 25 === 0) {
            await ctx.runMutation(internal.ingest.progressLog, {
              id: logId,
              message: `Refreshing… writes ${doneWrites}/${writes.length} @${Math.round((Date.now() - startedAt) / 1000)}s`,
            });
          }
        }),
      );
      const insertedAt = Date.now();
      const totalSecs = Math.round((Date.now() - startedAt) / 1000);

      await ctx.runMutation(internal.config.write, {
        currentStart,
        currentEnd,
        baselineStart,
        baselineEnd,
        lagDays,
        autoBaseline: cfg.autoBaseline,
        autoEnd: true,
        baselineMode: mode,
        p75,
        gen,
        genSeq: gen,
        baseRevAll: clinicMeta.reduce((t, m) => t + m.baseRev, 0),
        baseOrdersAll: clinicMeta.reduce((t, m) => t + m.baseOrders, 0),
      });
      // Stale drill cache keys are gen-agnostic, so clear that small table now.
      for (let i = 0; i < 20; i++) {
        const done = await ctx.runMutation(internal.ingest.clearTable, {
          table: "drillCache",
        });
        if (done) break;
      }
      await ctx.scheduler.runAfter(0, internal.ingest.purgeOldGens, {
        keep: gen,
      });
      // Rep-picked windows are separate computations; re-run them on fresh
      // data (staggered — refreshes serialize on the refresh lock).
      try {
        await ctx.runMutation(internal.config.requeueRepWindows, {});
      } catch (e) {
        console.error("rep window requeue failed", e);
      }
      // Structured Business Feed insights (Shyam, 2026-09-23) — snapshot
      // today's feed cards as persisted, editable insight records. Best
      // effort: never fail the whole refresh over this.
      try {
        await ctx.runMutation(internal.insights.generateFromRefresh, {
          date: currentEnd,
        });
      } catch (e) {
        console.error("insight generation failed", e);
      }
      // Gut Zoomer / Total Tox stopped-clinic lists (Shyam, 2026-10-13):
      // own action so its Power BI pulls never count against this one.
      try {
        await ctx.scheduler.runAfter(0, internal.familyStops.rebuild, {
          dataEnd: currentEnd,
        });
      } catch (e) {
        console.error("familyStops schedule failed", e);
      }

      const rowCount =
        daily.length +
        stateDaily.length +
        cohortDaily.length +
        stateBaseline.length;
      await ctx.runMutation(internal.ingest.finishLog, {
        id: logId,
        status: "ok",
        message: `Loaded ${daily.length} days, ${stateDaily.length} state-days, ${clinicDays.length} clinic-days, ${clinicMeta.length} clinics, ${clinicPeriod.length} clinic-period rows, ${famSize.size} product families · ${pullSecs}s pull + ${Math.round((insertedAt - startedAt) / 1000) - pullSecs}s insert = ${totalSecs}s`,
        dataThrough: currentEnd,
        rows: rowCount,
      });
      return { dataThrough: currentEnd, rows: rowCount };
    } catch (error) {
      await ctx.runMutation(internal.ingest.finishLog, {
        id: logId,
        status: "error",
        message: String(error).slice(0, 800),
      });
      throw error;
    }
  },
});

export const refreshSnapshot = internalAction({
  args: {
    asOf: v.string(),
    cadence: v.union(v.literal("weekly"), v.literal("monthly")),
    // Rep-picked window (Shyam, 2026-09-25): compute [start, asOf] and keep it
    // under config key `repKey` instead of extracting insights + deleting.
    repKey: v.optional(v.string()),
    start: v.optional(v.string()),
    requestAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { asOf, cadence, repKey, start, requestAt },
  ): Promise<{ dataThrough: string; rows: number }> => {
    let logId: Id<"refreshLog">;
    let reservedRepGen: number | undefined;
    let repGenCommitted = false;
    try {
      logId = await ctx.runMutation(internal.ingest.startLog, {
        message: repKey
          ? `Rep window ${start} → ${asOf} (${repKey.slice(4)})…`
          : `Backfilling ${cadence} insight snapshot as of ${asOf}…`,
        scope: repKey,
      });
    } catch (e) {
      // Another refresh holds the lock: a rep window just waits its turn.
      if (repKey && String(e).includes("REFRESH_IN_PROGRESS")) {
        await ctx.scheduler.runAfter(45_000, internal.refresh.refreshSnapshot, {
          asOf,
          cadence,
          repKey,
          start,
          requestAt,
        });
        return { dataThrough: asOf, rows: 0 };
      }
      throw e;
    }
    try {
      const startedAt = Date.now();
      const cfg = await ctx.runQuery(internal.config.getInternal, {});

      // Historical snapshot: fix the window end at the requested date instead
      // of "today", and reuse the live dashboard's window *length* so the
      // snapshot's baseline math matches what the live window would have
      // shown that day. Data this old has fully landed, so no lag trim.
      const lagDays = 0;
      const currentEnd = asOf;
      const liveWindowLen = diffDays(cfg.currentStart, cfg.currentEnd);
      const currentStart = start ?? addDays(currentEnd, -liveWindowLen);
      const windowLen = diffDays(currentStart, currentEnd) + 1;
      const mode = (cfg.baselineMode ?? "prior_equal") as BaselineMode;
      const bucket = bucketing(mode);
      const win = await resolveBaseline(cfg, mode, currentStart, currentEnd);
      const baselineStart = win.start;
      const baselineEnd = win.end;
      void windowLen;

      // Every Power BI pull below is independent of the others, so fire them
      // all now and await where the rows are needed. dax() caps how many are
      // actually in flight; the refresh becomes bound by the slowest query
      // rather than the sum of ~15 sequential ones.
      let rangeStart =
        baselineStart < currentStart ? baselineStart : currentStart;
      // The P75 baseline also needs the three prior full calendar months, which
      // can start a day or two before the trailing-13-week baseline does.
      if (mode === "p75") {
        // Needs the year-to-date full calendar months (with a 3-prior-month
        // fallback) *and* 13 full trailing weeks, all of which can start
        // before the trailing-13-week baseline does.
        const m3 = monthsBackStart(currentStart, 3);
        const ytd = `${currentStart.slice(0, 4)}-01-01`;
        const w13 = weekStart(addDays(currentStart, -91));
        let earliest = m3 < w13 ? m3 : w13;
        if (ytd < earliest) earliest = ytd;
        if (earliest < rangeStart) rangeStart = earliest;
      }
      const rangeEnd = baselineEnd > currentEnd ? baselineEnd : currentEnd;
      const baseSlices = monthSlices(baselineStart, baselineEnd);
      const curSlices = monthSlices(currentStart, currentEnd);
      const clinicQuery = (s0: string, e0: string) =>
        ordersRows({ by: ["clinic_id"], day: true, start: s0, end: e0,
          m: { rev: "revenue", ord: "orders", pat: "patients", brev: "bundle_revenue", bord: "bundle_orders" } });
      const familyQuery = (s0: string, e0: string) =>
        ordersRows({ by: ["team_lead", "sales_id"], family: true, day: true, start: s0, end: e0,
          m: { rev: "revenue", ord: "orders", brev: "bundle_revenue", bord: "bundle_orders" } });

      const pDaily = ordersRows({ day: true, start: rangeStart, end: rangeEnd,
        m: { ord: "orders", rev: "revenue", pat: "patients", bord: "bundle_orders", brev: "bundle_revenue" } });
      const pStateCur = ordersRows({ by: ["state"], day: true, start: currentStart, end: currentEnd, m: { rev: "revenue" } });
      const pChannel = ordersRows({ by: ["charge_method"], day: true, start: rangeStart, end: rangeEnd, m: { rev: "revenue", ord: "orders" } });
      const pStateBase = ordersRows({ by: ["state"], day: true, start: baselineStart, end: baselineEnd, m: { rev: "revenue" } });
      const pClinicBase = baseSlices.map(([s0, e0]) =>
        clinicQuery(s0, e0),
      );
      const pClinicCur = curSlices.map(([s0, e0]) => clinicQuery(s0, e0));
      const pFamBase = baseSlices.map(([s0, e0]) => familyQuery(s0, e0));
      const pFamCur = curSlices.map(([s0, e0]) => familyQuery(s0, e0));
      const pIdentity = ordersRows({ by: ["clinic_id", "customer_practice_name", "state", "country_name", "team_lead", "sales_id"],
        start: rangeStart, end: rangeEnd, m: { rev: "revenue" } });
      const pUsers = cubeRows({ dimensions: ["internal_user.internal_user_id", "internal_user.name"] }, {
        "internal_user.internal_user_id": "internal_user[internal_user_id]",
        "internal_user.name": "internal_user[internal_user_name]" });
      const pSales = cubeRows({ dimensions: ["sales_commission.sales_id", "sales_commission.sales_name"] }, {
        "sales_commission.sales_id": "sales_commission_summary[sales_id]",
        "sales_commission.sales_name": "sales_commission_summary[sales_name]" });
      // Year-end projection inputs: 2026 year-to-date actuals, and the prior
      // year's daily revenue for the remaining stretch of the year (it carries
      // the holidays and the Nov–Dec slowdown as data instead of a hardcoded
      // calendar).
      const yearStart = `${currentEnd.slice(0, 4)}-01-01`;
      const pYtd = ordersRows({ start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const priorStart = addDays(yearStart, -364).slice(0, 4) + "-06-01";
      const priorEnd = `${Number(currentEnd.slice(0, 4)) - 1}-12-31`;
      const pPrior = ordersRows({ day: true, start: priorStart, end: priorEnd, m: { rev: "revenue", ord: "orders" } });
      const pYtdLead = ordersRows({ by: ["team_lead"], start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const pFwdLead = ordersRows({ by: ["team_lead"], start: addDays(currentEnd, -90), end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      // Same year-to-date and trailing-13-week actuals, at clinic grain, so
      // the year-end projection can be re-scoped to any state or salesperson
      // (not just team lead) by summing whichever clinics fall in that scope,
      // without a bespoke DAX query per grouping.
      const pClinicYtd = ordersRows({ by: ["clinic_id"], start: yearStart, end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      const pClinicFwd = ordersRows({ by: ["clinic_id"], start: addDays(currentEnd, -90), end: currentEnd, m: { rev: "revenue", ord: "orders" } });
      // First-ever order date per clinic. Drives the tenure-aligned cohort
      // split: a clinic is a NEW LOGO in a window if its first order falls in
      // that window, so the new-clinic branch can be measured against the
      // baseline window's own new logos instead of against $0.
      const pFirst = ordersRows({ by: ["clinic_id"], m: { first: "first_order" } });
      // Earliest HubSpot signup per clinic (Shyam, 2026-09-28, Provider
      // Retention Funnel): customer_signup_time is a per-order attribute
      // (repeated across every order of the same customer), so MIN over
      // ALL of a clinic's orders gives its earliest-signed-up provider.
      // Kept for clinicMeta (unused elsewhere today) but NOT used for the
      // funnel's signup->order1 gap anymore — see pClinicSignupByDay below.
      const pClinicSignup = ordersRows({ by: ["clinic_id"], m: { signup: "first_signup" } });
      // Signup->order1 fix (Shyam, 2026-09-29): the clinic-wide MIN above
      // picks up ANY provider ever signed up at that clinic_id, which for a
      // multi-provider practice can predate the specific provider who
      // placed the clinic's first order by months/years — producing wild
      // "signup to order 1" gaps (e.g. 400+ days) that don't describe the
      // actual conversion. Grouping by clinic_id + order_date instead scopes
      // MIN(customer_signup_time) to just the customer(s) who ordered that
      // day, a much tighter proxy for "the provider who placed this order".
      // Bounded to the refresh window (same bound as the per-clinic-day
      // pulls elsewhere in this file) to keep row count sane.
      const pClinicSignupByDay = ordersRows({ by: ["clinic_id"], day: true, start: currentStart, end: currentEnd, m: { signup: "first_signup" } });
      // Lead signups by owning salesperson, day-grain (same funnel): a much
      // broader population than clinics that ever ordered — most signups
      // never place an order. customers_bq has no clinic_id, only sales_id,
      // so this is scoped by rep, not by clinic. Row-level (not
      // SUMMARIZECOLUMNS-aggregated) because customer_signup_time carries a
      // time-of-day component with no clean DAX date-truncation; bucketed to
      // day in JS below. Bounded to the refresh window to keep row count
      // small (~1-2k, not the whole company's lifetime lead list).
      const pSignups = cubeRows({
          dimensions: ["customers.customer_id", "customers.sales_id", "customers.signup_time",
            "customers.first_name", "customers.last_name", "customers.credential", "customers.state"],
          timeDimensions: [{ dimension: "customers.signup_time", dateRange: [currentStart, currentEnd] }],
        }, {
          "customers.customer_id": "customers_bq[customer_id]",
          "customers.sales_id": "customers_bq[sales_id]",
          "customers.signup_time": "customers_bq[customer_signup_time]",
          "customers.first_name": "customers_bq[customer_first_name]",
          "customers.last_name": "customers_bq[customer_last_name]",
          "customers.credential": "customers_bq[customer_suffix]",
          "customers.state": "customers_bq[state]",
        });
      // First order per window signup (Shyam, 2026-10-13): which leads never
      // ordered. rfm_orders carries customer_signup_time per customer; Cube
      // has no MIN over dimensions, so group by clinic/practice and keep the
      // smallest per customer (DAX MIN() equivalent).
      const pSignupOrd = cubeRows({
          measures: ["rfm_orders.first_order"],
          dimensions: ["rfm_orders.customer_id", "rfm_orders.clinic_id", "rfm_orders.practice_name"],
          timeDimensions: [{ dimension: "rfm_orders.customer_signup_time", dateRange: [currentStart, currentEnd] }],
        }, {
          "rfm_orders.customer_id": `${TABLE}[customer_id]`,
          "rfm_orders.clinic_id": "cl",
          "rfm_orders.practice_name": "pr",
          "rfm_orders.first_order": "fo",
        }).then(rs => {
          const best = new Map<string, Record<string, unknown>>();
          for (const r of rs) {
            const id = String(r[`${TABLE}[customer_id]`] ?? "");
            const b = best.get(id);
            if (!b) { best.set(id, { ...r }); continue; }
            if (String(r.fo ?? "") && (!String(b.fo ?? "") || String(r.fo) < String(b.fo))) b.fo = r.fo;
            if (r.cl != null && (b.cl == null || Number(r.cl) < Number(b.cl))) b.cl = r.cl;
            if (r.pr != null && (b.pr == null || String(r.pr) < String(b.pr))) b.pr = r.pr;
          }
          return [...best.values()].map(r => ({
            [`${TABLE}[customer_id]`]: r[`${TABLE}[customer_id]`], "[fo]": r.fo, "[cl]": r.cl, "[pr]": r.pr,
          }));
        });
      const pPortfolio = cubeRows({ dimensions: ["portfolio_changes.clinic_id", "portfolio_changes.status"] }, {
        "portfolio_changes.clinic_id": "Portfolio Changes[Clinic Id]",
        "portfolio_changes.status": "Portfolio Changes[Status]" });
      // Trailing-12-month VA (VA-only order) stats per clinic, for the $400
      // Foundation Zoomer launch target list (Shyam, 2026-09-15). VA order =
      // sample_test_type_v2 = "VA" (order-level field; exactly matches the
      // dataset's own [VA Orders] measure — no line-level join needed).
      const vaEnd = asOf; // snapshot: never use real "today" — would leak future data
      const vaStart = addDays(vaEnd, -364);
      const vaWindowDays = diffDays(vaStart, vaEnd) + 1;
      const pVaTarget = ordersRows({ by: ["clinic_id"], start: vaStart, end: vaEnd,
        m: { vaRev: "va_revenue", vaOrd: "va_orders", allRev: "revenue", allOrd: "orders" } })
        .then(rs => rs.filter(r => Number(r["[vaOrd]"] ?? 0) > 0));

      // Clinic-health source inputs (RCA-computed flags, see convex/flags.ts)
      // — all as-of `currentEnd`, the same cutoff the Power BI "Time Machine"
      // slicer anchored on, so nothing here can see past the reporting date.
      // A sentinel far before any real order lets one dateFilter cover "all
      // time up to the cutoff" without a separate unbounded-date code path.
      const EARLIEST = "2000-01-01";

      // True last order date per clinic across its WHOLE history (not just
      // the refresh window) — needed for reliable churn/launch/slipping
      // classification; the window-scoped `lastOrder` field is not enough
      // for a clinic whose last order predates the refresh window.
      const pLastOrderAsOf = ordersRows({ by: ["clinic_id"], start: EARLIEST, end: currentEnd, m: { last: "last_order" } });
      // Revenue and orders in the 12 months up to the end of the baseline period, per clinic: the own-history baseline of
      // a slow buyer that skipped the baseline period (analytics/lifecycleRules.ts).
      const pPriorRev = ordersRows({ by: ["clinic_id"], start: addDays(baselineEnd, -364), end: baselineEnd, m: { rev: "revenue", ord: "orders" } });
      // Last year's revenue by month, per clinic: joined with first-order dates it gives last year's new-clinic revenue by
      // month, the shape the new-business goal is phased by (and its total is the default new-business goal).
      const priorYearNum = Number(currentEnd.slice(0, 4)) - 1;
      const pPriorYearMonths = Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          ordersRows({
            by: ["clinic_id"],
            start: `${priorYearNum}-${String(i + 1).padStart(2, "0")}-01`,
            end: new Date(Date.UTC(priorYearNum, i + 1, 0)).toISOString().slice(0, 10),
            m: { rev: "revenue" },
          }),
        ),
      );

      // Lifetime (as-of-cutoff) revenue and fee/deduction total per clinic —
      // for the High Margin Bleed flag's lifetime deduction rate.
      const pLifetimeAsOf = ordersRows({ by: ["clinic_id"], start: EARLIEST, end: currentEnd, m: { rev: "revenue", ded: "deductions" } });

      // Year-to-date VA-only orders per clinic — paired with the existing
      // YTD order total (pClinicYtd) for the High VA Dependency share.
      const pYtdVa = ordersRows({ by: ["clinic_id"], start: yearStart, end: currentEnd, m: { vaOrd: "va_orders" } })
        .then(rs => rs.filter(r => Number(r["[vaOrd]"] ?? 0) > 0));

      // Thiru approved exactly these two source-owned flags from the
      // Revenue Intelligence dashboard: import only their titles from Note;
      // every other source Note flag remains RCA-computed (or omitted).
      // Buying Overdue: every distinct (clinic, order date) up to cutoff.
      const pOrderDateHistory = fetchOrderDateHistory(currentEnd);

      // Ghosted VIP's "last HubSpot touch": the model's OWN relationship
      // (verified live via `INFO.VIEW.RELATIONSHIPS()`, 2026-09-21) is
      // `${TABLE}[hubspot_id] *[<->]1 bi_hubspot_contacts[contact_id]` —
      // i.e. `hubspot_id` IS a contact_id, directly, in the same key space
      // customer_journey_final.contact_id uses. No intermediate table or
      // `bi_hubspot_contacts[customer_id]` involved: an earlier version of
      // this join went through that column, which turned out to be an
      // unrelated field (it duplicates `portal_id`, not a customer/clinic
      // key) — confirmed by spot-checking live rows, its ~14% overlap with
      // orders[hubspot_id] was a coincidental numeric collision, not a real
      // relationship, and undercounted real coverage badly. Direct
      // hubspot_id<->contact_id matching covers ~365K of ~367.6K order rows
      // (~99.4%) and ~364K of the journey table's contact_ids likewise.
      const pOrderHubspotClinic = ordersRows({ by: ["hubspot_id", "clinic_id"], start: EARLIEST, end: currentEnd, m: { rev: "revenue" },
        filters: [{ member: `${O}.hubspot_id`, operator: "set" }] });
      // Scoped to Call/Meeting touchpoints only (Shyam, 2026-09-28): this
      // previously used MAX() over every touchpoint_type — including
      // Ticket/Note/First Order/Repeat Order rows — so "last touch" could
      // be a system-logged order event, not an actual rep call or meeting.
      const pTouchAsOf = cubeRows({
          measures: ["journey.last_touch"],
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", dateRange: [EARLIEST, currentEnd] }],
          filters: [eq("journey.touchpoint_type", "Call", "Meeting")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]", "journey.last_touch": "[last]" });
      // Full Call/Meeting touchpoint date list per contact, bounded to the
      // refresh window (Shyam, 2026-09-29, Provider Retention Funnel "had a
      // call/meeting" filter): pTouchAsOf above only keeps the single most
      // recent date, which can't tell us whether a touch fell inside a
      // specific signup->order1 or orderN-1->orderN gap. Only "Call" and
      // "Meeting" exist as touchpoint_type values in this table (checked
      // live via SUMMARIZECOLUMNS(touchpoint_type, COUNTROWS) — no
      // "Clinical Consult"/"VCT" type exists here or in any other reachable
      // table/column; flagged to Shyam rather than guessed).
      const pTouchDatesRaw = cubeRows({
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", granularity: "day",
            dateRange: [baselineStart < currentStart ? baselineStart : currentStart, currentEnd] }],
          filters: [eq("journey.touchpoint_type", "Call", "Meeting")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]",
             "journey.touchpoint_date": "customer_journey_final[touchpoint_date]" });
      // "Clinical Consult or VCT" touchpoints (Shyam, 2026-09-28): confirmed
      // live this is `customer_journey_final[touchpoint_category] =
      // "Clinical Activity"` (activityType values like "Clinical - Provider
      // Consult", "Meeting - Clinical consults", "Clinical - Provider
      // Training" etc.) — a distinct, narrower bucket than the generic
      // Sales Activity Call/Meeting rows already pulled above. No literal
      // "VCT" string exists anywhere in the model; this category is the
      // closest verified match. Same shape/join as pTouchDatesRaw.
      const pClinicalTouchDatesRaw = cubeRows({
          dimensions: ["journey.contact_id"],
          timeDimensions: [{ dimension: "journey.touchpoint_date", granularity: "day",
            dateRange: [baselineStart < currentStart ? baselineStart : currentStart, currentEnd] }],
          filters: [eq("journey.touchpoint_category", "Clinical Activity")],
        }, { "journey.contact_id": "customer_journey_final[contact_id]",
             "journey.touchpoint_date": "customer_journey_final[touchpoint_date]" });

      // 2. Daily totals across both windows.
      const dailyRows = await pDaily;
      const daily = dailyRows.map(r => ({
        date: dateOf(r, "order_date"),
        orders: num(r, "ord"),
        revenue: num(r, "rev"),
        bundleOrders: num(r, "bord"),
        bundleRevenue: num(r, "brev"),
        patients: num(r, "pat"),
      }));

      const dailyOrders = new Map(daily.map(d => [d.date, d.orders]));
      const p75: P75Factors | undefined =
        mode === "p75"
          ? computeP75Factors(d => dailyOrders.get(d), currentStart)
          : undefined;

      // 3. State revenue: current-window actuals + baseline rates by weekday.
      const stateRows = await pStateCur;
      const stateDaily = stateRows.map(r => ({
        date: dateOf(r, "order_date"),
        state: String(r[`${TABLE}[state]`] ?? "(blank)"),
        revenue: num(r, "rev"),
      }));

      const baseDays = eachDay(baselineStart, baselineEnd);
      const baseCounts = dayCountsOf(baseDays);

      const stateBaseRows = await pStateBase;
      const stateTotals = new Map<string, number[]>();
      for (const r of stateBaseRows) {
        const st = String(r[`${TABLE}[state]`] ?? "(blank)");
        const arr = stateTotals.get(st) ?? [0, 0, 0, 0, 0, 0, 0];
        arr[dow(dateOf(r, "order_date"))] += num(r, "rev");
        stateTotals.set(st, arr);
      }

      // 3b. Charge channel (wellProz / customerPay / ...): current actuals and
      // baseline day-type rates, so the feed can answer "is channel X down?".
      const channelRows = await pChannel;
      const channelDaily: Array<{
        date: string;
        channel: string;
        orders: number;
        revenue: number;
      }> = [];
      const channelBase = new Map<string, { rev: number[]; ord: number[] }>();
      for (const r of channelRows) {
        const date = dateOf(r, "order_date");
        const channel = String(r[`${TABLE}[charge_method]`] ?? "(blank)");
        if (date >= currentStart && date <= currentEnd) {
          channelDaily.push({
            date,
            channel,
            orders: num(r, "ord"),
            revenue: num(r, "rev"),
          });
        }
        if (date >= baselineStart && date <= baselineEnd) {
          const b = channelBase.get(channel) ?? {
            rev: [0, 0, 0, 0, 0, 0, 0],
            ord: [0, 0, 0, 0, 0, 0, 0],
          };
          b.rev[dow(date)] += num(r, "rev");
          b.ord[dow(date)] += num(r, "ord");
          channelBase.set(channel, b);
        }
      }
      const channelBaseline = [...channelBase].map(([channel, b]) => ({
        channel,
        rates: ratesFrom(b.rev, baseCounts, bucket),
        ordRates: ratesFrom(b.ord, baseCounts, bucket),
      }));

      // 4. Clinic cohorts: baseline clinic-days (aggregated per weekday) + current clinic-days.
      type ClinicBase = {
        rev: number[];
        ord: number[];
        bRev: number[];
        bOrd: number[];
        pat: number[];
        total: number;
        orders: number;
        patients: number;
      };
      const zero = (): number[] => [0, 0, 0, 0, 0, 0, 0];
      const baseByClinic = new Map<string, ClinicBase>();
      /** Last order date inside the baseline window, per clinic. */
      const baseLast = new Map<string, string>();
      // Per-clinic-per-day rows from the baseline window, kept alongside the
      // day-of-week aggregation above (not instead of it) — this is the
      // trailing lookback the new rolling P75 baseline needs for periods
      // early in the current window (2026-09-28, see clinicDaysAll below).
      const clinicBaseDays: Array<{
        clinic: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      for (const rows of await Promise.all(pClinicBase)) {
        for (const r of rows) {
          const id = String(r[`${TABLE}[clinic_id]`]);
          const d = dateOf(r, "order_date");
          if ((baseLast.get(id) ?? "") < d) baseLast.set(id, d);
          const i = dow(d);
          const b =
            baseByClinic.get(id) ??
            ({
              rev: zero(),
              ord: zero(),
              bRev: zero(),
              bOrd: zero(),
              pat: zero(),
              total: 0,
              orders: 0,
              patients: 0,
            } as ClinicBase);
          const rev = num(r, "rev");
          const ord = num(r, "ord");
          const pat = num(r, "pat");
          b.rev[i] += rev;
          b.ord[i] += ord;
          b.bRev[i] += num(r, "brev");
          b.bOrd[i] += num(r, "bord");
          b.pat[i] += pat;
          b.total += rev;
          b.orders += ord;
          b.patients += pat;
          baseByClinic.set(id, b);
          clinicBaseDays.push({
            clinic: id,
            date: d,
            revenue: rev,
            orders: ord,
          });
        }
      }

      const clinicDays: Array<{
        clinic: string;
        date: string;
        revenue: number;
        orders: number;
        bundleRevenue: number;
        bundleOrders: number;
        patients: number;
      }> = [];
      for (const rows of await Promise.all(pClinicCur)) {
        for (const r of rows) {
          clinicDays.push({
            clinic: String(r[`${TABLE}[clinic_id]`]),
            date: dateOf(r, "order_date"),
            revenue: num(r, "rev"),
            orders: num(r, "ord"),
            bundleRevenue: num(r, "brev"),
            bundleOrders: num(r, "bord"),
            patients: num(r, "pat"),
          });
        }
      }

      const currentByClinic = new Map<string, number>();
      for (const row of clinicDays) {
        currentByClinic.set(
          row.clinic,
          (currentByClinic.get(row.clinic) ?? 0) + row.revenue,
        );
      }

      // Cohort assignment — tenure aligned.
      //
      // Each clinic gets two labels: one for where its BASELINE revenue is
      // expected (expectedCohort) and one for where its CURRENT revenue lands
      // (actualCohort). They differ only for new logos: the "new clinics"
      // branch is now measured against the baseline window's own new logos
      // rather than against $0, which is what makes the branch answer "is new
      // business up or down" instead of "new business exists".
      const firstOrderOf = new Map<string, string>();
      for (const r of await pFirst) {
        firstOrderOf.set(
          String(r[`${TABLE}[clinic_id]`]),
          dateOf(r, "first") || String(r["[first]"] ?? "").slice(0, 10),
        );
      }
      const clinicSignupOf = new Map<string, string>();
      for (const r of await pClinicSignup) {
        const s = String(r["[signup]"] ?? "").slice(0, 10);
        if (s) clinicSignupOf.set(String(r[`${TABLE}[clinic_id]`]), s);
      }
      // Day-scoped signup map (see pClinicSignupByDay comment above) — key
      // is `${clinic}|${order_date}`, used only for the funnel's order-1 gap.
      const signupByClinicDay = new Map<string, string>();
      for (const r of await pClinicSignupByDay) {
        const s = String(r["[signup]"] ?? "").slice(0, 10);
        const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
        const date = dateOf(r, "order_date");
        if (s && clinic && date) signupByClinicDay.set(`${clinic}|${date}`, s);
      }
      const firstIn = (id: string, from: string, to: string) => {
        const f = firstOrderOf.get(id);
        return !!f && f >= from && f <= to;
      };

      // Retained ranking: clinics with revenue in both windows, ranked on
      // baseline size so the top-20% split is unchanged.
      // Lifecycle (Shyam, 2026-10-18): analytics/lifecycleRules.ts, CLINIC_LIFECYCLE.md.
      //  New = first-ever order this calendar year (no baseline, whatever the dates); churned = silent past the clinic's
      //  threshold (45 days, or max(45, 3 x its own typical gap) for established clinics); reactivated = no baseline and an
      //  unusual gap ended by an order in the last 90 days; a slow buyer with no baseline revenue gets its own 12-month
      //  history as a baseline and stays Existing.
      const orderDatesForLife = await pOrderDateHistory;
      const priorOf = new Map<string, { rev: number; ord: number }>();
      for (const r of await pPriorRev) {
        priorOf.set(String(r[`${TABLE}[clinic_id]`] ?? ""), { rev: num(r, "rev"), ord: num(r, "ord") });
      }
      const lifeYear = currentEnd.slice(0, 4);
      const lifeOf = new Map<string, Lifecycle>();
      const lifeScope = new Set<string>([...baseByClinic.keys(), ...currentByClinic.keys()]);
      for (const [lid, fo] of firstOrderOf) if (fo.startsWith(lifeYear)) lifeScope.add(lid);
      const newBaseRemoved = new Map<string, ClinicBase>();
      const ownHistoryAdded = new Map<string, ClinicBase>();
      for (const id of lifeScope) {
        const lc = classifyClinic({
          firstOrder: firstOrderOf.get(id) ?? "",
          orderDates: orderDatesForLife.get(id) ?? [],
          cutoff: currentEnd,
          hasBaselineRevenue: (baseByClinic.get(id)?.total ?? 0) > 0,
          hasWindowRevenue: (currentByClinic.get(id) ?? 0) > 0,
          priorRevenue: priorOf.get(id)?.rev ?? 0,
        });
        lifeOf.set(id, lc);
        if (lc.isNew) {
          // New clinics carry no baseline: take whatever the baseline window gave them out of every baseline sum.
          const b0 = baseByClinic.get(id);
          if (b0) {
            newBaseRemoved.set(id, b0);
            baseByClinic.delete(id);
          }
        } else if (lc.ownHistoryBaseline) {
          const pr = priorOf.get(id)!;
          const rRev = pr.rev / 365, rOrd = pr.ord / 365;
          const flat = (r: number) => baseCounts.map(c => r * c);
          const nDays = baseDays.length;
          const b1: ClinicBase = {
            rev: flat(rRev), ord: flat(rOrd), bRev: zero(), bOrd: zero(), pat: zero(),
            total: rRev * nDays, orders: rOrd * nDays, patients: 0,
          };
          ownHistoryAdded.set(id, b1);
          baseByClinic.set(id, b1);
        }
      }
      const newMonthRev: number[] = Array(12).fill(0);
      (await pPriorYearMonths).forEach((mrows, mi) => {
        for (const r of mrows) {
          const cid = String(r[`${TABLE}[clinic_id]`] ?? "");
          if ((firstOrderOf.get(cid) ?? "").startsWith(String(priorYearNum))) newMonthRev[mi] += num(r, "rev");
        }
      });
      const priorNewTotal = newMonthRev.reduce((t, x) => t + x, 0);
      const newPhasing = priorNewTotal > 0 ? newMonthRev.map(x => x / priorNewTotal) : undefined;
      const retained: string[] = [];
      for (const [id] of baseByClinic) {
        const lc = lifeOf.get(id);
        if (lc && lc.life === "active" && (currentByClinic.get(id) ?? 0) > 0) retained.push(id);
      }
      retained.sort(
        (a, b) =>
          (baseByClinic.get(b)?.total ?? 0) - (baseByClinic.get(a)?.total ?? 0),
      );
      const topCount = Math.floor(retained.length / 5);
      const retainedLabel = new Map<string, Cohort>();
      retained.forEach((id, i) => {
        retainedLabel.set(
          id,
          i < topCount ? "retained_top20" : "retained_rest",
        );
      });
      // One label per clinic. Active new clinics are the "new" cohort (an Active tier in the trees); silent ones are
      // churned and reactivated ones reactivated, whether they are new or older.
      const actualCohortOf = new Map<string, Cohort>();
      for (const [id, lc] of lifeOf) {
        actualCohortOf.set(
          id,
          lc.life === "churned" ? "churned" : lc.life === "reactivated" ? "reactivated" : lc.isNew ? "new" : (retainedLabel.get(id) ?? "retained_rest"),
        );
      }
      const expectedCohortOf = actualCohortOf;
      const cohortOf = actualCohortOf;

      // Cohort baseline rates by weekday + clinic counts.
      const agg = new Map<Cohort, { totals: number[]; clinics: number }>();
      for (const c of COHORTS) agg.set(c, { totals: zero(), clinics: 0 });
      for (const [id, base] of baseByClinic) {
        const c = expectedCohortOf.get(id);
        if (!c) continue;
        const a = agg.get(c)!;
        for (let i = 0; i < 7; i++) a.totals[i] += base.rev[i];
      }
      for (const [, c] of cohortOf) agg.get(c)!.clinics += 1;
      const cohortBaseline = COHORTS.map(c => ({
        cohort: c,
        rates: ratesFrom(agg.get(c)!.totals, baseCounts, bucket),
        clinics: agg.get(c)!.clinics,
      }));

      // Cohort × day actuals.
      const cohortDayMap = new Map<string, number>();
      for (const row of clinicDays) {
        const c = actualCohortOf.get(row.clinic);
        if (!c) continue;
        const key = `${row.date}|${c}`;
        cohortDayMap.set(key, (cohortDayMap.get(key) ?? 0) + row.revenue);
      }
      const cohortDaily = [...cohortDayMap].map(([key, revenue]) => {
        const [date, cohort] = key.split("|");
        return { date, cohort, revenue };
      });

      // 4c. Product families (level 2 under volume / product mix).
      // product_family lives on the line-level test table but resolves to one
      // combination string per order, so revenue and orders reconcile exactly
      // to the totals above.
      // Sales-rep display names, resolved early (pUsers/pSales are fetched at
      // the top of this action) so the family split below can key by rep name
      // directly instead of carrying raw sales_id through to a later pass.
      const salesName = new Map<string, string>();
      const userRows = await pUsers;
      for (const r of userRows) {
        const id = String(r["internal_user[internal_user_id]"] ?? "");
        const name = String(r["internal_user[internal_user_name]"] ?? "");
        if (id && name && name !== "null") salesName.set(id, name);
      }
      const salesRows = await pSales;
      for (const r of salesRows) {
        const id = String(r["sales_commission_summary[sales_id]"] ?? "");
        const name = String(r["sales_commission_summary[sales_name]"] ?? "");
        if (id && name && !salesName.has(id)) salesName.set(id, name);
      }
      const salesLabelOf = (r: Record<string, unknown>): string => {
        const id = String(r[`${TABLE}[sales_id]`] ?? "").trim();
        if (!id || id === "null") return "—";
        return salesName.get(id) ?? `Sales ${id}`;
      };
      // Keyed `scope|lead|family` — the book-wide view is the sum over leads.
      // A separate, same-shaped `famBaseSales` map (keyed `scope|sales|family`)
      // is filled in the same pass below for the per-rep series; kept as its
      // own map instead of adding a 4th key segment to famBase because
      // scope×lead×sales×family is a much bigger cross-product than
      // scope×lead×family + scope×sales×family and blew the action's memory
      // budget when tried (OOM at 64MB, 2026-09-04).
      const famBase = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      const famBaseSales = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      const leadOf = (r: Record<string, unknown>): string => {
        const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
        return t.length ? t : "—";
      };
      // Each family row is also split by bundle membership so the level-2 list
      // under the product-mix branch only shows families inside bundle orders
      // (and vice versa), instead of repeating the volume branch's list.
      for (const rows of await Promise.all(pFamBase)) {
        for (const r of rows) {
          const fams = splitFamilies(familyOf(r));
          const i = dow(dateOf(r, "order_date"));
          const rev = num(r, "rev") / fams.length;
          const ord = num(r, "ord");
          const bRev = num(r, "brev") / fams.length;
          const bOrd = num(r, "bord");
          const sales = salesLabelOf(r);
          for (const f of fams) {
            for (const [scope, sRev, sOrd] of [
              ["all", rev, ord],
              ["bundle", bRev, bOrd],
              ["nonbundle", rev - bRev, ord - bOrd],
            ] as Array<[string, number, number]>) {
              if (sRev === 0 && sOrd === 0) continue;
              const k = `${scope}|${leadOf(r)}|${f}`;
              const b = famBase.get(k) ?? {
                rev: zero(),
                ord: zero(),
                total: 0,
                orders: 0,
              };
              b.rev[i] += sRev;
              b.ord[i] += sOrd;
              b.total += sRev;
              b.orders += sOrd;
              famBase.set(k, b);
              const ks = `${scope}|${sales}|${f}`;
              const bs = famBaseSales.get(ks) ?? {
                rev: zero(),
                ord: zero(),
                total: 0,
                orders: 0,
              };
              bs.rev[i] += sRev;
              bs.ord[i] += sOrd;
              bs.total += sRev;
              bs.orders += sOrd;
              famBaseSales.set(ks, bs);
            }
          }
        }
      }
      // New clinics carry no baseline (analytics/lifecycleRules.ts), so what they ordered in the baseline period comes
      // out of the family baselines too, keeping family goals consistent with the headline goal (2026-10-18).
      if (newBaseRemoved.size) {
        const newIdList = [...newBaseRemoved.keys()].filter(cid => /^\d+$/.test(cid));
        const newFamRows: any[][] = await Promise.all(
          Array.from({ length: Math.ceil(newIdList.length / 500) }, (_, ci) =>
            ordersRows({
              by: ["team_lead", "sales_id"], family: true, day: true, start: baselineStart, end: baselineEnd,
              m: { rev: "revenue", ord: "orders", brev: "bundle_revenue", bord: "bundle_orders" },
              filters: [eq(`${O}.clinic_id`, ...newIdList.slice(ci * 500, ci * 500 + 500))],
            }),
          ),
        );
        for (const nrows of newFamRows) {
          for (const r of nrows) {
            const fams = splitFamilies(familyOf(r));
            const i = dow(dateOf(r, "order_date"));
            const rev = num(r, "rev") / fams.length;
            const ord = num(r, "ord");
            const bRev = num(r, "brev") / fams.length;
            const bOrd = num(r, "bord");
            const sales = salesLabelOf(r);
            for (const f of fams) {
              for (const [scope, sRev, sOrd] of [
                ["all", rev, ord],
                ["bundle", bRev, bOrd],
                ["nonbundle", rev - bRev, ord - bOrd],
              ] as Array<[string, number, number]>) {
                if (sRev === 0 && sOrd === 0) continue;
                for (const m2 of [famBase.get(`${scope}|${leadOf(r)}|${f}`), famBaseSales.get(`${scope}|${sales}|${f}`)]) {
                  if (!m2) continue;
                  m2.rev[i] = Math.max(0, m2.rev[i] - sRev);
                  m2.ord[i] = Math.max(0, m2.ord[i] - sOrd);
                  m2.total = Math.max(0, m2.total - sRev);
                  m2.orders = Math.max(0, m2.orders - sOrd);
                }
              }
            }
          }
        }
      }
      const famDays: Array<{
        scope: string;
        lead: string;
        family: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      const famDaysSales: Array<{
        scope: string;
        sales: string;
        family: string;
        date: string;
        revenue: number;
        orders: number;
      }> = [];
      for (const rows of await Promise.all(pFamCur)) {
        for (const r of rows) {
          const fams = splitFamilies(familyOf(r));
          const date = dateOf(r, "order_date");
          const rev = num(r, "rev") / fams.length;
          const ord = num(r, "ord");
          const bRev = num(r, "brev") / fams.length;
          const bOrd = num(r, "bord");
          const sales = salesLabelOf(r);
          for (const f of fams) {
            for (const [scope, sRev, sOrd] of [
              ["all", rev, ord],
              ["bundle", bRev, bOrd],
              ["nonbundle", rev - bRev, ord - bOrd],
            ] as Array<[string, number, number]>) {
              if (sRev === 0 && sOrd === 0) continue;
              famDays.push({
                scope,
                lead: leadOf(r),
                family: f,
                date,
                revenue: sRev,
                orders: sOrd,
              });
              famDaysSales.push({
                scope,
                sales,
                family: f,
                date,
                revenue: sRev,
                orders: sOrd,
              });
            }
          }
        }
      }

      // Keep the meaningful families; everything small rolls into one bucket so
      // the level-2 list stays readable and still sums to the branch total.
      const famSize = new Map<string, number>();
      for (const [k, b] of famBase) {
        const [scope, , family] = k.split("|");
        if (scope !== "all") continue;
        famSize.set(family, (famSize.get(family) ?? 0) + b.total);
      }
      for (const r of famDays) {
        if (r.scope !== "all") continue;
        famSize.set(r.family, (famSize.get(r.family) ?? 0) + r.revenue);
      }
      const keep = new Set(
        [...famSize]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([f]) => f),
      );
      const OTHER = "Other families";
      const label = (f: string) => (keep.has(f) ? f : OTHER);

      const famBaseRolled = new Map<
        string,
        { rev: number[]; ord: number[]; total: number; orders: number }
      >();
      for (const [key, b] of famBase) {
        const [scope, , family] = key.split("|");
        const k = `${scope}|${label(family)}`;
        const t = famBaseRolled.get(k) ?? {
          rev: zero(),
          ord: zero(),
          total: 0,
          orders: 0,
        };
        for (let i = 0; i < 7; i++) {
          t.rev[i] += b.rev[i];
          t.ord[i] += b.ord[i];
        }
        t.total += b.total;
        t.orders += b.orders;
        famBaseRolled.set(k, t);
      }
      const familyBaseline = [...famBaseRolled].map(([key, b]) => ({
        scope: key.slice(0, key.indexOf("|")),
        family: key.slice(key.indexOf("|") + 1),
        rates: ratesFrom(b.rev, baseCounts, bucket),
        ordRates: ratesFrom(b.ord, baseCounts, bucket),
        baseRev: b.total,
        baseOrders: b.orders,
      }));

      const famPeriodAgg = new Map<
        string,
        Map<string, { revenue: number; orders: number }>
      >();
      const addFam = (
        periodId: string,
        family: string,
        row: { revenue: number; orders: number },
      ) => {
        const m =
          famPeriodAgg.get(periodId) ??
          new Map<string, { revenue: number; orders: number }>();
        const a = m.get(family) ?? { revenue: 0, orders: 0 };
        a.revenue += row.revenue;
        a.orders += row.orders;
        m.set(family, a);
        famPeriodAgg.set(periodId, m);
      };
      for (const row of famDays) {
        const f = `${row.scope}|${label(row.family)}`;
        addFam("all", f, row);
        addFam(`m:${row.date.slice(0, 7)}`, f, row);
        addFam(`w:${weekStart(row.date)}`, f, row);
        addFam(`d:${row.date}`, f, row);
      }
      const familyPeriod: Array<{
        periodId: string;
        scope: string;
        family: string;
        revenue: number;
        orders: number;
      }> = [];
      for (const [periodId, m] of famPeriodAgg) {
        for (const [key, a] of m) {
          const bar = key.indexOf("|");
          familyPeriod.push({
            periodId,
            scope: key.slice(0, bar),
            family: key.slice(bar + 1),
            ...a,
          });
        }
      }

      // Lead-scoped family series: one document per lead × scope × family with
      // the whole current window inline, so a filtered family list is a few
      // hundred reads instead of a per-period table four times the size.
      type LeadSeries = {
        lead: string;
        scope: string;
        family: string;
        days: Map<string, { rev: number; ord: number }>;
        rev: number[];
        ord: number[];
        baseRev: number;
        baseOrders: number;
      };
      const leadSeries = new Map<string, LeadSeries>();
      const seriesFor = (lead: string, scope: string, family: string) => {
        const k = `${lead}|${scope}|${family}`;
        let e = leadSeries.get(k);
        if (!e) {
          e = {
            lead,
            scope,
            family,
            days: new Map(),
            rev: zero(),
            ord: zero(),
            baseRev: 0,
            baseOrders: 0,
          };
          leadSeries.set(k, e);
        }
        return e;
      };
      for (const [key, b] of famBase) {
        const [scope, lead, family] = key.split("|");
        if (lead === "—") continue;
        const e = seriesFor(lead, scope, label(family));
        for (let i = 0; i < 7; i++) {
          e.rev[i] += b.rev[i];
          e.ord[i] += b.ord[i];
        }
        e.baseRev += b.total;
        e.baseOrders += b.orders;
      }
      for (const row of famDays) {
        if (row.lead === "—") continue;
        const e = seriesFor(row.lead, row.scope, label(row.family));
        const d = e.days.get(row.date) ?? { rev: 0, ord: 0 };
        d.rev += row.revenue;
        d.ord += row.orders;
        e.days.set(row.date, d);
      }
      const familyLeadSeries = [...leadSeries.values()].map(e => ({
        lead: e.lead,
        scope: e.scope,
        family: e.family,
        days: [...e.days]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([d, v2]) => ({ d, rev: v2.rev, ord: v2.ord })),
        rates: ratesFrom(e.rev, baseCounts, bucket),
        ordRates: ratesFrom(e.ord, baseCounts, bucket),
        baseRev: e.baseRev,
        baseOrders: e.baseOrders,
      }));

      // Sales-rep-scoped family series: same shape as familyLeadSeries above,
      // just keyed by individual rep instead of team lead, built from the
      // same famBase/famDays rows so the two views always reconcile — a
      // rep's numbers roll up exactly into their lead's numbers because both
      // are sums over the identical underlying rows, just grouped
      // differently. Requested by Shyam 2026-09-04 so the product-mix panel
      // re-scopes with the rest of the page when a rep is picked.
      type SalesSeries = {
        sales: string;
        scope: string;
        family: string;
        days: Map<string, { rev: number; ord: number }>;
        rev: number[];
        ord: number[];
        baseRev: number;
        baseOrders: number;
      };
      const salesSeries = new Map<string, SalesSeries>();
      const seriesForSales = (sales: string, scope: string, family: string) => {
        const k = `${sales}|${scope}|${family}`;
        let e = salesSeries.get(k);
        if (!e) {
          e = {
            sales,
            scope,
            family,
            days: new Map(),
            rev: zero(),
            ord: zero(),
            baseRev: 0,
            baseOrders: 0,
          };
          salesSeries.set(k, e);
        }
        return e;
      };
      for (const [key, b] of famBaseSales) {
        const [scope, sales, family] = key.split("|");
        if (sales === "—") continue;
        const e = seriesForSales(sales, scope, label(family));
        for (let i = 0; i < 7; i++) {
          e.rev[i] += b.rev[i];
          e.ord[i] += b.ord[i];
        }
        e.baseRev += b.total;
        e.baseOrders += b.orders;
      }
      for (const row of famDaysSales) {
        if (row.sales === "—") continue;
        const e = seriesForSales(row.sales, row.scope, label(row.family));
        const d = e.days.get(row.date) ?? { rev: 0, ord: 0 };
        d.rev += row.revenue;
        d.ord += row.orders;
        e.days.set(row.date, d);
      }
      const familySalesSeries = [...salesSeries.values()].map(e => ({
        sales: e.sales,
        scope: e.scope,
        family: e.family,
        days: [...e.days]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([d, v2]) => ({ d, rev: v2.rev, ord: v2.ord })),
        rates: ratesFrom(e.rev, baseCounts, bucket),
        ordRates: ratesFrom(e.ord, baseCounts, bucket),
        baseRev: e.baseRev,
        baseOrders: e.baseOrders,
      }));

      // 4b. Clinic identity (practice name, dominant state, owning salesperson).
      // salesName was already built above, right before the family split.
      const identityRows = await pIdentity;
      type Identity = {
        name: string;
        state: string;
        country: string;
        teamLead: string;
        sales: string;
        rev: number;
      };
      const identity = new Map<string, Identity>();
      for (const r of identityRows) {
        const id = String(r[`${TABLE}[clinic_id]`]);
        const rev = num(r, "rev");
        const prev = identity.get(id);
        if (prev && prev.rev >= rev) continue;
        const salesId = String(r[`${TABLE}[sales_id]`] ?? "");
        identity.set(id, {
          name: String(r[`${TABLE}[customer_practice_name]`] ?? `Clinic ${id}`),
          state: String(r[`${TABLE}[state]`] ?? "(blank)"),
          country: String(r[`${TABLE}[country_name]`] ?? "").trim() || "—",
          teamLead: (() => {
            const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
            return t && t !== "null" ? t : "—";
          })(),
          sales:
            salesName.get(salesId) ??
            (salesId && salesId !== "null" ? `Sales ${salesId}` : "—"),
          rev,
        });
      }

      // State baseline (order-level state pull) made consistent with the clinic baselines: new clinics carry none, and
      // clinics on an own-history baseline add theirs, each in the clinic's dominant state.
      for (const [cid, b0] of newBaseRemoved) {
        const st = identity.get(cid)?.state ?? "(blank)";
        const arr = stateTotals.get(st);
        if (arr) for (let i = 0; i < 7; i++) arr[i] = Math.max(0, arr[i] - b0.rev[i]);
      }
      for (const [cid, b1] of ownHistoryAdded) {
        const st = identity.get(cid)?.state ?? "(blank)";
        const arr = stateTotals.get(st) ?? [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 7; i++) arr[i] += b1.rev[i];
        stateTotals.set(st, arr);
      }
      const stateBaseline = [...stateTotals].map(([state, totals]) => ({
        state,
        rates: ratesFrom(totals, baseCounts, bucket),
      }));

      // VA target list rows: join the trailing-12-month VA stats onto the
      // same clinic identity map used everywhere else.
      const vaTargetRows = await pVaTarget;
      const vaClinicTarget = vaTargetRows
        .map(r => {
          const id = String(r[`${TABLE}[clinic_id]`]);
          const idty = identity.get(id);
          return {
            clinic: id,
            name: idty?.name ?? `Clinic ${id}`,
            state: idty?.state ?? "(blank)",
            sales: idty?.sales ?? "—",
            teamLead: idty?.teamLead ?? "—",
            vaOrders: num(r, "vaOrd"),
            vaRevenue: num(r, "vaRev"),
            allOrders: num(r, "allOrd"),
            allRevenue: num(r, "allRev"),
            windowDays: vaWindowDays,
          };
        })
        .filter(row => row.vaOrders > 0);

      const orderDatesOf = await pOrderDateHistory;
      const rhythmOf = new Map<
        string,
        { medianGapBd: number; bdSinceLastOrder: number }
      >();
      for (const [clinic, dates] of orderDatesOf) {
        const r = buyingRhythm(dates, currentEnd);
        if (r) rhythmOf.set(clinic, r);
      }

      const lastOrderRows = await pLastOrderAsOf;
      const lastOrderAllTimeOf = new Map<string, string>();
      for (const r of lastOrderRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        const last = String(r["[last]"] ?? "").slice(0, 10);
        if (id && last) lastOrderAllTimeOf.set(id, last);
      }

      const lifetimeRows = await pLifetimeAsOf;
      const lifetimeRevOf = new Map<string, number>();
      const lifetimeDedRateOf = new Map<string, number>();
      for (const r of lifetimeRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (!id) continue;
        const rev = num(r, "rev");
        const ded = num(r, "ded");
        lifetimeRevOf.set(id, rev);
        if (rev > 0) lifetimeDedRateOf.set(id, ded / rev);
      }

      const ytdVaRows = await pYtdVa;
      const ytdVaOrdersOf = new Map<string, number>();
      for (const r of ytdVaRows) {
        const id = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (id) ytdVaOrdersOf.set(id, num(r, "vaOrd"));
      }

      // Last HubSpot touch date per clinic: orders[hubspot_id] IS a
      // contact_id (see the query comment above), so the join is a direct
      // lookup — no intermediate mapping table. A missing entry still means
      // "couldn't verify" (blank hubspot_id on every one of the clinic's
      // orders, or no touchpoint row for that contact), not "never touched"
      // (flags.ts keeps those cases apart via touchDataAvailable).
      const hubspotRows = await pOrderHubspotClinic;
      const clinicOfHubspotId = new Map<
        string,
        { clinic: string; rev: number }
      >();
      for (const r of hubspotRows) {
        const hubspotId = String(r[`${TABLE}[hubspot_id]`] ?? "");
        const clinic = String(r[`${TABLE}[clinic_id]`] ?? "");
        if (!hubspotId || !clinic) continue;
        const rev = num(r, "rev");
        const prev = clinicOfHubspotId.get(hubspotId);
        if (!prev || rev > prev.rev)
          clinicOfHubspotId.set(hubspotId, { clinic, rev });
      }
      const touchRows = await pTouchAsOf;
      const lastTouchOf = new Map<string, string>();
      for (const r of touchRows) {
        // The touchpoint table's contact_id IS the order table's hubspot_id
        // (same key space, direct model relationship) — no customer_id hop.
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const last = String(r["[last]"] ?? "").slice(0, 10);
        if (!contact || !last) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const cur = lastTouchOf.get(clinic);
        if (!cur || last > cur) lastTouchOf.set(clinic, last);
      }
      // Per-clinic sorted Call/Meeting touch dates within window, for the
      // Provider Retention Funnel's "had a call/meeting" filter.
      const touchDatesOf = new Map<string, string[]>();
      for (const r of await pTouchDatesRaw) {
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const date = String(
          r["customer_journey_final[touchpoint_date]"] ?? "",
        ).slice(0, 10);
        if (!contact || !date) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const arr = touchDatesOf.get(clinic) ?? [];
        arr.push(date);
        touchDatesOf.set(clinic, arr);
      }
      for (const arr of touchDatesOf.values()) arr.sort();
      // Per-clinic sorted Clinical Activity (consult/VCT) touch dates
      // within window — same shape as touchDatesOf, separate bucket.
      const clinicalTouchDatesOf = new Map<string, string[]>();
      for (const r of await pClinicalTouchDatesRaw) {
        const contact = String(r["customer_journey_final[contact_id]"] ?? "");
        const date = String(
          r["customer_journey_final[touchpoint_date]"] ?? "",
        ).slice(0, 10);
        if (!contact || !date) continue;
        const clinic = clinicOfHubspotId.get(contact)?.clinic;
        if (!clinic) continue;
        const arr = clinicalTouchDatesOf.get(clinic) ?? [];
        arr.push(date);
        clinicalTouchDatesOf.set(clinic, arr);
      }
      for (const arr of clinicalTouchDatesOf.values()) arr.sort();

      // Portfolio Changes gives per-clinic test-level movement; roll it up to
      // a set of statuses per clinic so the drill lists can be filtered by it.
      const pcRows = await pPortfolio;
      const statusOf = new Map<string, string[]>();
      for (const r of pcRows) {
        const id = String(r["Portfolio Changes[Clinic Id]"] ?? "");
        const st = String(r["Portfolio Changes[Status]"] ?? "").trim();
        if (!id || !st || st === "null") continue;
        const cur = statusOf.get(id) ?? [];
        if (!cur.includes(st)) cur.push(st);
        statusOf.set(id, cur);
      }

      // New-logo risk groups (level 2 under the new-clinics branch). Computed
      // over the current window only, from the clinic's own order days.
      const curStat = new Map<string, { last: string; orders: number }>();
      for (const row of clinicDays) {
        const st = curStat.get(row.clinic) ?? { last: "", orders: 0 };
        if (row.date > st.last) st.last = row.date;
        // Count distinct order-DAYS, not raw order rows (Shyam, 2026-09-28:
        // "getting to order 4" numbers didn't match the Provider Retention
        // Funnel). newClinicOrderSeq below defines "order N" as the Nth
        // calendar day with orders > 0 (a clinic that places two orders the
        // same day is still one "order-day"); this stage classification has
        // to use the identical definition or the two funnels drift apart
        // whenever a clinic places >1 order on a single day.
        if (row.orders > 0) st.orders += 1;
        curStat.set(row.clinic, st);
      }
      // Simple funnel (level 2 under the new-clinics branch): every new client
      // reached order 1; membership is CUMULATIVE, so a clinic with 3 orders
      // counts in f1, f2 and f3. "active" is the last rung of the ladder —
      // it requires having reached order 3 AND still ordering (last order in
      // the last 14 days of the window), not a separate recency-only flag.
      // Each stage is compared with the baseline window's own new clients on
      // the same daily pace.
      const newGroupsOf = new Map<string, string[]>();
      for (const [id, rev] of currentByClinic) {
        // New in the analysis window, silent or not: the funnel shows drop-offs.
        if (rev <= 0 || !firstIn(id, currentStart, currentEnd)) continue;
        const st = curStat.get(id);
        if (!st) continue;
        newGroupsOf.set(
          id,
          newClinicFunnelGroups(st.orders, diffDays(st.last, currentEnd)),
        );
      }

      // The same grouping over the baseline window's own new logos, so each
      // group can be read as up or down rather than as a raw count.
      const baseNewGroups = new Map<
        string,
        { clinics: number; orders: number; revenue: number }
      >();
      const bump = (
        key: string,
        lead: string,
        orders: number,
        revenue: number,
      ) => {
        const k = `${lead}\u0000${key}`;
        const cur = baseNewGroups.get(k) ?? {
          clinics: 0,
          orders: 0,
          revenue: 0,
        };
        cur.clinics += 1;
        cur.orders += orders;
        cur.revenue += revenue;
        baseNewGroups.set(k, cur);
      };
      for (const [id, b] of baseByClinic) {
        if (!firstIn(id, baselineStart, baselineEnd)) continue;
        const last = baseLast.get(id) ?? baselineStart;
        const lead = identity.get(id)?.teamLead ?? "—";
        for (const k of [
          ...newClinicFunnelGroups(b.orders, diffDays(last, baselineEnd)),
          "__all__",
        ]) {
          bump(k, "", b.orders, b.total);
          bump(k, lead, b.orders, b.total);
        }
      }
      const baseDaysCount = diffDays(baselineStart, baselineEnd) + 1;
      const curDaysCount = diffDays(currentStart, currentEnd) + 1;
      const newLogoBaseline = [...baseNewGroups].map(([k, v2]) => {
        const [lead, key] = k.split("\u0000");
        return {
          key,
          lead,
          clinics: v2.clinics,
          orders: v2.orders,
          revenue: v2.revenue,
          baseDays: baseDaysCount,
          curDays: curDaysCount,
        };
      });

      const clinicYtdRows = await pClinicYtd;
      const ytdOf = new Map<string, { rev: number; ord: number }>();
      for (const r of clinicYtdRows) {
        ytdOf.set(String(r[`${TABLE}[clinic_id]`]), {
          rev: num(r, "rev"),
          ord: num(r, "ord"),
        });
      }
      const clinicFwdRows = await pClinicFwd;
      const fwdOf = new Map<string, { rev: number; ord: number }>();
      for (const r of clinicFwdRows) {
        fwdOf.set(String(r[`${TABLE}[clinic_id]`]), {
          rev: num(r, "rev"),
          ord: num(r, "ord"),
        });
      }

      // Clinic actuals rolled up to every selectable period.
      type Agg = {
        revenue: number;
        orders: number;
        bundleRevenue: number;
        bundleOrders: number;
        patients: number;
      };
      const periodAgg = new Map<string, Map<string, Agg>>();
      const addTo = (periodId: string, clinic: string, row: Agg) => {
        const m = periodAgg.get(periodId) ?? new Map<string, Agg>();
        const a = m.get(clinic) ?? {
          revenue: 0,
          orders: 0,
          bundleRevenue: 0,
          bundleOrders: 0,
          patients: 0,
        };
        a.revenue += row.revenue;
        a.orders += row.orders;
        a.bundleRevenue += row.bundleRevenue;
        a.bundleOrders += row.bundleOrders;
        a.patients += row.patients;
        m.set(clinic, a);
        periodAgg.set(periodId, m);
      };
      for (const row of clinicDays) {
        addTo("all", row.clinic, row);
        addTo(`q:${quarterKey(row.date)}`, row.clinic, row);
        addTo(`m:${row.date.slice(0, 7)}`, row.clinic, row);
        addTo(`w:${weekStart(row.date)}`, row.clinic, row);
        addTo(`d:${row.date}`, row.clinic, row);
      }
      const clinicPeriod: Array<
        {
          periodId: string;
          clinic: string;
          expectedRevenue?: number;
          expectedOrdersP75?: number;
        } & Agg
      > = [];
      for (const [periodId, m] of periodAgg) {
        for (const [clinic, a] of m) {
          clinicPeriod.push({ periodId, clinic, ...a });
        }
      }

      // Last-3-months order cadence per clinic, precomputed here (not at
      // dashboard query time) so the feed's "cheap top-20%"/"slipping" cards
      // don't need extra full-book collects — reuses `periodAgg`'s already-
      // built "m:{month}" buckets, same window definition feed.ts itself
      // uses (eachDay(currentStart, currentEnd) grouped by month).
      const cadenceMonths = [
        ...new Set(eachDay(currentStart, currentEnd).map(d => d.slice(0, 7))),
      ]
        .sort()
        .slice(-3);
      const monthOrdersOf = new Map<string, number>();
      const monthSeriesOf = new Map<string, number[]>();
      for (const clinic of cohortOf.keys()) {
        const series = cadenceMonths.map(
          mk => periodAgg.get(`m:${mk}`)?.get(clinic)?.orders ?? 0,
        );
        monthSeriesOf.set(clinic, series);
        monthOrdersOf.set(clinic, series.filter(o => o > 0).length);
      }

      const clinicMeta = [...cohortOf].map(([clinic, cohort]) => {
        const b = baseByClinic.get(clinic);
        const idty = identity.get(clinic);
        const ytd = ytdOf.get(clinic);
        const fwd = fwdOf.get(clinic);
        return {
          clinic,
          name: idty?.name ?? `Clinic ${clinic}`,
          state: idty?.state ?? "(blank)",
          country: idty?.country ?? "—",
          teamLead: idty?.teamLead ?? "—",
          sales: idty?.sales ?? "—",
          cohort,
          isNew: lifeOf.get(clinic)?.isNew ?? false,
          life: lifeOf.get(clinic)?.life ?? "active",
          typicalGap: lifeOf.get(clinic)?.typicalGap ?? undefined,
          ownBaseline: lifeOf.get(clinic)?.ownHistoryBaseline ?? false,
          rev: ratesFrom(b?.rev ?? zero(), baseCounts, bucket),
          ord: ratesFrom(b?.ord ?? zero(), baseCounts, bucket),
          bRev: ratesFrom(b?.bRev ?? zero(), baseCounts, bucket),
          bOrd: ratesFrom(b?.bOrd ?? zero(), baseCounts, bucket),
          pat: ratesFrom(b?.pat ?? zero(), baseCounts, bucket),
          baseRev: b?.total ?? 0,
          baseOrders: b?.orders ?? 0,
          basePatients: b?.patients ?? 0,
          pstatus: statusOf.get(clinic) ?? [],
          firstOrder: firstOrderOf.get(clinic) ?? "",
          lastOrder: curStat.get(clinic)?.last ?? "",
          newGroups: newGroupsOf.get(clinic) ?? [],
          // Distinct order-DAYS this window (Shyam, 2026-09-28 mismatch
          // report): the new-clinic funnel's stage fallback in
          // matchesFocus() needs the SAME "one order = one calendar day"
          // definition newClinicOrderSeq uses, not the raw transaction
          // count `windowOrders`/`orders` carries elsewhere (a clinic
          // placing two orders one day is one order-day, not two).
          windowOrderDays: curStat.get(clinic)?.orders ?? 0,
          ytdRevenue: ytd?.rev ?? 0,
          ytdOrders: ytd?.ord ?? 0,
          fwdRevenue: fwd?.rev ?? 0,
          fwdOrders: fwd?.ord ?? 0,
          monthOrders: monthOrdersOf.get(clinic) ?? 0,
          monthSeries: monthSeriesOf.get(clinic) ?? [],
          // Clinic-health source inputs — see convex/flags.ts.
          lastOrderAllTime: lastOrderAllTimeOf.get(clinic) ?? "",
          vaYtdPct: (() => {
            const ytdOrders = ytd?.ord ?? 0;
            if (!ytdOrders) return undefined;
            const vaOrders = ytdVaOrdersOf.get(clinic) ?? 0;
            return vaOrders / ytdOrders;
          })(),
          lifetimeRevenue: lifetimeRevOf.get(clinic) ?? 0,
          lifetimeDeductionRate: lifetimeDedRateOf.get(clinic),
          lastTouchDate: lastTouchOf.get(clinic),
          touchDataAvailable: lastTouchOf.has(clinic),
          medianGapBd: rhythmOf.get(clinic)?.medianGapBd,
          bdSinceLastOrder: rhythmOf.get(clinic)?.bdSinceLastOrder,
          signupDate: clinicSignupOf.get(clinic),
        };
      });

      // Provider Retention Funnel (Shyam, 2026-09-28): per-new-clinic order
      // sequence, built from `clinicDays` we already pulled for this window
      // (no extra Power BI cost) — every "new" clinic's first order is
      // guaranteed inside [currentStart, currentEnd], and so is every later
      // order up to the data cutoff, so this window's clinicDays fully
      // covers the cohort. One "order" = one calendar day with orders > 0
      // (a day's total revenue stands in for that day's order revenue —
      // approximate when a clinic places >1 order the same day, acceptable
      // for a funnel read). Capped at the first 5 order-days per clinic.
      // MoM/QoQ decoupling (Shyam, 2026-09-29): the sequence now spans the
      // baseline window too (baselineStart..currentEnd, already pulled — no
      // extra Power BI cost), so prior month/quarter cohorts (e.g. Q2 new
      // clinics) exist for the comparison regardless of the window selected.
      // The headline funnel still filters on firstOrder-in-window, so its
      // numbers are unchanged.
      const seqStart =
        baselineStart < currentStart ? baselineStart : currentStart;
      const daysByClinic = new Map<
        string,
        Array<{ date: string; revenue: number }>
      >();
      const seenDay = new Set<string>();
      for (const row of [...clinicBaseDays, ...clinicDays]) {
        if (row.orders <= 0) continue;
        const k = `${row.clinic}|${row.date}`;
        if (seenDay.has(k)) continue;
        seenDay.add(k);
        const arr = daysByClinic.get(row.clinic) ?? [];
        arr.push({ date: row.date, revenue: row.revenue });
        daysByClinic.set(row.clinic, arr);
      }
      const newClinicOrderSeq = [...firstOrderOf]
        .filter(([, f]) => f >= seqStart && f <= currentEnd)
        .map(([clinic]) => {
          const seq = (daysByClinic.get(clinic) ?? [])
            .sort((a, b) => (a.date < b.date ? -1 : 1))
            .slice(0, 5);
          const idty = identity.get(clinic);
          return {
            clinic,
            name: idty?.name ?? `Clinic ${clinic}`,
            sales: idty?.sales ?? "—",
            teamLead: idty?.teamLead,
            firstOrder: firstOrderOf.get(clinic) ?? "",
            // Day-scoped signup for the order-1 conversion gap (falls back
            // to the clinic-wide earliest signup if that specific day has
            // no match, e.g. a data gap) — see pClinicSignupByDay comment.
            signupDate:
              (seq[0] && signupByClinicDay.get(`${clinic}|${seq[0].date}`)) ??
              clinicSignupOf.get(clinic),
            orderDates: seq.map(s => s.date),
            orderRevenue: seq.map(s => s.revenue),
            // Sorted Call/Meeting touch dates in-window (Shyam, 2026-09-29
            // funnel filter) — undefined/[] means "no mapped touch data",
            // same caveat as touchDataAvailable elsewhere in this file.
            touchDates: touchDatesOf.get(clinic) ?? [],
            // Clinical Activity (consult/VCT) touch dates in-window, same
            // shape/caveat as touchDates.
            clinicalTouchDates: clinicalTouchDatesOf.get(clinic) ?? [],
          };
        })
        .filter(r => r.firstOrder && r.orderDates.length > 0);

      // Lead signups by rep, day-grain (same funnel's top "Signup" bar).
      const signupDayMap = new Map<string, number>();
      for (const r of await pSignups) {
        const id = String(r["customers_bq[sales_id]"] ?? "").trim();
        const sales =
          id && id !== "null" ? (salesName.get(id) ?? `Sales ${id}`) : "—";
        const date = String(
          r["customers_bq[customer_signup_time]"] ?? "",
        ).slice(0, 10);
        if (!date) continue;
        const key = `${date}|${sales}`;
        signupDayMap.set(key, (signupDayMap.get(key) ?? 0) + 1);
      }
      const signupDaily = [...signupDayMap].map(([key, count]) => {
        const [date, sales] = key.split("|");
        return { date, sales, count };
      });
      const ordOf = new Map<string, { fo: string; cl: string; pr: string }>();
      for (const r of await pSignupOrd) {
        ordOf.set(String(r[`${TABLE}[customer_id]`]), {
          fo: String(r["[fo]"] ?? "").slice(0, 10),
          cl: String(r["[cl]"] ?? ""),
          pr: String(r["[pr]"] ?? ""),
        });
      }
      const signupLead = (await pSignups).flatMap(r => {
        const date = String(r["customers_bq[customer_signup_time]"] ?? "").slice(0, 10);
        if (!date) return [];
        const id = String(r["customers_bq[sales_id]"] ?? "").trim();
        const sales = id && id !== "null" ? (salesName.get(id) ?? `Sales ${id}`) : "—";
        const customerId = String(r["customers_bq[customer_id]"] ?? "");
        const nm = [r["customers_bq[customer_first_name]"], r["customers_bq[customer_last_name]"]]
          .map(x => String(x ?? "").trim()).filter(x => x && x !== "null").join(" ");
        const suf = String(r["customers_bq[customer_suffix]"] ?? "").trim();
        const st = String(r["customers_bq[state]"] ?? "").trim();
        const o = ordOf.get(customerId);
        return [{
          date, sales, customerId,
          name: (nm || `Customer ${customerId}`) + (suf && suf !== "null" ? `, ${suf}` : ""),
          ...(st && st !== "null" ? { state: st } : {}),
          ...(o?.fo ? { firstOrder: o.fo } : {}),
          ...(o?.cl && o.cl !== "null" ? { clinic: o.cl } : {}),
          ...(o?.pr && o.pr !== "null" ? { practice: o.pr } : {}),
        }];
      });

      // 4c. Year-end projection.
      const ytdRow = (await pYtd)[0] ?? {};
      const ytdRevenue = num(ytdRow, "rev");
      const ytdOrders = num(ytdRow, "ord");

      // Forward run rate: the trailing 13 weeks of actuals, per weekday.
      const fwdStart = addDays(currentEnd, -90);
      const fwdRev = [0, 0, 0, 0, 0, 0, 0];
      const fwdOrd = [0, 0, 0, 0, 0, 0, 0];
      const fwdN = [0, 0, 0, 0, 0, 0, 0];
      for (const d of daily) {
        if (d.date < fwdStart || d.date > currentEnd) continue;
        const i = dow(d.date);
        fwdRev[i] += d.revenue;
        fwdOrd[i] += d.orders;
        fwdN[i] += 1;
      }
      const fwdRates = fwdRev.map((v2, i) => (fwdN[i] ? v2 / fwdN[i] : 0));
      const fwdOrdRates = fwdOrd.map((v2, i) => (fwdN[i] ? v2 / fwdN[i] : 0));

      // Prior-year seasonal factor per calendar day: that day's revenue last
      // year against the median of the same weekday in a normal stretch of last
      // year. Holidays land near zero on their own.
      const priorRows = await pPrior;
      const priorRev = new Map<string, number>();
      for (const row of priorRows) {
        priorRev.set(dateOf(row, "order_date"), num(row, "rev"));
      }
      const refFrom = `${Number(currentEnd.slice(0, 4)) - 1}-06-01`;
      const refTo = `${Number(currentEnd.slice(0, 4)) - 1}-10-31`;
      const refByDow: number[][] = [[], [], [], [], [], [], []];
      for (const [d, v2] of priorRev) {
        if (d >= refFrom && d <= refTo) refByDow[dow(d)].push(v2);
      }
      const median = (xs: number[]): number => {
        if (!xs.length) return 0;
        const s = [...xs].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };
      const refMedian = refByDow.map(median);

      const projDays: Array<{
        date: string;
        factor: number;
        rev: number;
        ord: number;
      }> = [];
      const holidays: string[] = [];
      const yearEnd = `${currentEnd.slice(0, 4)}-12-31`;
      for (const d of eachDay(addDays(currentEnd, 1), yearEnd)) {
        // Prior-year counterpart: same weekday and occurrence in the month, so
        // floating holidays line up. Fixed-date holidays use the calendar date.
        const shadow = FIXED_DATE_HOLIDAYS.includes(d.slice(5))
          ? `${Number(d.slice(0, 4)) - 1}-${d.slice(5)}`
          : priorYearSameWeekday(d);
        const ref = refMedian[dow(d)];
        const seen = priorRev.get(shadow);
        let factor = 1;
        // A fixed-date holiday fell on a different weekday last year, so
        // normalise it against that weekday's median, not this one's.
        const refShadow = refMedian[dow(shadow)] || ref;
        if (refShadow > 0 && seen !== undefined) factor = seen / refShadow;
        else if (refShadow > 0 && seen === undefined) factor = 0; // closed last year
        factor = Math.max(0, Math.min(2, factor));
        if (factor < 0.5 && dow(d) >= 1 && dow(d) <= 5) holidays.push(d);
        projDays.push({
          date: d,
          factor,
          rev: fwdRates[dow(d)] * factor,
          ord: fwdOrdRates[dow(d)] * factor,
        });
      }

      // Per-team-lead projection inputs: their own year-to-date, and their
      // share of the trailing-13-week run rate that the forward curve is built
      // from, so a filtered projection uses the filtered book's own pace.
      const leadName = (r: Record<string, unknown>) => {
        const t = String(r[`${TABLE}[team_lead]`] ?? "").trim();
        return t.length ? t : "—";
      };
      const fwdLeadRows = await pFwdLead;
      const fwdLeadTotal = fwdLeadRows.reduce((s2, r) => s2 + num(r, "rev"), 0);
      const fwdLeadOrdTotal = fwdLeadRows.reduce(
        (s2, r) => s2 + num(r, "ord"),
        0,
      );
      const fwdShare = new Map<string, { rev: number; ord: number }>();
      for (const r of fwdLeadRows) {
        fwdShare.set(leadName(r), {
          rev: fwdLeadTotal ? num(r, "rev") / fwdLeadTotal : 0,
          ord: fwdLeadOrdTotal ? num(r, "ord") / fwdLeadOrdTotal : 0,
        });
      }
      const projLeads = (await pYtdLead)
        .map(r => {
          const lead = leadName(r);
          const sh = fwdShare.get(lead) ?? { rev: 0, ord: 0 };
          return {
            lead,
            ytdRevenue: num(r, "rev"),
            ytdOrders: num(r, "ord"),
            share: sh.rev,
            ordShare: sh.ord,
          };
        })
        .filter(l => l.lead !== "—");

      // 4d. Rolling P75 baselines scoped to clinic / team lead / RSM
      // (2026-09-28, Thiru: the earlier company-wide rolling-P75 fix left
      // these scoped views on the old static day-of-week-rate × flat P75
      // scalar; validated against Power BI that a team lead's/RSM's own
      // headline baseline has to come from THEIR OWN aggregated daily
      // revenue run through the same trailing formula, not a sum of each
      // clinic's individual baseline — P75 does not distribute over a sum).
      //
      // clinicBaseDays (baseline window, per-clinic-per-day, collected above)
      // + clinicDays (current window, per-clinic-per-day) together already
      // span baselineStart..currentEnd with no gap (baselineEnd is the day
      // before currentStart), which is enough trailing history for every
      // selectable period's own rolling lookback — no extra Power BI pull
      // needed, this data was already being fetched and discarded into
      // day-of-week averages only.
      const clinicDateRev = new Map<string, Map<string, number>>();
      const clinicDateOrd = new Map<string, Map<string, number>>();
      const addClinicDay = (
        clinic: string,
        date: string,
        rev: number,
        ord: number,
      ) => {
        const rm = clinicDateRev.get(clinic) ?? new Map<string, number>();
        rm.set(date, (rm.get(date) ?? 0) + rev);
        clinicDateRev.set(clinic, rm);
        const om = clinicDateOrd.get(clinic) ?? new Map<string, number>();
        om.set(date, (om.get(date) ?? 0) + ord);
        clinicDateOrd.set(clinic, om);
      };
      for (const r of clinicBaseDays)
        addClinicDay(r.clinic, r.date, r.revenue, r.orders);
      for (const r of clinicDays)
        addClinicDay(r.clinic, r.date, r.revenue, r.orders);

      // Same daily history, aggregated by team lead and by RSM (sales rep)
      // via the identity map already built above — this is the "filter by
      // RSM first, then sum revenue per day" step Power BI's slicer does.
      const leadDateRev = new Map<string, Map<string, number>>();
      const leadDateOrd = new Map<string, Map<string, number>>();
      const salesDateRev = new Map<string, Map<string, number>>();
      const salesDateOrd = new Map<string, Map<string, number>>();
      const bumpScope = (
        store: Map<string, Map<string, number>>,
        key: string,
        date: string,
        v2: number,
      ) => {
        const m = store.get(key) ?? new Map<string, number>();
        m.set(date, (m.get(date) ?? 0) + v2);
        store.set(key, m);
      };
      const allClinicDays = [...clinicBaseDays, ...clinicDays];
      for (const r of allClinicDays) {
        const idty = identity.get(r.clinic);
        const lead = idty?.teamLead ?? "—";
        const sales = idty?.sales ?? "—";
        if (lead !== "—") {
          bumpScope(leadDateRev, lead, r.date, r.revenue);
          bumpScope(leadDateOrd, lead, r.date, r.orders);
        }
        if (sales !== "—") {
          bumpScope(salesDateRev, sales, r.date, r.revenue);
          bumpScope(salesDateOrd, sales, r.date, r.orders);
        }
      }

      const defs = periodDefs(currentStart, currentEnd);
      // Merged straight into the existing `clinicPeriod` rows (not a new
      // table) — drill()'s per-clinic query already collects the whole
      // clinicMeta + clinicPeriod tables every call, and adding a THIRD
      // ~7k-row collect for a separate baseline table pushed a few callers
      // (wins.ts's company-wide drill) over Convex's 16MB per-query byte
      // cap. Two more optional numbers on an already-collected row costs far
      // less than an extra collect.
      const clinicBaselineMap = new Map<
        string,
        { expectedRevenue: number; expectedOrders: number }
      >();
      // Perf (2026-10-08): prod refresh stalled here — baselinePlan was
      // rebuilt for every clinic×period and baselines were computed for
      // pairs with no clinicPeriod row. Build each plan once; only compute
      // needed pairs.
      const planOf = new Map(
        defs.map(d => [d.id, baselinePlan(d.kind, d.days)]),
      );
      const defById = new Map(defs.map(d => [d.id, d]));
      for (const row of clinicPeriod) {
        const key = `${row.periodId}|${row.clinic}`;
        if (clinicBaselineMap.has(key)) continue;
        const def = defById.get(row.periodId);
        const rm = clinicDateRev.get(row.clinic);
        if (!def || !rm) continue;
        const om = clinicDateOrd.get(row.clinic)!;
        const plan = planOf.get(def.id)!;
        clinicBaselineMap.set(key, {
          expectedRevenue: rollingBaseline(
            def.kind,
            def.days,
            d => rm.get(d) ?? 0,
            plan,
            { sparseFallback: true },
          ),
          expectedOrders: rollingBaseline(
            def.kind,
            def.days,
            d => om.get(d) ?? 0,
            plan,
            { sparseFallback: true },
          ),
        });
      }
      for (const row of clinicPeriod) {
        const b = clinicBaselineMap.get(`${row.periodId}|${row.clinic}`);
        if (b) {
          row.expectedRevenue = b.expectedRevenue;
          row.expectedOrdersP75 = b.expectedOrders;
        }
      }
      // Top-down allocation [Shyam, 2026-10-12]: overall → geo → rep×geo;
      // reps/leads are sums of their cells. Clinic P75 stays unscaled.
      const td = topDownAllocate({ defs, planOf, days: allClinicDays, identity, rates: clinicMeta.map(m => ({ clinic: m.clinic, rev: m.rev, ord: m.ord })), companyDaily: daily, target: { annual: cfg.annualTarget ?? 130_000_000, year: Number(currentEnd.slice(0, 4)), newSlice: (cfg as { newBusinessGoal?: number }).newBusinessGoal ?? (priorNewTotal || 0.05 * (cfg.annualTarget ?? 130_000_000)), newPhasing, newDefaultSlice: priorNewTotal || undefined } });
      const leadPeriodBaseline = td.lead;
      const salesPeriodBaseline = td.sales;
      // Clinic expectations are no longer scaled to reps: every clinic's goal is its baseline x the period goal factor (baseline.ts).
      // Reverted state layer [Shyam, 2026-10-12]: no geo plan rows; geo views
      // sum the (top-down scaled) clinic rows instead.
      const geoPeriodBaseline: Array<any> = [];

      const pullSecs = Math.round((Date.now() - startedAt) / 1000);

      // 5. Swap in the new data. Rows carry a generation number and readers
      // only see the current one, so we insert first, flip the pointer, and
      // delete the previous generation afterwards off the critical path —
      // deleting ~85k rows inline used to cost about two minutes.
      const gen: number = await ctx.runMutation(internal.config.reserveGen, {
        lease: !!repKey,
      });
      if (repKey) reservedRepGen = gen;
      const writes: Array<() => Promise<unknown>> = [
        ...chunk(daily, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putDailyTotals, { rows, gen }),
        ),
        ...chunk(stateDaily, 800).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putStateDaily, { rows, gen }),
        ),
        ...chunk(stateBaseline, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putStateBaseline, { rows, gen }),
        ),
        ...chunk(cohortDaily, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putCohortDaily, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putCohortBaseline, {
            rows: cohortBaseline,
            gen,
          }),
        ...chunk(newLogoBaseline, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putNewLogoBaseline, { rows, gen }),
        ),
        ...chunk(clinicMeta, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putClinicMeta, { rows, gen }),
        ),
        ...chunk(newClinicOrderSeq, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putNewClinicOrderSeq, {
              rows,
              gen,
            }),
        ),
        ...chunk(signupDaily, 1000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSignupDaily, { rows, gen }),
        ),
        ...chunk(signupLead, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSignupLead, { rows, gen }),
        ),
        ...chunk(vaClinicTarget, 500).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putVaClinicTarget, { rows, gen }),
        ),
        ...chunk(clinicPeriod, 2000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putClinicPeriod, { rows, gen }),
        ),
        ...chunk(leadPeriodBaseline, 2000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putLeadPeriodBaseline, {
              rows,
              gen,
            }),
        ),
        ...chunk(salesPeriodBaseline, 2000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putSalesPeriodBaseline, {
              rows,
              gen,
            }),
        ),
        ...chunk(td.periodGoal, 500).map(
          rows => () => ctx.runMutation(internal.ingest.putPeriodGoal, { rows, gen }),
        ),
        ...chunk(geoPeriodBaseline, 150).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putGeoPeriodBaseline, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putFamilyBaseline, {
            rows: familyBaseline,
            gen,
          }),
        ...chunk(familyPeriod, 2000).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilyPeriod, { rows, gen }),
        ),
        ...chunk(familyLeadSeries, 40).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilyLeadSeries, { rows, gen }),
        ),
        ...chunk(familySalesSeries, 40).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putFamilySalesSeries, {
              rows,
              gen,
            }),
        ),
        ...chunk(channelDaily, 800).map(
          rows => () =>
            ctx.runMutation(internal.ingest.putChannelDaily, { rows, gen }),
        ),
        () =>
          ctx.runMutation(internal.ingest.putProjection, {
            row: {
              ytdStart: yearStart,
              ytdEnd: currentEnd,
              ytdRevenue,
              ytdOrders,
              fwdRates,
              fwdOrdRates,
              days: projDays,
              holidays,
              leads: projLeads,
            },
            gen,
          }),
        () =>
          ctx.runMutation(internal.ingest.putChannelBaseline, {
            rows: channelBaseline,
            gen,
          }),
      ];
      // Inserts of distinct documents don't conflict, so these can overlap —
      // but Convex caps bytes written per second per deployment, and a wide
      // burst trips "Too many writes per second" and kills the whole refresh.
      // Keep the fan-out modest, pace each worker, and retry a throttled write
      // instead of failing the run.
      await runAll(
        repKey ? 20 : 4,
        writes.map(w => async () => {
          await withWriteRetry(w);
          if (!repKey) await sleep(200);
        }),
      );
      const insertedAt = Date.now();
      const totalSecs = Math.round((Date.now() - startedAt) / 1000);

      // Snapshot mode never touches the live "main" config row or purges any
      // gen — it writes under a "snapshot" config key, extracts insights,
      // then deletes just its own gen. The live dashboard is untouched.
      if (repKey) {
        const committed = await ctx.runMutation(
          internal.config.finishRepWindow,
          {
            key: repKey,
            currentStart,
            currentEnd,
            baselineStart,
            baselineEnd,
            baselineMode: mode,
            p75,
            gen,
            reqStart: start ?? currentStart,
            reqEnd: asOf,
            requestAt,
            baseRevAll: clinicMeta.reduce((t, m) => t + m.baseRev, 0),
            baseOrdersAll: clinicMeta.reduce((t, m) => t + m.baseOrders, 0),
          },
        );
        // A completed window is protected by config.gen; stale/reset windows
        // schedule deleteGen, which releases their lease after deletion.
        // Leave this lease until the deletion check is safe to avoid a cleanup
        // race with a simultaneous main purge.
        repGenCommitted = committed;
        if (committed)
          await ctx.runMutation(internal.ingest.releaseGenLease, { gen });
        for (let i = 0; i < 20; i++) {
          if (
            await ctx.runMutation(internal.ingest.clearCachePrefix, {
              prefix: repKey,
            })
          )
            break;
        }
        await ctx.runMutation(internal.ingest.finishLog, {
          id: logId,
          status: "ok",
          message: `Rep window ${currentStart} → ${currentEnd} ready (${repKey.slice(4)}) · ${pullSecs}s pull/compute + ${Math.round((insertedAt - startedAt) / 1000) - pullSecs}s insert + ${totalSecs - Math.round((insertedAt - startedAt) / 1000)}s finalize = ${totalSecs}s`,
          dataThrough: currentEnd,
          rows: clinicMeta.length,
        });
        return { dataThrough: currentEnd, rows: clinicMeta.length };
      }
      await ctx.runMutation(internal.config.writeSnapshot, {
        key: "snapshot",
        currentStart,
        currentEnd,
        baselineStart,
        baselineEnd,
        lagDays,
        autoBaseline: cfg.autoBaseline,
        autoEnd: false,
        baselineMode: mode,
        p75,
        gen,
        genSeq: gen,
        baseRevAll: clinicMeta.reduce((t, m) => t + m.baseRev, 0),
        baseOrdersAll: clinicMeta.reduce((t, m) => t + m.baseOrders, 0),
      });
      try {
        await ctx.runMutation(internal.insights.generateFromRefresh, {
          date: currentEnd,
          cadence,
          configKey: "snapshot",
        });
      } catch (e) {
        console.error("snapshot insight generation failed", e);
      }
      await ctx.runMutation(internal.ingest.deleteGen, { gen });

      const rowCount =
        daily.length +
        stateDaily.length +
        cohortDaily.length +
        stateBaseline.length;
      await ctx.runMutation(internal.ingest.finishLog, {
        id: logId,
        status: "ok",
        message: `Loaded ${daily.length} days, ${stateDaily.length} state-days, ${clinicDays.length} clinic-days, ${clinicMeta.length} clinics, ${clinicPeriod.length} clinic-period rows, ${famSize.size} product families · ${pullSecs}s pull + ${Math.round((insertedAt - startedAt) / 1000) - pullSecs}s insert = ${totalSecs}s`,
        dataThrough: currentEnd,
        rows: rowCount,
      });
      return { dataThrough: currentEnd, rows: rowCount };
    } catch (error) {
      await ctx.runMutation(internal.ingest.finishLog, {
        id: logId,
        status: "error",
        message: String(error).slice(0, 800),
      });
      if (repKey) {
        if (reservedRepGen && !repGenCommitted) {
          await ctx.scheduler.runAfter(0, internal.ingest.deleteGen, {
            gen: reservedRepGen,
          });
        }
        await ctx.runMutation(internal.config.failRepWindow, {
          key: repKey,
          error: String(error).slice(0, 300),
          requestAt,
        });
        return { dataThrough: asOf, rows: 0 };
      }
      throw error;
    }
  },
});

/** Manual refresh from the dashboard. */
export const refreshNow = gatedAction({
  args: {},
  returns: v.object({ dataThrough: v.string(), rows: v.number() }),
  handler: async (ctx): Promise<{ dataThrough: string; rows: number }> =>
    await ctx.runAction(internal.refresh.refreshData, {}),
});

/** Weekly cadence tick (Shyam, 2026-09-23): runs Monday, snapshots "as of"
 * yesterday (the week just completed) with cadence "weekly". Called only
 * from the cron in crons.ts. */
export const weeklySnapshotTick = internalAction({
  args: {},
  handler: async ctx => {
    const cfg = await ctx.runQuery(internal.config.getInternal, {});
    const asOf = addDays(
      cfg.currentEnd < todayStr() ? cfg.currentEnd : todayStr(),
      -1,
    );
    await ctx.runAction(internal.refresh.refreshSnapshot, {
      asOf,
      cadence: "weekly",
    });
  },
});

/** Monthly cadence tick (Shyam, 2026-09-23): runs the 1st, snapshots the
 * last day of the month that just ended with cadence "monthly". Called only
 * from the cron in crons.ts. */
export const monthlySnapshotTick = internalAction({
  args: {},
  handler: async ctx => {
    const t = todayStr();
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate(); // day 0 of this month = last day of prior month
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const asOf = `${py}-${String(pm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    await ctx.runAction(internal.refresh.refreshSnapshot, {
      asOf,
      cadence: "monthly",
    });
  },
});

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One-time backfill of ~3 months of weekly + monthly insight snapshots
 * (Shyam, 2026-09-23), plus the ongoing entry point for the weekly/monthly
 * cadence going forward. Processes one snapshot per invocation and
 * self-schedules the next one 3s later — each `refreshSnapshot` call is a
 * full historical DAX pull, so chaining keeps any single action short and
 * lets one bad snapshot (network hiccup, etc.) not block the rest.
 *
 * Call with no args to start a fresh run (builds ~13 weekly cutoffs 7 days
 * apart plus the last 3 completed month-ends); pass `remaining` to resume/
 * continue a specific queue (used internally).
 */
export const backfillInsightHistory = internalAction({
  args: {
    remaining: v.optional(
      v.array(
        v.object({
          date: v.string(),
          cadence: v.union(v.literal("weekly"), v.literal("monthly")),
        }),
      ),
    ),
  },
  handler: async (
    ctx,
    { remaining },
  ): Promise<{ done: boolean; remaining: number }> => {
    let queue = remaining;
    if (!queue) {
      const cfg = await ctx.runQuery(internal.config.getInternal, {});
      const today: string = cfg.currentEnd;
      const weekly: string[] = [];
      let cursor = today;
      for (let i = 0; i < 13; i++) {
        weekly.push(cursor);
        cursor = addDays(cursor, -7);
      }
      const monthly: string[] = [];
      let y = Number(today.slice(0, 4));
      let m = Number(today.slice(5, 7));
      for (let i = 0; i < 3; i++) {
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
        monthly.push(
          `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        );
      }
      queue = [
        ...weekly.map(date => ({ date, cadence: "weekly" as const })),
        ...monthly.map(date => ({ date, cadence: "monthly" as const })),
      ];
    }
    if (queue.length === 0) return { done: true, remaining: 0 };
    const [next, ...rest] = queue;
    let retryDelayMs = 3000;
    let requeue = rest;
    try {
      await ctx.runAction(internal.refresh.refreshSnapshot, {
        asOf: next.date,
        cadence: next.cadence,
      });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("REFRESH_IN_PROGRESS")) {
        // The live dashboard's own daily refresh (or another snapshot) has
        // the write lock — re-queue this same item instead of dropping it,
        // and back off longer than a normal step.
        console.log(
          `backfill: ${next.cadence} ${next.date} deferred (refresh in progress)`,
        );
        requeue = [next, ...rest];
        retryDelayMs = 90_000;
      } else {
        console.error(
          `backfill snapshot failed for ${next.cadence} ${next.date}`,
          e,
        );
      }
    }
    if (requeue.length > 0) {
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internal.refresh.backfillInsightHistory,
        {
          remaining: requeue,
        },
      );
    }
    return { done: requeue.length === 0, remaining: requeue.length };
  },
});
