/**
 * Shared clinic-health flag evaluator.
 *
 * Replaces the imported `clinic_dimension[Note]` text (Power BI) with the
 * same flag titles and thresholds, computed here from RCA's own
 * selected-period actual/expected values (performance flags), from source
 * metrics carried on the clinic's `clinicMeta` row (operational flags).
 * Nothing is imported from Power BI's clinic_dimension[Note].
 *
 * Approved by Thiru (#internal-test, 2026-09-21): keep the exact flag
 * titles and thresholds; no MTD override, no 7-business-day pacing hold —
 * every flag is evaluated straight off the selected period's own numbers
 * and the clinic's as-of-cutoff tenure/relationship data. No new filters,
 * conditions or threshold explanations are surfaced in the UI — the badges
 * are the title strings below and nothing else.
 *
 * Thiru (2026-10-12): High Ticket Volume is removed from RCA entirely;
 * Buying Overdue is computed natively from the clinic's own order-date
 * history in business days (see `buyingRhythm`).
 */

import { addDays, diffDays, isWeekday } from "./dateUtils";

export const FLAG = {
  FAILED_TO_LAUNCH: "🚨 Failed to Launch",
  BUNDLE_DEFECTOR: "📉 Bundle Defector",
  GHOSTED_VIP: "⏳ Ghosted VIP",
  CHURNED: "🛑 Churned / Lost",
  SLIPPING_AWAY: "⚠️ Slipping Away (Late)",
  AOV_BLEED: "🔻 AOV Bleed (>25% Drop)",
  REVENUE_BLEED: "📉 Revenue Bleed (>25% Drop)",
  ORDERS_BLEED: "📉 Orders Bleed (>25% Drop)",
  HIGH_VA: "🎯 High VA Dependency",
  HIGH_MARGIN_BLEED: "💸 High Margin Bleed (>25% Deductions)",
  BUYING_OVERDUE: "⏰ Buying Overdue",
  NURTURE: "🌱 Nurture (First 45 Days)",
  HEALTHY: "✅ Healthy",
} as const;

/** Mon-Fri days in (a, b] — 0 when b <= a. Weekend dates count as no day. */
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  const first = dow(y, m, 1);
  return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y: number, m: number, wd: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, last - ((dow(y, m, last) - wd + 7) % 7));
}
function observed(y: number, m: number, d: number): string {
  const w = dow(y, m, d);
  const t = new Date(Date.UTC(y, m - 1, d + (w === 6 ? -1 : w === 0 ? 1 : 0)));
  return t.toISOString().slice(0, 10);
}
const holidayCache = new Map<number, Set<string>>();
/** Observed US federal (OPM) holidays falling in `year`, incl. next year's
 * Jan 1 when observed on Dec 31. Distinct from dateUtils FIXED_DATE_HOLIDAYS
 * (baseline shadow days). */
export function federalHolidays(year: number): Set<string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const all = [
    observed(year, 1, 1), nthWeekday(year, 1, 1, 3), nthWeekday(year, 2, 1, 3),
    lastWeekday(year, 5, 1), observed(year, 6, 19), observed(year, 7, 4),
    nthWeekday(year, 9, 1, 1), nthWeekday(year, 10, 1, 2), observed(year, 11, 11),
    nthWeekday(year, 11, 4, 4), observed(year, 12, 25), observed(year + 1, 1, 1),
  ].filter(d => d.startsWith(`${year}-`));
  const set = new Set(all);
  holidayCache.set(year, set);
  return set;
}
export function isFederalHoliday(d: string): boolean {
  return federalHolidays(Number(d.slice(0, 4))).has(d);
}

/** Business days in (a, b]: Mon–Fri excluding observed US federal holidays. */
export function businessDaysBetween(a: string, b: string): number {
  const total = diffDays(a, b);
  if (total <= 0) return 0;
  const weeks = Math.floor(total / 7);
  let n = weeks * 5;
  for (let d = addDays(a, weeks * 7 + 1); d <= b; d = addDays(d, 1)) {
    if (isWeekday(d)) n++;
  }
  const y0 = Number(a.slice(0, 4)), y1 = Number(b.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const h of federalHolidays(y)) if (h > a && h <= b && isWeekday(h)) n--;
  }
  return n;
}

/**
 * Buying-rhythm inputs from a clinic's order dates up to `cutoff`: needs >=3
 * distinct order dates; gaps between consecutive distinct dates in business
 * days; median of those gaps; business days from the last order to cutoff.
 * Returns undefined when ineligible.
 */
export function buyingRhythm(
  orderDates: readonly string[],
  cutoff: string,
): { medianGapBd: number; bdSinceLastOrder: number } | undefined {
  const dates = [...new Set(orderDates.filter(d => d && d <= cutoff))].sort();
  if (dates.length < 3) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(businessDaysBetween(dates[i - 1], dates[i]));
  }
  gaps.sort((x, y) => x - y);
  const mid = gaps.length >> 1;
  const medianGapBd =
    gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return {
    medianGapBd,
    bdSinceLastOrder: businessDaysBetween(dates[dates.length - 1], cutoff),
  };
}

/** Buying Overdue: business days since last order / max(median gap, 2) >= 3. */
export function isBuyingOverdue(
  medianGapBd: number | undefined,
  bdSinceLastOrder: number | undefined,
): boolean {
  if (medianGapBd === undefined || bdSinceLastOrder === undefined) return false;
  return bdSinceLastOrder / Math.max(medianGapBd, 2) >= 3;
}

export type PerformanceInputs = {
  /** Whole-clinic actual/expected for the selected period — never the
   * bundle/nonbundle/family-scoped numbers, so a flag reads the same no
   * matter which lens or drill-down it's shown under. */
  actual: number;
  expected: number;
  orders: number;
  expectedOrders: number;
  bundleOrders: number;
  expectedBundleOrders: number;
};

export type OperationalInputs = {
  /** As-of-cutoff (cfg.currentEnd) year-to-date orders/revenue. */
  ytdOrders: number;
  ytdRevenue: number;
  /** True last order date across the clinic's whole history, "" if never. */
  lastOrderAllTime: string;
  /** First order date ever, "" if never. */
  firstOrder: string;
  /** YTD VA-order share, undefined if ytdOrders is 0 (nothing to divide). */
  vaYtdPct?: number;
  /** Lifetime fee/deduction rate, undefined if lifetime revenue is 0. */
  lifetimeDeductionRate?: number;
  /** Last mapped HubSpot touchpoint date, undefined if none could be mapped. */
  lastTouchDate?: string;
  /** Whether ANY touchpoint was mappable to this clinic at all. */
  touchDataAvailable: boolean;
  /** Buying-rhythm inputs (business days), undefined when ineligible. */
  medianGapBd?: number;
  bdSinceLastOrder?: number;
};

function daysSince(
  cutoff: string,
  date: string | undefined | "",
): number | null {
  if (!date) return null;
  return diffDays(date, cutoff);
}

/**
 * Evaluates every clinic-health flag for one clinic in one selected period.
 * `cutoff` is the reporting as-of date (cfg.currentEnd) — the anchor for all
 * tenure/relationship math, independent of which periodId is being browsed.
 *
 * Order follows the source DAX's own `_CombinedAlerts` concatenation order
 * (skipping the two blocked flags) so the badge order is stable and familiar.
 */
export function evaluateFlags(
  cutoff: string,
  op: OperationalInputs,
  perf: PerformanceInputs,
): string[] {
  const daysSinceLastOrder = daysSince(cutoff, op.lastOrderAllTime);
  const daysSinceFirstOrder = daysSince(cutoff, op.firstOrder);

  // Ancient-churn guardrail: a clinic with no order history at all, or none
  // in over a year, gets NO flags (mirrors the source DAX's own BLANK()
  // short-circuit) rather than noisy stale alerts.
  const noHistory = daysSinceLastOrder === null;
  const ancientChurn = daysSinceLastOrder !== null && daysSinceLastOrder > 365;
  const noYtdData = op.ytdOrders === 0 && op.ytdRevenue === 0 && noHistory;
  if (noHistory || ancientChurn || noYtdData) return [];

  const flags: string[] = [];

  // 2. Failed to Launch — 1 or 2 orders total this year, silent 45+ days.
  if (
    op.ytdOrders >= 1 &&
    op.ytdOrders <= 2 &&
    daysSinceLastOrder !== null &&
    daysSinceLastOrder >= 45
  ) {
    flags.push(FLAG.FAILED_TO_LAUNCH);
  }

  // 3. Bundle Defector — actual bundle orders <=50% of expected; expected>=3.
  if (
    perf.expectedBundleOrders >= 3 &&
    perf.bundleOrders <= 0.5 * perf.expectedBundleOrders
  ) {
    flags.push(FLAG.BUNDLE_DEFECTOR);
  }

  // 4. Ghosted VIP — YTD revenue >= $10k, no HubSpot touch in 45+ days.
  // Only evaluated when we could actually map a touchpoint history for this
  // clinic; otherwise it's left un-evaluated (never silently cleared).
  const ghostedEligible = op.ytdRevenue >= 10000;
  let ghostedUnknown = false;
  if (ghostedEligible) {
    if (!op.touchDataAvailable) {
      ghostedUnknown = true;
    } else {
      const daysSinceTouch = daysSince(cutoff, op.lastTouchDate);
      if (daysSinceTouch !== null && daysSinceTouch >= 45) {
        flags.push(FLAG.GHOSTED_VIP);
      } else if (daysSinceTouch === null) {
        ghostedUnknown = true;
      }
    }
  }

  // 5/6. Churned/Lost vs Slipping Away (Late) — both require YTD orders to
  // be 0 or >2 (i.e. NOT the 1-2 "Failed to Launch" band).
  const churnEligible = op.ytdOrders === 0 || op.ytdOrders > 2;
  if (churnEligible && daysSinceLastOrder !== null) {
    if (daysSinceLastOrder > 60) {
      flags.push(FLAG.CHURNED);
    } else if (daysSinceLastOrder >= 31 && daysSinceLastOrder <= 60) {
      flags.push(FLAG.SLIPPING_AWAY);
    }
  }

  // 7. AOV Bleed — actual AOV <=75% of expected AOV; needs >=1 actual order
  // and a positive expected AOV.
  const actualAov = perf.orders > 0 ? perf.actual / perf.orders : 0;
  const expectedAov =
    perf.expectedOrders > 0 ? perf.expected / perf.expectedOrders : 0;
  if (perf.orders >= 1 && expectedAov > 0 && actualAov <= 0.75 * expectedAov) {
    flags.push(FLAG.AOV_BLEED);
  }

  // 10/11 (source numbering) — Revenue Bleed / Orders Bleed, straight
  // selected-period actual vs expected, no MTD/business-day gate.
  if (perf.expected > 0 && perf.actual <= 0.75 * perf.expected) {
    flags.push(FLAG.REVENUE_BLEED);
  }
  if (perf.expectedOrders > 0 && perf.orders <= 0.75 * perf.expectedOrders) {
    flags.push(FLAG.ORDERS_BLEED);
  }

  // 8. High VA Dependency — YTD orders >=10, YTD VA-order share >50%.
  const vaEligible = op.ytdOrders >= 10;
  let vaUnknown = false;
  if (vaEligible) {
    if (op.vaYtdPct === undefined) {
      vaUnknown = true;
    } else if (op.vaYtdPct > 0.5) {
      flags.push(FLAG.HIGH_VA);
    }
  }

  // 9. High Margin Bleed — YTD revenue >=$5k, lifetime deduction rate >=25%.
  const marginEligible = op.ytdRevenue >= 5000;
  let marginUnknown = false;
  if (marginEligible) {
    if (op.lifetimeDeductionRate === undefined) {
      marginUnknown = true;
    } else if (op.lifetimeDeductionRate >= 0.25) {
      flags.push(FLAG.HIGH_MARGIN_BLEED);
    }
  }

  // Buying Overdue — anchored at cutoff; ineligible/missing = no flag and
  // does not block Healthy.
  if (isBuyingOverdue(op.medianGapBd, op.bdSinceLastOrder)) {
    flags.push(FLAG.BUYING_OVERDUE);
  }

  if (flags.length > 0) return flags;

  // Fallback: Nurture/Healthy only when every check that COULD have fired
  // actually ran with real data. A clinic that was ELIGIBLE for a check
  // (Ghosted VIP by YTD revenue, High VA Dependency / High Margin Bleed by
  // YTD orders or revenue) but whose input was missing/unverifiable is left
  // unflagged rather than called Healthy/Nurture — "missing must not
  // misclassify".
  if (ghostedUnknown || vaUnknown || marginUnknown) return [];

  if (daysSinceFirstOrder !== null && daysSinceFirstOrder <= 45) {
    return [FLAG.NURTURE];
  }
  return [FLAG.HEALTHY];
}
