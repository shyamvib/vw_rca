// Validates the `fz_scores` Cube model against the reference rules in analytics/fzRules.ts.
//
//   cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-scores-check.ts
//
// Needs CUBE_API_URL + CUBE_API_SECRET (the git-ignored .env.engine.local from thiru-local-engine.sh has both).
// Read-only: one /meta call and a few /load calls. Prints aggregate numbers only (no patient ids). Exit 1 on failure.
import { baseUrl, load, token } from "../analytics/cube";
import { AREAS, bandOf, historyOf, NEEDS_SUPPORT_MAX, targetReason } from "../analytics/fzRules";

const C = "fz_scores";
const m = (x: string) => `${C}.${x}`;
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
};

async function api(path: string, body?: unknown, tries = 0): Promise<any> {
  const res = await fetch(`${baseUrl()}/cubejs-api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: await token() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.error !== "Continue wait") {
    if (j.error) throw new Error(`Cube ${path}: ${String(j.error).slice(0, 300)}`);
    return j;
  }
  if (tries > 240) throw new Error("Cube still building (Continue wait) after 2 min");
  await new Promise((r) => setTimeout(r, 500));
  return api(path, body, tries + 1);
}

// 1. Model is deployed and carries no patient-identifying members beyond patient_id.
const meta = await api("meta");
const cube = (meta.cubes ?? []).find((c: { name: string }) => c.name === C);
check(!!cube, "fz_scores cube is deployed");
if (!cube) process.exit(1);
const members: string[] = [...cube.dimensions, ...cube.measures].map((x: { name: string }) => x.name);
const pii = members.filter((n) => /name|birth|dob|(^|[._])age($|_)|gender|sex|email|phone|address/i.test(n));
check(pii.length === 0, `no patient name/DOB/age/gender members (found: ${pii.join(", ") || "none"})`);

// 2. Pull every row (served by the fz_rows rollup).
const DIMS = ["sample_id", "area", "patient_id", "clinic_id", "score", "band", "test_seq", "prev_score", "trend",
  "not_improving", "had_product_before", "ordered_product_after", "co_low_areas", "target_reason", "is_target",
  "targets_on_sample", "is_top20_ytd"];
const rowQuery = {
  dimensions: DIMS.map(m),
  measures: [m("samples")],
  timeDimensions: [{ dimension: m("order_date"), granularity: "day" as const }],
};
const used = await api("load", { query: { ...rowQuery, limit: 1, timezone: "UTC" } });
const pre = Object.keys(used.usedPreAggregations ?? {});
check(pre.some((k) => k.includes("fz_rows")), `row pull served by fz_rows rollup (${pre.join(", ") || "none: hit BigQuery"})`);

type R = {
  sample: string; area: string; patient: string; clinic: number; day: string; score: number; band: string;
  seq: number; prev: number | null; trend: string; notImproving: boolean; hadBefore: boolean; after: boolean;
  coLow: number; reason: string | null; isTarget: boolean; targetsOnSample: number; top20: boolean; n: number;
};
const bool = (v: unknown) => v === true || v === "true";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const raw = await load(rowQuery);
const rows: R[] = raw.map((r) => ({
  sample: String(r[m("sample_id")]), area: String(r[m("area")]), patient: String(r[m("patient_id")]),
  clinic: Number(r[m("clinic_id")]), day: String(r[m("order_date.day")]).slice(0, 10),
  score: Number(r[m("score")]), band: String(r[m("band")]), seq: Number(r[m("test_seq")]),
  prev: num(r[m("prev_score")]), trend: String(r[m("trend")]), notImproving: bool(r[m("not_improving")]),
  hadBefore: bool(r[m("had_product_before")]), after: bool(r[m("ordered_product_after")]),
  coLow: Number(r[m("co_low_areas")]), reason: (r[m("target_reason")] as string | null) ?? null,
  isTarget: bool(r[m("is_target")]), targetsOnSample: Number(r[m("targets_on_sample")]),
  top20: bool(r[m("is_top20_ytd")]), n: Number(r[m("samples")]),
}));
console.log(`      ${rows.length} rows, ${new Set(rows.map((r) => r.sample)).size} samples, ` +
  `${new Set(rows.map((r) => r.patient)).size} patients, ${new Set(rows.map((r) => r.clinic)).size} clinics`);

// 3. Grain and simple invariants.
const keys = new Set(rows.map((r) => `${r.sample}|${r.area}`));
check(keys.size === rows.length && rows.every((r) => r.n === 1), "one row per (sample_id, area)");
check(rows.every((r) => AREAS.some((a) => a.area === r.area)), "only the 6 promotable areas");
check(rows.every((r) => r.score >= 0 && r.score <= 100), "scores within 0–100");
const sampleClinics = new Map<string, Set<string>>();
for (const r of rows) (sampleClinics.get(r.sample) ?? sampleClinics.set(r.sample, new Set()).get(r.sample)!).add(`${r.patient}|${r.clinic}|${r.day}`);
check([...sampleClinics.values()].every((s) => s.size === 1), "each sample maps to exactly one order (patient, clinic, date)");
check(rows.every((r) => r.band === bandOf(r.score)), "band matches score cut-offs (≤65 / ≤87 / >87)");
check(rows.every((r) => !(r.isTarget && r.band === "Optimal")), "no Optimal row is a target");
check(rows.every((r) => r.isTarget === (r.reason !== null)), "is_target ⇔ target_reason set");

// 4. Recompute every row's history, co-low count and reason in TypeScript; compare with the SQL.
const bySample = new Map<string, R[]>();
for (const r of rows) (bySample.get(r.sample) ?? bySample.set(r.sample, []).get(r.sample)!).push(r);
const byPatientArea = new Map<string, R[]>();
for (const r of rows) (byPatientArea.get(`${r.patient}|${r.area}`) ?? byPatientArea.set(`${r.patient}|${r.area}`, []).get(`${r.patient}|${r.area}`)!).push(r);
const mismatch: Record<string, number> = {};
const examples: string[] = [];
const miss = (k: string, detail: string) => {
  mismatch[k] = (mismatch[k] ?? 0) + 1;
  if (examples.length < 8) examples.push(`${k}: ${detail}`);
};
for (const seq of byPatientArea.values()) {
  // Same order as the SQL window: order date, then sample_id as a string. (Cube gives day only; same-day
  // repeats are ordered by sample_id in both.)
  seq.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.sample < b.sample ? -1 : a.sample > b.sample ? 1 : 0));
  seq.forEach((r, i) => {
    const h = historyOf(seq.slice(0, i + 1).map((x) => x.score));
    if (r.seq !== h.testSeq) miss("test_seq", `${r.area} seq ${r.seq} vs ${h.testSeq}`);
    if (r.trend !== h.trend) miss("trend", `${r.area} ${seq.slice(0, i + 1).map((x) => x.score).join("→")}: SQL ${r.trend} vs TS ${h.trend}`);
    if (r.notImproving !== h.notImproving) miss("not_improving", `${r.area}`);
    if ((r.prev ?? null) !== (h.prevScore ?? null) && Math.abs((r.prev ?? 0) - (h.prevScore ?? 0)) > 1e-9) miss("prev_score", r.area);
    const coLow = bySample.get(r.sample)!.filter((x) => x.area !== r.area && x.score <= NEEDS_SUPPORT_MAX).length;
    if (r.coLow !== coLow) miss("co_low_areas", `${r.area} SQL ${r.coLow} vs TS ${coLow}`);
    const reason = targetReason({ score: r.score, history: h, hadProductBefore: r.hadBefore, orderedProductAfter: r.after, coLowAreas: coLow });
    if (r.reason !== reason) miss("target_reason", `${r.area} score ${r.score}: SQL ${r.reason} vs TS ${reason}`);
  });
}
for (const list of bySample.values()) {
  const t = list.filter((x) => x.isTarget).length;
  if (list.some((x) => x.targetsOnSample !== t)) miss("targets_on_sample", `${list[0].targetsOnSample} vs ${t}`);
}
check(Object.keys(mismatch).length === 0, `SQL rules = TypeScript rules on every row ${JSON.stringify(mismatch)}`);
for (const e of examples) console.log(`      ${e}`);

// 5. Aggregate rollup agrees with the row pull.
const agg = await load({ dimensions: [m("area"), m("band")], measures: [m("samples"), m("targets"), m("potential_low"), m("potential_high")] });
let aggOk = true;
for (const a of agg) {
  const sub = rows.filter((r) => r.area === a[m("area")] && r.band === a[m("band")]);
  if (Number(a[m("samples")]) !== sub.length || Number(a[m("targets")]) !== sub.filter((r) => r.isTarget).length) aggOk = false;
}
check(aggOk, "fz_clinic_day aggregates = row-level counts");

// 6. Summary (aggregates only).
console.log("\nArea       rows  NeedsSup  Moderate  Optimal  Targets  (top-20% clinics)  Low$      High$");
for (const a of AREAS) {
  const s = rows.filter((r) => r.area === a.area);
  const t = s.filter((r) => r.isTarget);
  console.log(`${a.area.padEnd(10)} ${String(s.length).padStart(5)} ${String(s.filter((r) => r.band === "Needs support").length).padStart(9)} ` +
    `${String(s.filter((r) => r.band === "Moderate").length).padStart(9)} ${String(s.filter((r) => r.band === "Optimal").length).padStart(8)} ` +
    `${String(t.length).padStart(8)}  ${String(t.filter((r) => r.top20).length).padStart(17)}  ` +
    `${String(t.length * a.priceLow).padStart(8)}  ${String(t.length * a.priceHigh).padStart(8)}`);
}
const reasons = new Map<string, number>();
for (const r of rows) if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
console.log("\nTarget reasons:", Object.fromEntries(reasons));
const xsell = [...bySample.values()].filter((l) => l[0].targetsOnSample >= 2).length;
console.log(`FZ orders with 2+ target areas (cross-sell): ${xsell} of ${bySample.size}`);

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : "\nAll checks passed");
process.exit(fails.length ? 1 : 0);
