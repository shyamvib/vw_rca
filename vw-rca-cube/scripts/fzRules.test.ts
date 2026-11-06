import { describe, expect, test } from "bun:test";
import { bandOf, historyOf, parseScore, targetReason, type TargetInput } from "../analytics/fzRules";

describe("parseScore", () => {
  test("plain numbers in 0–100, trimmed", () => {
    expect(parseScore(" 65.4 ")).toBe(65.4);
    expect(parseScore("0")).toBe(0);
    expect(parseScore("100")).toBe(100);
    expect(parseScore(".5")).toBe(0.5);
  });
  test("LIS error codes, text, blanks, exponents are invalid", () => {
    for (const raw of ["-100", "-222", "999999", "100.01", "", "  ", "N/A", "6e1", "65%", null, undefined])
      expect(parseScore(raw)).toBeNull();
  });
});

describe("bandOf — decimal boundaries", () => {
  test("≤65 needs support, ≤87 moderate, >87 optimal", () => {
    expect(bandOf(65)).toBe("Needs support");
    expect(bandOf(65.01)).toBe("Moderate");
    expect(bandOf(87)).toBe("Moderate");
    expect(bandOf(87.01)).toBe("Optimal");
  });
});

describe("historyOf — uses every test, not first vs latest", () => {
  test("single test", () => {
    const h = historyOf([60]);
    expect(h.trend).toBe("Single test");
    expect(h.notImproving).toBe(false);
    expect(h.slope).toBeNull();
  });
  test("70 → 60 → 72: dipped into needs-support and came back", () => {
    const h = historyOf([70, 60, 72]);
    expect(h.zoneChanges).toBe(2);
    expect(h.trend).toBe("Changed, then returned");
    expect(h.notImproving).toBe(true);
  });
  test("80 → 78 → 76: slow decline inside Moderate is not improvement", () => {
    const h = historyOf([80, 78, 76]);
    expect(h.slope).toBeCloseTo(-2, 6);
    expect(h.trend).toBe("No real change");
    expect(h.notImproving).toBe(true);
  });
  test("55 → 62 → 68: steady improvement", () => {
    const h = historyOf([55, 62, 68]);
    expect(h.slope).toBeCloseTo(6.5, 6);
    expect(h.trend).toBe("Improving");
    expect(h.notImproving).toBe(false);
  });
  test("first-vs-latest would say improved, but the latest test dropped: 60 → 85 → 70", () => {
    const h = historyOf([60, 85, 70]);
    expect(h.trend).toBe("Slipping");
    expect(h.bestPrior).toBe(85);
    expect(h.notImproving).toBe(true);
  });
  test("ended in a worse band than it started: 70 → 64", () => {
    expect(historyOf([70, 64]).trend).toBe("Worsening");
  });
  test("steep overall fall inside one band: 86 → 80 → 75", () => {
    expect(historyOf([86, 80, 75]).trend).toBe("Worsening");
  });
  test("tiny wobble is no change: 72 → 73", () => {
    expect(historyOf([72, 73]).trend).toBe("No real change");
  });
});

const t = (o: Partial<TargetInput> & { score: number; scores?: number[] }): TargetInput => ({
  history: historyOf(o.scores ?? [o.score]),
  hadProductBefore: false,
  orderedProductAfter: false,
  coLowAreas: 0,
  ...o,
});

describe("targetReason", () => {
  test("optimal is never a target, even after the product", () => {
    expect(targetReason(t({ score: 90 }))).toBeNull();
    expect(targetReason(t({ score: 90, scores: [95, 90], hadProductBefore: true }))).toBeNull();
  });
  test("needs support with no product → Needs support", () => {
    expect(targetReason(t({ score: 50 }))).toBe("Needs support");
  });
  test("had the product, still needs support → After product", () => {
    expect(targetReason(t({ score: 50, hadProductBefore: true }))).toBe("After product – not improved");
  });
  test("had the product, moderate and not improving across tests → After product", () => {
    expect(targetReason(t({ score: 76, scores: [80, 78, 76], hadProductBefore: true }))).toBe(
      "After product – not improved",
    );
  });
  test("had the product, moderate and improving → not a target", () => {
    expect(targetReason(t({ score: 75, scores: [60, 68, 75], hadProductBefore: true }))).toBeNull();
  });
  test("had the product, single moderate test → not a target", () => {
    expect(targetReason(t({ score: 70, hadProductBefore: true }))).toBeNull();
  });
  test("Zoomer ordered the same day as the FZ (same order) → already ordering, not a target", () => {
    expect(targetReason(t({ score: 50, orderedWithFz: true }))).toBeNull();
    expect(targetReason(t({ score: 50, orderedWithFz: true, hadProductBefore: true }))).toBeNull();
    expect(targetReason(t({ score: 76, scores: [80, 78, 76], orderedWithFz: true }))).toBeNull();
  });
  test("Zoomer on an earlier order, FZ still low → After product", () => {
    expect(targetReason(t({ score: 50, hadProductBefore: true, orderedWithFz: false }))).toBe("After product – not improved");
  });
  test("already ordered the product after this FZ → converted, not a target", () => {
    expect(targetReason(t({ score: 50, orderedProductAfter: true }))).toBeNull();
  });
  test("moderate repeat test without improvement → Repeat test", () => {
    expect(targetReason(t({ score: 84, scores: [85, 84] }))).toBe("Repeat test – not improving");
  });
  test("moderate ≤75 with 2+ other low areas → Borderline", () => {
    expect(targetReason(t({ score: 75, coLowAreas: 2 }))).toBe("Borderline");
    expect(targetReason(t({ score: 75.5, coLowAreas: 3 }))).toBeNull();
    expect(targetReason(t({ score: 70, coLowAreas: 1 }))).toBeNull();
  });
});
