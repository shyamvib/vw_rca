import { describe, expect, test } from "bun:test";
import type { OperationalInputs, PerformanceInputs } from "../convex/flags";
import {
  businessDaysBetween,
  buyingRhythm,
  evaluateFlags,
  FLAG,
  isBuyingOverdue,
} from "../convex/flags";

const CUTOFF = "2026-09-21";

function op(overrides: Partial<OperationalInputs> = {}): OperationalInputs {
  return {
    ytdOrders: 20,
    ytdRevenue: 20000,
    lastOrderAllTime: "2026-09-15",
    firstOrder: "2024-01-01",
    vaYtdPct: 0.1,
    lifetimeDeductionRate: 0.05,
    lastTouchDate: "2026-09-10",
    touchDataAvailable: true,
    ...overrides,
  };
}

function perf(overrides: Partial<PerformanceInputs> = {}): PerformanceInputs {
  return {
    actual: 1000,
    expected: 1000,
    orders: 10,
    expectedOrders: 10,
    bundleOrders: 5,
    expectedBundleOrders: 5,
    ...overrides,
  };
}

describe("evaluateFlags — ancient churn / no data guard", () => {
  test("no order history ever -> no flags", () => {
    expect(
      evaluateFlags(
        CUTOFF,
        op({ lastOrderAllTime: "", ytdOrders: 0, ytdRevenue: 0 }),
        perf(),
      ),
    ).toEqual([]);
  });

  test("last order > 365 days before cutoff -> no flags at all", () => {
    expect(
      evaluateFlags(
        CUTOFF,
        op({ lastOrderAllTime: "2025-01-01", ytdOrders: 0 }),
        perf({ actual: 0, expected: 5000 }), // would otherwise be Revenue Bleed
      ),
    ).toEqual([]);
  });

  test("last order exactly 365 days back is NOT ancient (boundary)", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ lastOrderAllTime: "2025-09-21", ytdOrders: 0 }),
      perf(),
    );
    // 365 days back, ytdOrders 0 -> churn-eligible; daysSinceLastOrder=365, not >60? it's >60 so Churned
    expect(res).toContain(FLAG.CHURNED);
  });
});

describe("evaluateFlags — performance flags", () => {
  test("Revenue Bleed fires at exactly 75% (>=25% drop)", () => {
    const res = evaluateFlags(
      CUTOFF,
      op(),
      perf({ actual: 750, expected: 1000, orders: 10, expectedOrders: 10 }),
    );
    expect(res).toContain(FLAG.REVENUE_BLEED);
  });

  test("Revenue Bleed does NOT fire just above the 75% line", () => {
    const res = evaluateFlags(
      CUTOFF,
      op(),
      perf({ actual: 751, expected: 1000, orders: 10, expectedOrders: 10 }),
    );
    expect(res).not.toContain(FLAG.REVENUE_BLEED);
  });

  test("Revenue Bleed requires expected > 0", () => {
    const res = evaluateFlags(CUTOFF, op(), perf({ actual: 0, expected: 0 }));
    expect(res).not.toContain(FLAG.REVENUE_BLEED);
  });

  test("Orders Bleed mirrors Revenue Bleed's threshold on orders", () => {
    const res = evaluateFlags(
      CUTOFF,
      op(),
      perf({ orders: 7, expectedOrders: 10, actual: 1000, expected: 1000 }),
    );
    expect(res).toContain(FLAG.ORDERS_BLEED);
  });

  test("AOV Bleed needs >=1 actual order and positive expected AOV", () => {
    const dropped = evaluateFlags(
      CUTOFF,
      op(),
      perf({ actual: 100, orders: 1, expected: 1000, expectedOrders: 10 }), // AOV 100 vs 100 exp -> not a drop
    );
    // actual AOV = 100/1=100, expected AOV = 1000/10=100 -> not <=75, no flag
    expect(dropped).not.toContain(FLAG.AOV_BLEED);

    const real = evaluateFlags(
      CUTOFF,
      op(),
      perf({ actual: 50, orders: 1, expected: 1000, expectedOrders: 10 }), // AOV 50 vs 100 -> 50%
    );
    expect(real).toContain(FLAG.AOV_BLEED);

    const zeroOrders = evaluateFlags(
      CUTOFF,
      op(),
      perf({ actual: 0, orders: 0, expected: 1000, expectedOrders: 10 }),
    );
    expect(zeroOrders).not.toContain(FLAG.AOV_BLEED);
  });

  test("Bundle Defector needs expected bundle orders >=3 and actual <=50%", () => {
    const yes = evaluateFlags(
      CUTOFF,
      op(),
      perf({ bundleOrders: 1, expectedBundleOrders: 4 }),
    );
    expect(yes).toContain(FLAG.BUNDLE_DEFECTOR);

    const tooSmallBase = evaluateFlags(
      CUTOFF,
      op(),
      perf({ bundleOrders: 0, expectedBundleOrders: 2 }),
    );
    expect(tooSmallBase).not.toContain(FLAG.BUNDLE_DEFECTOR);
  });

  test("performance flags describe the whole clinic regardless of caller's lens scoping", () => {
    // Simulates a caller in a bundle-drilldown lens still passing WHOLE-clinic
    // actual/expected (not the bundle-scoped numbers) — this is a contract
    // test: evaluateFlags itself has no lens concept, callers must pass
    // whole-clinic numbers, which this test documents/asserts by example.
    const wholeClinic = perf({ actual: 700, expected: 1000 });
    const res = evaluateFlags(CUTOFF, op(), wholeClinic);
    expect(res).toContain(FLAG.REVENUE_BLEED);
  });
});

describe("evaluateFlags — operational flags", () => {
  test("Failed to Launch: 1-2 YTD orders, silent >=45 days", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 2, lastOrderAllTime: "2026-08-01" }), // 51 days back
      perf(),
    );
    expect(res).toContain(FLAG.FAILED_TO_LAUNCH);
  });

  test("Failed to Launch does not fire at 3+ YTD orders", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 3, lastOrderAllTime: "2026-08-01" }),
      perf(),
    );
    expect(res).not.toContain(FLAG.FAILED_TO_LAUNCH);
  });

  test("Ghosted VIP: YTD revenue >=10k, last touch >=45 days", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({
        ytdRevenue: 15000,
        lastTouchDate: "2026-08-01",
        touchDataAvailable: true,
      }),
      perf(),
    );
    expect(res).toContain(FLAG.GHOSTED_VIP);
  });

  test("Ghosted VIP is withheld (not Healthy) when touch data is unavailable for an eligible clinic", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({
        ytdRevenue: 15000,
        touchDataAvailable: false,
        lastTouchDate: undefined,
      }),
      perf(),
    );
    expect(res).toEqual([]); // not Healthy, not Ghosted VIP — genuinely unevaluated
  });

  test("Ghosted VIP missing data does not block Healthy for a LOW-value clinic", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({
        ytdRevenue: 500,
        touchDataAvailable: false,
        lastTouchDate: undefined,
      }),
      perf(),
    );
    expect(res).toEqual([FLAG.HEALTHY]);
  });

  test("Churned/Lost vs Slipping Away (Late) boundaries", () => {
    const churned = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 0, lastOrderAllTime: "2026-07-20" }), // 63 days
      perf(),
    );
    expect(churned).toContain(FLAG.CHURNED);

    const slipping = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 0, lastOrderAllTime: "2026-08-15" }), // 37 days
      perf(),
    );
    expect(slipping).toContain(FLAG.SLIPPING_AWAY);

    const tooRecent = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 5, lastOrderAllTime: "2026-09-10" }), // 11 days
      perf(),
    );
    expect(tooRecent).not.toContain(FLAG.CHURNED);
    expect(tooRecent).not.toContain(FLAG.SLIPPING_AWAY);
  });

  test("High VA Dependency: YTD orders >=10 and VA share >50%", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 12, vaYtdPct: 0.6 }),
      perf(),
    );
    expect(res).toContain(FLAG.HIGH_VA);

    const belowThreshold = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 12, vaYtdPct: 0.5 }),
      perf(),
    );
    expect(belowThreshold).not.toContain(FLAG.HIGH_VA);
  });

  test("High Margin Bleed: YTD revenue >=5k and lifetime deduction rate >=25%", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdRevenue: 6000, lifetimeDeductionRate: 0.3 }),
      perf(),
    );
    expect(res).toContain(FLAG.HIGH_MARGIN_BLEED);
  });

  test("missing lifetime deduction rate never misclassifies as Healthy silently by inventing 0", () => {
    // undefined deduction rate should simply not trigger the flag, not act as 0%.
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdRevenue: 6000, lifetimeDeductionRate: undefined }),
      perf(),
    );
    expect(res).not.toContain(FLAG.HIGH_MARGIN_BLEED);
    // ...and must NOT fall through to Healthy/Nurture either — the clinic was
    // eligible (YTD revenue >=5k) but the check is unverifiable.
    expect(res).toEqual([]);
  });

  test("missing VA % for an eligible clinic withholds Healthy/Nurture, doesn't fire the flag", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdOrders: 15, vaYtdPct: undefined }),
      perf(),
    );
    expect(res).not.toContain(FLAG.HIGH_VA);
    expect(res).toEqual([]);
  });

  test("missing VA % does not block Healthy when the clinic isn't eligible (<10 YTD orders)", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({
        ytdOrders: 4,
        vaYtdPct: undefined,
        ytdRevenue: 500,
        lifetimeDeductionRate: undefined,
      }),
      perf(),
    );
    expect(res).toEqual([FLAG.HEALTHY]);
  });

  test("missing lifetime deduction rate does not block Healthy for a LOW-revenue clinic", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ ytdRevenue: 100, lifetimeDeductionRate: undefined }),
      perf(),
    );
    expect(res).toEqual([FLAG.HEALTHY]);
  });
});

describe("evaluateFlags — fallback Nurture/Healthy", () => {
  test("Nurture within first 45 days when no alert fires", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({ firstOrder: "2026-08-20" }), // 32 days
      perf(),
    );
    expect(res).toEqual([FLAG.NURTURE]);
  });

  test("Healthy after 45 days when no alert fires", () => {
    const res = evaluateFlags(CUTOFF, op({ firstOrder: "2024-01-01" }), perf());
    expect(res).toEqual([FLAG.HEALTHY]);
  });

  test("multiple flags can coexist", () => {
    const res = evaluateFlags(
      CUTOFF,
      op({
        ytdOrders: 12,
        vaYtdPct: 0.7,
        ytdRevenue: 6000,
        lifetimeDeductionRate: 0.4,
      }),
      perf({ actual: 500, expected: 1000, orders: 5, expectedOrders: 10 }),
    );
    expect(res).toContain(FLAG.HIGH_VA);
    expect(res).toContain(FLAG.HIGH_MARGIN_BLEED);
    expect(res).toContain(FLAG.REVENUE_BLEED);
    expect(res).toContain(FLAG.ORDERS_BLEED);
  });
});

describe("Buying Overdue — native business-day rhythm", () => {
  // CUTOFF 2026-09-21 is a Monday.
  test("business days skip weekends", () => {
    expect(businessDaysBetween("2026-09-18", "2026-09-21")).toBe(1); // Fri->Mon
    expect(businessDaysBetween("2026-09-19", "2026-09-21")).toBe(1); // Sat->Mon
    expect(businessDaysBetween("2026-09-14", "2026-09-21")).toBe(5);
    expect(businessDaysBetween("2026-09-21", "2026-09-21")).toBe(0);
    expect(businessDaysBetween("2026-08-21", "2026-09-21")).toBe(20);
  });

  test("<3 distinct order dates -> ineligible, no flag", () => {
    expect(
      buyingRhythm(["2026-01-05", "2026-01-05", "2026-01-12"], CUTOFF),
    ).toBeUndefined();
    expect(isBuyingOverdue(undefined, undefined)).toBe(false);
  });

  test("future order dates beyond cutoff are ignored", () => {
    expect(
      buyingRhythm(["2026-09-07", "2026-09-14", "2026-09-28"], CUTOFF),
    ).toBeUndefined();
  });

  test("median of distinct-date gaps and bd since last order", () => {
    // gaps: Mon->Mon 5, Mon->Wed 2, Wed->next Wed 5 => median 5
    expect(
      buyingRhythm(
        ["2026-08-03", "2026-08-10", "2026-08-12", "2026-08-19"],
        CUTOFF,
      ),
    ).toEqual({ medianGapBd: 5, bdSinceLastOrder: 22 });
  });

  test("weekend orders: Fri->Sat gap is 0 business days", () => {
    const r = buyingRhythm(["2026-09-04", "2026-09-05", "2026-09-11"], CUTOFF);
    // gaps 0 and 4 (Labor Day 9/7 excluded) -> median 2
    expect(r).toEqual({ medianGapBd: 2, bdSinceLastOrder: 6 });
  });

  test("boundary: ratio exactly 3.0 fires, just under does not", () => {
    expect(isBuyingOverdue(5, 15)).toBe(true);
    expect(isBuyingOverdue(5, 14)).toBe(false);
  });

  test("median 1 is floored to 2", () => {
    expect(isBuyingOverdue(1, 3)).toBe(false); // 3/2 = 1.5, not 3/1
    expect(isBuyingOverdue(1, 6)).toBe(true);
    expect(isBuyingOverdue(0, 6)).toBe(true);
  });

  test("evaluateFlags adds Buying Overdue as a normal alert (no fallback)", () => {
    expect(
      evaluateFlags(
        CUTOFF,
        op({
          medianGapBd: 2,
          bdSinceLastOrder: 6,
          lastOrderAllTime: "2026-09-11",
        }),
        perf(),
      ),
    ).toEqual([FLAG.BUYING_OVERDUE]);
  });

  test("missing rhythm data does not block Healthy", () => {
    expect(evaluateFlags(CUTOFF, op(), perf())).toEqual([FLAG.HEALTHY]);
  });

  test("High Ticket Volume no longer exists", () => {
    expect(Object.values(FLAG)).not.toContain("⚠️ High Ticket Volume");
  });
});

import { federalHolidays, businessDaysBetween as bdb, isFederalHoliday } from "../convex/flags";
describe("federal holidays", () => {
  test("2026 list incl Columbus Oct 12 and Thanksgiving", () => {
    const h = federalHolidays(2026);
    expect(h.size).toBe(11);
    expect(isFederalHoliday("2026-10-12")).toBe(true);
    expect(h.has("2026-11-26")).toBe(true);
    expect(h.has("2026-07-03")).toBe(true); // Jul 4 Sat -> Fri
    expect(h.has("2026-01-19")).toBe(true);
    expect(h.has("2026-05-25")).toBe(true);
  });
  test("observed shifts", () => {
    expect(federalHolidays(2027).has("2027-12-31")).toBe(true); // 2028-01-01 Sat
    expect(federalHolidays(2027).has("2027-12-24")).toBe(true); // Dec 25 Sat
    expect(federalHolidays(2022).has("2022-12-26")).toBe(true); // Sun -> Mon
    expect(federalHolidays(2028).has("2028-01-01")).toBe(false);
  });
  test("holidays excluded from business days", () => {
    expect(bdb("2026-10-09", "2026-10-13")).toBe(1); // Fri -> Tue over Columbus
    expect(bdb("2026-11-25", "2026-11-27")).toBe(1); // Thanksgiving
    expect(bdb("2026-10-05", "2026-10-12")).toBe(4);
    expect(bdb("2026-03-02", "2026-03-09")).toBe(5);
  });
});
