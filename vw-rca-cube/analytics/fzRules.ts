// Foundation Zoomer (FZ) score rules: bands, trend over every test, and why a patient is a cross-sell target.
//
// This is the reference implementation of the logic inside the `fz_scores` Cube model
// (cube/model-vibrant/cubes/fz_scores.yml). The SQL computes the same fields in BigQuery; this file exists so the
// rules can be unit tested (scripts/fzRules.test.ts), so scripts/fz-scores-check.ts can re-check every Cube row, and
// so the engine can reuse them in Phase 2. If you change a rule, change it in BOTH places. Rules: cube/FZ_SCORES.md.

export type Area = "Gut" | "Neural" | "Hormone" | "Nutrition" | "Immune" | "Cardio";

export type AreaConfig = {
  area: Area;
  testId: number;
  testCode: string;
  /** Product family (as in BigQuery order product_family) the low score is a reason to order. */
  product: string;
  /** Cheaper alternative product, when one exists. */
  altProduct: string | null;
  /** Potential revenue per patient: low = Baseline price where one exists, high = Zoomer price. */
  priceLow: number;
  priceHigh: number;
};

export const AREAS: AreaConfig[] = [
  { area: "Gut", testId: 10244, testCode: "GUT_HEALTH_FZ", product: "Gut Zoomer", altProduct: "Gut Baseline", priceLow: 460, priceHigh: 550 },
  { area: "Neural", testId: 10243, testCode: "NEURAL_HEALTH_FZ", product: "Neural Zoomer", altProduct: null, priceLow: 450, priceHigh: 450 },
  { area: "Hormone", testId: 10249, testCode: "HORMONE_HEALTH_SCORE_FZ", product: "Hormone Zoomer", altProduct: "Hormone Baseline", priceLow: 410, priceHigh: 500 },
  { area: "Nutrition", testId: 10229, testCode: "NUTRITION_HEALTH_FZ", product: "Nutrient Zoomer", altProduct: "Nutrient Baseline", priceLow: 450, priceHigh: 600 },
  { area: "Immune", testId: 10245, testCode: "IMMUNE_HEALTH_FZ", product: "Immune Zoomer", altProduct: null, priceLow: 400, priceHigh: 400 },
  { area: "Cardio", testId: 10239, testCode: "CARDIO_HEALTH_FZ", product: "Cardio Zoomer", altProduct: null, priceLow: 600, priceHigh: 600 },
];

// ---- Bands --------------------------------------------------------------------------------------------------
// Scores are decimals, so the cut-offs are "≤ 65" and "≤ 87" (a 65.4 is Moderate; there is no 65–66 gap).
export const NEEDS_SUPPORT_MAX = 65;
export const MODERATE_MAX = 87;
/** Moderate scores at or below this are "close to the at-risk zone". */
export const BORDERLINE_MAX = 75;
/** A change smaller than this many points (per test, or test to test) is noise. */
export const STABLE_POINTS = 3;

export type Band = "Needs support" | "Moderate" | "Optimal";
export const bandOf = (score: number): Band =>
  score <= NEEDS_SUPPORT_MAX ? "Needs support" : score <= MODERATE_MAX ? "Moderate" : "Optimal";
export const bandRank = (b: Band): number => (b === "Needs support" ? 0 : b === "Moderate" ? 1 : 2);

/** A raw LIS value counts only if, trimmed, it is a plain number in [0, 100] (negatives are LIS error codes). */
export function parseScore(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim();
  if (!/^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 100 ? v : null;
}

// ---- Trend over every test (as of test k) -------------------------------------------------------------------
export type Trend = "Single test" | "Worsening" | "Slipping" | "Improving" | "Changed, then returned" | "No real change";

export type History = {
  testSeq: number;
  prevScore: number | null;
  firstScore: number;
  bestPrior: number | null;
  zoneChanges: number;
  stepsUp: number;
  stepsDown: number;
  /** Least-squares slope of score against test number, over all tests so far (points per test). */
  slope: number | null;
  trend: Trend;
  notImproving: boolean;
};

/**
 * History fields for the LAST score in `scores` (the patient's tests in one area, oldest first).
 * Uses every test, not just first vs latest:
 *   Worsening  — ended in a worse band than the first test, or the overall slope is ≤ −3 points per test
 *   Slipping   — the latest test dropped ≥ 3 points from the one before
 *   Improving  — overall slope ≥ +3 points per test
 *   Changed, then returned — moved band at some point but is back in the band it started in
 *   No real change — none of the above
 */
export function historyOf(scores: number[]): History {
  const k = scores.length;
  if (k === 0) throw new Error("historyOf: no scores");
  const s = scores[k - 1];
  const first = scores[0];
  const ranks = scores.map((x) => bandRank(bandOf(x)));
  let zoneChanges = 0;
  let stepsUp = 0;
  let stepsDown = 0;
  for (let i = 1; i < k; i++) {
    if (ranks[i] !== ranks[i - 1]) zoneChanges++;
    if (ranks[i] > ranks[i - 1]) stepsUp++;
    if (ranks[i] < ranks[i - 1]) stepsDown++;
  }
  let slope: number | null = null;
  if (k >= 2) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    scores.forEach((y, i) => { const x = i + 1; sx += x; sy += y; sxy += x * y; sxx += x * x; });
    slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
  }
  const prev = k >= 2 ? scores[k - 2] : null;
  const bestPrior = k >= 2 ? Math.max(...scores.slice(0, -1)) : null;
  let trend: Trend;
  if (k === 1) trend = "Single test";
  else if (ranks[k - 1] < ranks[0] || (slope as number) <= -STABLE_POINTS) trend = "Worsening";
  else if (s - (prev as number) <= -STABLE_POINTS) trend = "Slipping";
  else if ((slope as number) >= STABLE_POINTS) trend = "Improving";
  else if (zoneChanges > 0 && ranks[k - 1] === ranks[0]) trend = "Changed, then returned";
  else trend = "No real change";
  return {
    testSeq: k, prevScore: prev, firstScore: first, bestPrior, zoneChanges, stepsUp, stepsDown, slope, trend,
    notImproving: k >= 2 && trend !== "Improving",
  };
}

// ---- Target reason ------------------------------------------------------------------------------------------
export type TargetReason =
  | "After product – not improved"
  | "Needs support"
  | "Repeat test – not improving"
  | "Borderline";

export type TargetInput = {
  score: number;
  history: Pick<History, "notImproving">;
  /** Patient ordered the area's product on or before this FZ order date (same order counts). */
  hadProductBefore: boolean;
  /** Patient ordered the area's product after this FZ order date (already converted). */
  orderedProductAfter: boolean;
  /** Other promotable areas on the same sample scoring ≤ 65. */
  coLowAreas: number;
};

/** First matching rule wins; null = not a target. */
export function targetReason(t: TargetInput): TargetReason | null {
  const band = bandOf(t.score);
  if (band === "Optimal") return null;
  if (t.hadProductBefore)
    return band === "Needs support" || t.history.notImproving ? "After product – not improved" : null;
  if (t.orderedProductAfter) return null;
  if (band === "Needs support") return "Needs support";
  if (t.history.notImproving) return "Repeat test – not improving"; // 2+ tests, no real gain (incl. any drop)
  if (t.score <= BORDERLINE_MAX && t.coLowAreas >= 2) return "Borderline";
  return null;
}
