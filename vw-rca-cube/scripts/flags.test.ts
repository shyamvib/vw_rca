import { describe, expect, test } from "bun:test";
import type { OperationalInputs, PerformanceInputs } from "../convex/flags";
import { approvedImportedFlags, evaluateFlags, FLAG } from "../convex/flags";

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

describe("evaluateFlags — approved Revenue Intelligence imports", () => {
  const noHistory = op({
    lastOrderAllTime: "",
    ytdOrders: 0,
    ytdRevenue: 0,
  });

  test("source-owned flags survive ancient/no-history guard", () => {
    expect(
      evaluateFlags(CUTOFF, noHistory, perf({ actual: 0, expected: 1000 }), [
        FLAG.BUYING_OVERDUE,
      ]),
    ).toEqual([FLAG.BUYING_OVERDUE]);
  });

  test("imported-only does not create Healthy or Nurture fallback", () => {
    expect(
      evaluateFlags(CUTOFF, op(), perf(), [FLAG.HIGH_TICKET_VOLUME]),
    ).toEqual([FLAG.HIGH_TICKET_VOLUME]);
  });

  test("multiple imported titles merge once, after RCA alerts and before fallback", () => {
    expect(
      evaluateFlags(
        CUTOFF,
        op({ ytdOrders: 0, lastOrderAllTime: "2026-07-20" }),
        perf(),
        [
          FLAG.BUYING_OVERDUE,
          FLAG.HIGH_TICKET_VOLUME,
          FLAG.BUYING_OVERDUE,
          FLAG.REVENUE_BLEED, // not an approved imported flag
        ],
      ),
    ).toEqual([FLAG.CHURNED, FLAG.BUYING_OVERDUE, FLAG.HIGH_TICKET_VOLUME]);
  });

  test("approvedImportedFlags filters every other Power BI Note title and de-dupes", () => {
    expect(
      approvedImportedFlags([
        FLAG.HIGH_TICKET_VOLUME,
        FLAG.REVENUE_BLEED,
        FLAG.BUYING_OVERDUE,
        FLAG.HIGH_TICKET_VOLUME,
        FLAG.HEALTHY,
      ]),
    ).toEqual([FLAG.HIGH_TICKET_VOLUME, FLAG.BUYING_OVERDUE]);
  });

  test("source flags remove the Healthy/Nurture fallback", () => {
    expect(
      evaluateFlags(CUTOFF, op({ firstOrder: "2026-09-01" }), perf(), [
        FLAG.BUYING_OVERDUE,
      ]),
    ).toEqual([FLAG.BUYING_OVERDUE]);
  });
});
