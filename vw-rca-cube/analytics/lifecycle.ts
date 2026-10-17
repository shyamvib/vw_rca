/**
 * Lifecycle stages, shared by every tree that has a cohort branch (company bridge, team-lead / rep scoped
 * totals, rep view). Shyam, 2026-10-16.
 *
 * The per-clinic cohorts stay as they are in the data (new, retained_top20, retained_rest, churned,
 * reactivated); "Active" is how they are *shown*: retained_top20 + retained_rest are one lifecycle stage cut by
 * size, so the trees group them and keep the 20% / 80% split as a tier inside.
 *
 * Reconciliation: a cohort's expected value is built from baselines that are not the headline's (the headline
 * is the exact rolling P75 of the period's own revenue; a cohort sums clinic- or rate-level baselines, and a
 * percentile does not distribute over a sum). Left alone, the cohort rows add up to a different total than the
 * headline delta. `calibrate` scales every cohort's expected by one factor so that the rows sum to the headline
 * exactly, and returns that factor so the UI can say so.
 */
export const ACTIVE_COHORTS = ["retained_top20", "retained_rest"] as const;

export type CohortAgg = { cohort: string; actual: number; expected: number; clinics: number };
export type CohortCal = CohortAgg & { delta: number };

export function calibrate(rows: CohortAgg[], headlineExpected: number | null | undefined): { rows: CohortCal[]; factor: number } {
  const raw = rows.reduce((t, r) => t + r.expected, 0);
  const factor = headlineExpected && raw > 0 ? headlineExpected / raw : 1;
  return { rows: rows.map(r => ({ ...r, delta: r.actual - r.expected * factor })), factor };
}
