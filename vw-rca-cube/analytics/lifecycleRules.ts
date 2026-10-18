/**
 * Clinic lifecycle rules (Shyam, 2026-10-18; see CLINIC_LIFECYCLE.md). Pure functions: the rebuild (refresh.ts) and the
 * offline checks both call these, so there is one definition.
 *
 *  New          first-ever order in the current calendar year, wherever it falls. No baseline.
 *  Churned      last order is `threshold` or more days before the cutoff. threshold = 45 for new clinics and for clinics
 *               with no measurable typical gap; otherwise max(45, 3 x the clinic's typical gap between orders).
 *  Existing     not new and has baseline revenue (or a baseline from its own longer history, see below).
 *  Reactivated  not new, no baseline revenue, and the order that ended an unusual gap (>= threshold) is within the last
 *               90 days. A new clinic is reactivated by the same test (gap >= 45 days). A clinic with baseline revenue is
 *               never reactivated: it stays Existing.
 *  Own-history baseline  a clinic that is not new, has no baseline revenue, is ordering now and has no unusual gap (a slow
 *               buyer that skipped the baseline period) gets its average daily revenue over the 12 months before the
 *               baseline period ended, so it is Existing instead of homeless.
 */
import { diffDays } from "./dateUtils";

export const CHURN_MIN_DAYS = 45;
export const GAP_MULTIPLE = 3;
export const REACTIVATED_RECENT_DAYS = 90;
/** Orders needed before a clinic's own typical gap is trusted (4 order days = 3 gaps). */
export const MIN_ORDERS_FOR_GAP = 4;

export type LifeStatus = "active" | "reactivated" | "churned";

export type Lifecycle = {
  isNew: boolean;
  life: LifeStatus;
  /** the clinic gets a baseline from its own 12 months before the baseline period (non-new, no baseline revenue, ordering) */
  ownHistoryBaseline: boolean;
  threshold: number;
  typicalGap: number | null;
  /** date of the order that ended the most recent unusual gap, if any */
  gapEnd: string | null;
  daysSinceLast: number | null;
};

const uniqSorted = (dates: readonly string[], cutoff: string): string[] =>
  [...new Set(dates.filter(d => d && d <= cutoff))].sort();

/** Median calendar-day gap between consecutive order days; null when there are too few orders to trust it. */
export function typicalGapDays(dates: readonly string[]): number | null {
  if (dates.length < MIN_ORDERS_FOR_GAP) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(diffDays(dates[i - 1], dates[i]));
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

export function gapThreshold(isNew: boolean, typical: number | null): number {
  if (isNew || typical === null) return CHURN_MIN_DAYS;
  return Math.max(CHURN_MIN_DAYS, GAP_MULTIPLE * typical);
}

/** The order that ended the most recent gap of at least `threshold` days between two consecutive orders. */
export function lastGapEnd(dates: readonly string[], threshold: number): string | null {
  for (let i = dates.length - 1; i >= 1; i--) if (diffDays(dates[i - 1], dates[i]) >= threshold) return dates[i];
  return null;
}

export function classifyClinic(inp: {
  firstOrder: string;
  /** distinct order days (any order, may include days after the cutoff and duplicates) */
  orderDates: readonly string[];
  cutoff: string;
  /** revenue in the baseline period > 0 */
  hasBaselineRevenue: boolean;
  /** revenue in the analysis window > 0 */
  hasWindowRevenue: boolean;
  /** revenue in the 12 months before the baseline period ended (the baseline period itself is not needed: it is 0 here) */
  priorRevenue: number;
}): Lifecycle {
  const dates = uniqSorted(inp.orderDates, inp.cutoff);
  const year = inp.cutoff.slice(0, 4);
  const isNew = (inp.firstOrder ?? "").startsWith(year);
  const typicalGap = isNew ? null : typicalGapDays(dates);
  const threshold = gapThreshold(isNew, typicalGap);
  const last = dates.length ? dates[dates.length - 1] : null;
  const daysSinceLast = last ? diffDays(last, inp.cutoff) : null;
  const churned = daysSinceLast === null || daysSinceLast >= threshold;
  const gapEnd = lastGapEnd(dates, threshold);
  const recentReactivation = gapEnd !== null && diffDays(gapEnd, inp.cutoff) < REACTIVATED_RECENT_DAYS;

  let life: LifeStatus = churned ? "churned" : "active";
  let ownHistoryBaseline = false;
  if (isNew) {
    if (!churned && recentReactivation) life = "reactivated";
  } else if (!inp.hasBaselineRevenue && inp.hasWindowRevenue) {
    // Not new, no baseline revenue, ordering in the window.
    if (!churned && recentReactivation) life = "reactivated";
    else if (inp.priorRevenue > 0) ownHistoryBaseline = true; // slow buyer (or reactivated long ago): Existing on its own history
    else if (!churned) life = "reactivated"; // no history to build a baseline from: stays a returning clinic
  }
  return { isNew, life, ownHistoryBaseline, threshold, typicalGap, gapEnd, daysSinceLast };
}
