/** Pure date helpers. All dates are "YYYY-MM-DD" strings, treated as UTC. */

export function toMs(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fromMs(toMs(d) + n * 86400000);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / 86400000);
}

/** true when the date is Mon-Fri */
export function isWeekday(d: string): boolean {
  const dow = new Date(toMs(d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** 0 = Sunday … 6 = Saturday */
export function dow(d: string): number {
  return new Date(toMs(d)).getUTCDay();
}

export function dayType(d: string): "wk" | "we" {
  return isWeekday(d) ? "wk" : "we";
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = toMs(start); t <= toMs(end); t += 86400000) out.push(fromMs(t));
  return out;
}

/** Monday of the week containing d */
export function weekStart(d: string): string {
  const dow = new Date(toMs(d)).getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(d, -back);
}

export function monthKey(d: string): string {
  return d.slice(0, 7);
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** Calendar quarter key, e.g. "2026-Q3" (Shyam: calendar quarters, not fiscal). */
export function quarterKey(d: string): string {
  const [y, m] = d.slice(0, 7).split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

/** Previous calendar month key, e.g. "2026-09" -> "2026-08", "2026-01" -> "2025-12". */
export function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Previous calendar quarter key, e.g. "2026-Q3" -> "2026-Q2", "2026-Q1" -> "2025-Q4". */
export function prevQuarterKey(key: string): string {
  const [y, q] = key.split("-Q").map((s, i) => (i === 0 ? Number(s) : Number(s)));
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

export function quarterLabel(key: string): string {
  const [y, q] = key.split("-");
  return `${q} ${y}`;
}

export function shortDayLabel(d: string): string {
  const [, m, day] = d.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${Number(day)}`;
}

/** US federal-style holidays that materially affect lab ordering volume. */
export function holidayName(d: string): string | null {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(toMs(d));
  const dow = dt.getUTCDay();
  const nth = Math.floor((day - 1) / 7) + 1;
  if (m === 1 && day === 1) return "New Year";
  if (m === 1 && dow === 1 && nth === 3) return "MLK Day";
  if (m === 2 && dow === 1 && nth === 3) return "Presidents Day";
  if (m === 5 && dow === 1 && day > 24) return "Memorial Day";
  if (m === 6 && day === 19) return "Juneteenth";
  if (m === 7 && day === 4) return "July 4";
  if (m === 9 && dow === 1 && nth === 1) return "Labor Day";
  if (m === 11 && dow === 4 && nth === 4) return "Thanksgiving";
  if (m === 11 && dow === 5 && nth === 4) return "Thanksgiving";
  if (m === 12 && (day === 24 || day === 25)) return "Christmas";
  if (m === 12 && day === 31) return "New Year Eve";
  void y;
  return null;
}

export type BaselineMode =
  | "prior_equal"
  | "prior_3m"
  | "trailing_13w"
  | "yoy"
  | "p75";

export const BASELINE_LABEL: Record<BaselineMode, string> = {
  prior_equal: "Prior equal-length period (day-type run rate)",
  prior_3m: "Prior 3 months (day-type run rate)",
  trailing_13w: "Trailing 13 weeks, same weekday",
  yoy: "Same period last year, same weekday",
  p75: "Strong-period benchmark (day: 13-wk same weekday · week: 13 wks · month: YTD months)",
};

/** Which bucket the rates are averaged over for each mode. */
export function bucketing(mode: BaselineMode): "daytype" | "dow" {
  return mode === "trailing_13w" || mode === "yoy" || mode === "p75"
    ? "dow"
    : "daytype";
}

/** Baseline window implied by a mode and the current window. */
export function baselineWindow(
  mode: BaselineMode,
  currentStart: string,
  currentEnd: string,
): { start: string; end: string } {
  const len = diffDays(currentStart, currentEnd) + 1;
  if (mode === "yoy") {
    return {
      start: addDays(currentStart, -364),
      end: addDays(currentEnd, -364),
    };
  }
  const end = addDays(currentStart, -1);
  if (mode === "trailing_13w" || mode === "p75") {
    return { start: addDays(end, -90), end };
  }
  if (mode === "prior_3m") {
    const y = Number(currentStart.slice(0, 4));
    const m = Number(currentStart.slice(5, 7));
    const back = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);
    return { start: back, end };
  }
  return { start: addDays(end, -(len - 1)), end };
}

/** Per-weekday rates from per-weekday totals, bucketed by mode. */
export function ratesFrom(
  totals: number[],
  dayCounts: number[],
  bucket: "daytype" | "dow",
): number[] {
  if (bucket === "dow") {
    return totals.map((t, i) => (dayCounts[i] ? t / dayCounts[i] : 0));
  }
  let wkT = 0;
  let wkD = 0;
  let weT = 0;
  let weD = 0;
  for (let i = 0; i < 7; i++) {
    if (i === 0 || i === 6) {
      weT += totals[i];
      weD += dayCounts[i];
    } else {
      wkT += totals[i];
      wkD += dayCounts[i];
    }
  }
  const wk = wkD ? wkT / wkD : 0;
  const we = weD ? weT / weD : 0;
  return [we, wk, wk, wk, wk, wk, we];
}

export function dayCountsOf(days: string[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) c[dow(d)] += 1;
  return c;
}

/** First day of the calendar month `back` months before d's month. */
export function monthsBackStart(d: string, back: number): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10);
}

/** Last day of the calendar month containing d. */
export function monthEnd(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** ISO weekday: Monday = 1 … Sunday = 7 (matches Power BI's WEEKDAY(d, 2)). */
export function isoDow(d: string): number {
  const w = dow(d);
  return w === 0 ? 7 : w;
}

/** NETWORKDAYS(start, end, 1): inclusive count of Mon-Fri days (no holiday calendar). */
export function networkDays(start: string, end: string): number {
  let n = 0;
  for (let t = toMs(start); t <= toMs(end); t += 86400000) {
    const w = new Date(t).getUTCDay();
    if (w >= 1 && w <= 5) n += 1;
  }
  return n;
}

/**
 * Power BI-equivalent rolling baselines (mirrors Thiru's "Today's / WTD / MTD
 * Revenue Baseline" DAX measures exactly, so RCA and Revenue Intelligence
 * agree week-over-week instead of RCA reusing one fixed reference window).
 * `valueOn` supplies either daily revenue or daily order count — same formula
 * for both, per Thiru's instruction.
 */

/** "Today's Revenue/Orders Baseline": P75 of the same weekday over the trailing 13 weeks. */
export function trailingDayP75(
  valueOn: (d: string) => number,
  asOf: string,
  weeks = 13,
): number {
  const vals: number[] = [];
  for (let k = 1; k <= weeks; k++) vals.push(valueOn(addDays(asOf, -7 * k)));
  return p75Of(vals);
}

/**
 * Day baseline anchored before a multi-day window (quarter/custom): P75 of the
 * 13 same-weekday dates immediately BEFORE windowStart, so no day in the
 * window is compared against the window's own data. [Shyam, 2026-09-30]
 */
export function anchoredDayP75(
  valueOn: (d: string) => number,
  d: string,
  windowStart: string,
  weeks = 13,
): number {
  const j = Math.ceil((diffDays(windowStart, d) + 1) / 7);
  const lastBefore = addDays(d, -7 * Math.max(1, j));
  return trailingDayP75(valueOn, addDays(lastBefore, 7), weeks);
}

/**
 * "WTD Revenue/Orders Baseline": P75 of the trailing 13 weeks' sums from each
 * week's Monday through the matching weekday (isoDow 1=Mon…7=Sun). A full
 * Mon-Sun period (isoDow=7) collapses this to the trailing 13 full-week sums.
 */
export function trailingWeekP75(
  valueOn: (d: string) => number,
  weekMonday: string,
  isoDayOfWeek: number,
  weeks = 13,
): number {
  const vals: number[] = [];
  for (let k = 1; k <= weeks; k++) {
    const histStart = addDays(weekMonday, -7 * k);
    const histEnd = addDays(histStart, isoDayOfWeek - 1);
    let sum = 0;
    for (const d of eachDay(histStart, histEnd)) sum += valueOn(d);
    vals.push(sum);
  }
  return p75Of(vals);
}

/**
 * "MTD Revenue/Orders Baseline": P75 of the trailing 3 months' sums, each
 * restricted to the same count of elapsed working days as the current month
 * so a mid-month read compares to the matching pace, not the full month.
 */
export function trailingMonthP75(
  valueOn: (d: string) => number,
  monthStart: string,
  asOf: string,
  months = 3,
): number {
  const elapsed = networkDays(monthStart, asOf);
  const vals: number[] = [];
  for (let k = 1; k <= months; k++) {
    const hStart = monthsBackStart(monthStart, k);
    const hEnd = monthEnd(hStart);
    let sum = 0;
    for (const d of eachDay(hStart, hEnd)) {
      if (networkDays(hStart, d) <= elapsed) sum += valueOn(d);
    }
    vals.push(sum);
  }
  return p75Of(vals);
}

/**
 * The full set of selectable periods (all/quarter/month/week/day) for a
 * current window — the same "all" / `q:YYYY-Qn` / `m:YYYY-MM` /
 * `w:YYYY-MM-DD` / `d:YYYY-MM-DD` id scheme `bridge.ts` and `refresh.ts`'s
 * `clinicPeriod` rows already use. Shared here so refresh-time baseline
 * precomputation (per clinic/team-lead/RSM) enumerates the exact same
 * periods the live dashboard queries by id.
 */
export function periodDefs(
  currentStart: string,
  currentEnd: string,
): Array<{ id: string; kind: "all" | "quarter" | "month" | "week" | "day"; days: string[] }> {
  const currentDays = eachDay(currentStart, currentEnd);
  const out: Array<{
    id: string;
    kind: "all" | "quarter" | "month" | "week" | "day";
    days: string[];
  }> = [{ id: "all", kind: "all", days: currentDays }];
  const quarters = new Map<string, string[]>();
  const months = new Map<string, string[]>();
  const weeks = new Map<string, string[]>();
  for (const d of currentDays) {
    const qk = quarterKey(d);
    const mk = monthKey(d);
    const ws = weekStart(d);
    quarters.set(qk, [...(quarters.get(qk) ?? []), d]);
    months.set(mk, [...(months.get(mk) ?? []), d]);
    weeks.set(ws, [...(weeks.get(ws) ?? []), d]);
  }
  for (const [qk, days] of [...quarters].sort()) out.push({ id: `q:${qk}`, kind: "quarter", days });
  for (const [mk, days] of [...months].sort()) out.push({ id: `m:${mk}`, kind: "month", days });
  for (const [ws, days] of [...weeks].sort()) out.push({ id: `w:${ws}`, kind: "week", days });
  for (const d of currentDays) out.push({ id: `d:${d}`, kind: "day", days: [d] });
  return out;
}

/**
 * One rolling-P75 baseline value (revenue or orders — same formula for
 * both), re-anchored to the period's own end date. Mirrors `bridge.ts`'s
 * `rollingExpected()` but generic over `valueOn`, so refresh-time code can
 * run it per clinic / per team lead / per RSM against that scope's own
 * daily series instead of only the company-wide one.
 */
type BaselinePlan = { terms: string[][][]; order: number[] };
const planCache = new Map<string, BaselinePlan>();

/**
 * The dates a rolling baseline reads depend only on (kind, window), never on
 * the clinic — so build that date plan once and reuse it for all ~7k clinics.
 * Each term is a P75 over groups of dates (each group summed); `order` replays
 * the exact accumulation sequence of the original formula, so results are
 * bit-identical to the per-call version. [refresh speed, 2026-09-30]
 */
export function baselinePlan(
  kind: "all" | "quarter" | "month" | "week" | "day",
  days: string[],
): BaselinePlan {
  const asOf = days[days.length - 1];
  const key = `${kind}|${days[0]}|${asOf}|${days.length}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const dayGroups = (asOfDay: string) => {
    const g: string[][] = [];
    for (let k = 1; k <= 13; k++) g.push([addDays(asOfDay, -7 * k)]);
    return g;
  };
  let plan: BaselinePlan;
  if (kind === "day") plan = { terms: [dayGroups(asOf)], order: [0] };
  else if (kind === "week") {
    const wm = weekStart(asOf);
    const dw = isoDow(asOf);
    const g: string[][] = [];
    for (let k = 1; k <= 13; k++) {
      const hs = addDays(wm, -7 * k);
      g.push(eachDay(hs, addDays(hs, dw - 1)));
    }
    plan = { terms: [g], order: [0] };
  } else if (kind === "month") {
    const ms = `${monthKey(asOf)}-01`;
    const elapsed = networkDays(ms, asOf);
    const g: string[][] = [];
    for (let k = 1; k <= 3; k++) {
      const hs = monthsBackStart(ms, k);
      g.push(eachDay(hs, monthEnd(hs)).filter(d => networkDays(hs, d) <= elapsed));
    }
    plan = { terms: [g], order: [0] };
  } else {
    const terms: string[][][] = [];
    const idx = new Map<string, number>();
    const order: number[] = [];
    for (const d of days) {
      const j = Math.ceil((diffDays(days[0], d) + 1) / 7);
      const lastBefore = addDays(d, -7 * Math.max(1, j));
      let i = idx.get(lastBefore);
      if (i === undefined) {
        i = terms.length;
        terms.push(dayGroups(addDays(lastBefore, 7)));
        idx.set(lastBefore, i);
      }
      order.push(i);
    }
    plan = { terms, order };
  }
  if (planCache.size > 2000) planCache.clear();
  planCache.set(key, plan);
  return plan;
}

/**
 * One rolling-P75 baseline value (revenue or orders — same formula for
 * both), re-anchored to the period's own end date. Mirrors `bridge.ts`'s
 * `rollingExpected()`. day = P75 of 13 same weekdays; week = P75 of 13
 * trailing WTD sums; month = P75 of 3 prior months at matching working-day
 * pace; quarter/all = sum over days of the P75 of the 13 same weekdays
 * before the window start.
 */
export function rollingBaseline(
  kind: "all" | "quarter" | "month" | "week" | "day",
  days: string[],
  valueOn: (d: string) => number,
  plan?: ReturnType<typeof baselinePlan>,
  opts?: { sparseFallback?: boolean },
): number {
  const { terms, order } = plan ?? baselinePlan(kind, days);
  const vals = terms.map(groups => {
    const sums = groups.map(g => {
      let sum = 0;
      for (const d of g) sum += valueOn(d);
      return sum;
    });
    const p = p75Of(sums);
    // A clinic that orders in fewer than 4 of the 13 trailing weeks has a P75 of 0 however much it
    // bought (Shyam, 2026-10-16), which made its whole revenue read as gain and kept it out of "existing".
    // For clinics only (never the company / lead / rep aggregates, which stay on Thiru's exact P75),
    // fall back to the clinic's own average over the same periods when it did order.
    if (opts?.sparseFallback && p === 0) {
      const total = sums.reduce((t, x) => t + x, 0);
      return sums.length && total > 0 ? total / sums.length : 0;
    }
    return p;
  });
  if (kind === "day" || kind === "week" || kind === "month") return vals[0];
  let sum = 0;
  for (const i of order) sum += vals[i];
  return sum;
}

/** PERCENTILE.INC-style 75th percentile (linear interpolation). */
export function p75Of(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  if (v.length === 1) return v[0];
  const idx = (v.length - 1) * 0.75;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/**
 * Multipliers that turn the mean trailing-13-week per-weekday run rate into a
 * P75 expectation, one per granularity:
 *   day   — P75 of the 13 same-weekday observations
 *   week  — P75 of the 13 trailing full-week totals
 *   month — P75 of the full calendar months of the current year before the
 *           window starts (year-to-date months; falls back to the 3 prior
 *           full months when the window starts in January)
 * Weeks and months are compared on a shape-adjusted basis (actual / mean-rate
 * expectation) so partial periods and month length never distort the factor.
 */
export type P75Factors = { day: number[]; week: number; month: number };

export function computeP75Factors(
  ordersOn: (d: string) => number | undefined,
  currentStart: string,
): P75Factors {
  const end = addDays(currentStart, -1);
  const days = eachDay(addDays(end, -90), end);
  const byDow: number[][] = [[], [], [], [], [], [], []];
  for (const d of days) {
    const o = ordersOn(d);
    if (o === undefined) continue;
    byDow[dow(d)].push(o);
  }
  const mean = byDow.map(v =>
    v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0,
  );
  const day = byDow.map((v, i) => (mean[i] ? p75Of(v) / mean[i] : 1));
  const complete = (ds: string[]): boolean =>
    ds.every(d => ordersOn(d) !== undefined);
  const shape = (ds: string[]): number =>
    ds.reduce((s, d) => s + mean[dow(d)], 0);
  const actual = (ds: string[]): number =>
    ds.reduce((s, d) => s + (ordersOn(d) ?? 0), 0);

  // 13 trailing full weeks (Mon-Sun) that finished before the window starts.
  const weekRatios: number[] = [];
  let ws = weekStart(end);
  if (addDays(ws, 6) > end) ws = addDays(ws, -7);
  for (let i = 0; i < 13; i++) {
    const ds = eachDay(ws, addDays(ws, 6));
    const w = shape(ds);
    // Only weeks with data for all seven days; a partially loaded week would
    // read as a collapse and drag the percentile down.
    if (w > 0 && complete(ds)) weekRatios.push(actual(ds) / w);
    ws = addDays(ws, -7);
  }

  // Year-to-date full calendar months: every complete month of the current
  // year that finished before the window starts. A window starting in January
  // has none, so fall back to the 3 prior full months.
  const monthRatios: number[] = [];
  const pushMonth = (ms: string) => {
    const ds = eachDay(ms, monthEnd(ms));
    const w = shape(ds);
    if (w > 0 && complete(ds)) monthRatios.push(actual(ds) / w);
  };
  const startMonth = Number(currentStart.slice(5, 7));
  for (let i = 1; i < startMonth; i++) pushMonth(`${currentStart.slice(0, 4)}-${String(i).padStart(2, "0")}-01`);
  if (monthRatios.length === 0) {
    for (let i = 1; i <= 3; i++) pushMonth(monthsBackStart(currentStart, i));
  }

  return {
    day,
    week: weekRatios.length ? p75Of(weekRatios) : 1,
    month: monthRatios.length ? p75Of(monthRatios) : 1,
  };
}

/** Expected-value multiplier for one day inside a period of the given kind. */
export function p75Scale(
  f: P75Factors | null | undefined,
  kind: "all" | "quarter" | "month" | "week" | "day",
  d: string,
): number {
  if (!f) return 1;
  if (kind === "day") return f.day[dow(d)] ?? 1;
  if (kind === "week") return f.week;
  return f.month;
}

/** Window-level (month-granularity) P75 multiplier implied by the config row. */
export function windowP75(cfg: {
  baselineMode?: string;
  p75?: { day: number[]; week: number; month: number } | null;
}): number {
  return cfg?.baselineMode === "p75" ? (cfg.p75?.month ?? 1) : 1;
}

/**
 * Prior-year counterpart of a date, aligned by "nth <weekday> of <month>".
 *
 * A plain 364-day shift keeps the weekday but slips across month boundaries,
 * which throws floating holidays a week out (Labor Day 2025 would land on
 * Aug 31 2026 instead of Sep 7). Matching the occurrence index inside the
 * month keeps Labor Day on Labor Day and Thanksgiving on Thanksgiving.
 */
export function priorYearSameWeekday(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const occurrence = Math.ceil(day / 7);
  const wd = dow(date);
  const first = `${y - 1}-${String(m).padStart(2, "0")}-01`;
  const firstDow = dow(first);
  const offset = (wd - firstDow + 7) % 7;
  const target = 1 + offset + (occurrence - 1) * 7;
  const daysInMonth = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  const dayNum = target > daysInMonth ? target - 7 : target;
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}

/** Holidays pinned to a calendar date rather than a weekday. */
export const FIXED_DATE_HOLIDAYS = ["01-01", "07-04", "11-11", "12-24", "12-25", "12-31"];

/** First day of a quarter key, e.g. "2026-Q3" -> "2026-07-01". */
export function quarterStart(key: string): string {
  const [y, q] = key.split("-Q").map(Number);
  return `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
}
