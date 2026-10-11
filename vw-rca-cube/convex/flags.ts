/**
 * Shared clinic-health flag evaluator.
 *
 * Replaces the imported `clinic_dimension[Note]` text (Power BI) with the
 * same flag titles and thresholds, computed here from RCA's own
 * selected-period actual/expected values (performance flags), from source
 * metrics carried on the clinic's `clinicMeta` row (operational flags), and
 * only the two approved external-source flags from Power BI's Note field.
 *
 * Approved by Thiru (#internal-test, 2026-09-21): keep the exact flag
 * titles and thresholds; no MTD override, no 7-business-day pacing hold —
 * every flag is evaluated straight off the selected period's own numbers
 * and the clinic's as-of-cutoff tenure/relationship data. No new filters,
 * conditions or threshold explanations are surfaced in the UI — the badges
 * are the title strings below and nothing else.
 *
 * High Ticket Volume and Buying Overdue are sourced from the Revenue
 * Intelligence clinic_dimension[Note] field, as newly approved; all other
 * flags remain RCA-computed.
 */

import { diffDays } from "./dateUtils";

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
  HIGH_TICKET_VOLUME: "⚠️ High Ticket Volume",
  BUYING_OVERDUE: "⏰ Buying Overdue",
  NURTURE: "🌱 Nurture (First 45 Days)",
  HEALTHY: "✅ Healthy",
} as const;

/**
 * Exact imported flags allowed from clinic_dimension[Note].
 *
 * These flags are imported verbatim from the source's existing Note string
 * because the source ticket row key is blank, and the owner explicitly
 * approved these two Revenue Intelligence flags as exceptions. Never import
 * any other Note title here: performance and all remaining operational
 * alerts remain RCA-owned.
 */
export const IMPORTED_FLAG_SET: ReadonlySet<string> = new Set([
  FLAG.HIGH_TICKET_VOLUME,
  FLAG.BUYING_OVERDUE,
]);

export function approvedImportedFlags(
  values: readonly string[] = [],
): string[] {
  return [...new Set(values.filter(value => IMPORTED_FLAG_SET.has(value)))];
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
  importedFlags: readonly string[] = [],
): string[] {
  const imported = approvedImportedFlags(importedFlags);
  const daysSinceLastOrder = daysSince(cutoff, op.lastOrderAllTime);
  const daysSinceFirstOrder = daysSince(cutoff, op.firstOrder);

  // Ancient-churn guardrail: a clinic with no order history at all, or none
  // in over a year, gets NO flags (mirrors the source DAX's own BLANK()
  // short-circuit) rather than noisy stale alerts.
  const noHistory = daysSinceLastOrder === null;
  const ancientChurn = daysSinceLastOrder !== null && daysSinceLastOrder > 365;
  const noYtdData = op.ytdOrders === 0 && op.ytdRevenue === 0 && noHistory;
  // These two flags come from the Power BI Note's own eligibility logic.
  // Preserve them even when the RCA no-history / ancient-churn guard would
  // otherwise suppress all RCA-evaluated flags.
  if (noHistory || ancientChurn || noYtdData) return imported;

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

  if (flags.length > 0) return [...flags, ...imported];

  // Fallback: Nurture/Healthy only when every check that COULD have fired
  // actually ran with real data. A clinic that was ELIGIBLE for a check
  // (Ghosted VIP by YTD revenue, High VA Dependency / High Margin Bleed by
  // YTD orders or revenue) but whose input was missing/unverifiable is left
  // unflagged rather than called Healthy/Nurture — "missing must not
  // misclassify".
  if (ghostedUnknown || vaUnknown || marginUnknown) return imported;
  // Source alerts are already a substantive classification; don't append a
  // mutually misleading Healthy/Nurture fallback beside them.
  if (imported.length > 0) return imported;

  if (daysSinceFirstOrder !== null && daysSinceFirstOrder <= 45) {
    return [...imported, FLAG.NURTURE];
  }
  return [...imported, FLAG.HEALTHY];
}
