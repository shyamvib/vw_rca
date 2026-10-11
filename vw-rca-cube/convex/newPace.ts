import type { ClinicRow } from "./clinics";
import { diffDays } from "./dateUtils";

/** New-clinic on-pace / overdue split (Shyam, 2026-09-29), shared by the
 * shortfall tree (repView) and Great Job (wins) so both pages agree.
 * Pace threshold = median days between a new clinic's own orders in the
 * set (fallback 14d); a new clinic is "on pace" when days since its last
 * order (as of cutoff) is within that threshold, otherwise "overdue". */
export function newClinicPace(newRows: ClinicRow[], cutoff: string) {
  const gaps: number[] = [];
  for (const r of newRows) {
    if (r.orders >= 2 && r.firstOrder && r.lastOrderAllTime) {
      const span = diffDays(r.firstOrder, r.lastOrderAllTime);
      if (span > 0) gaps.push(span / (r.orders - 1));
    }
  }
  const s = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const threshold = s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : 14;
  const since = (d?: string) => (d ? Math.max(0, diffDays(d, cutoff)) : null);
  const onPace = new Set<string>();
  for (const r of newRows) {
    const d = since(r.lastOrderAllTime) ?? since(r.firstOrder) ?? 0;
    if (d <= threshold) onPace.add(r.clinic);
  }
  return { threshold, onPace };
}
