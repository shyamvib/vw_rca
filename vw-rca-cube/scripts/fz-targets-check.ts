// Checks the engine's fzScores:clinics handler against an independent recomputation from Cube.
//
//   cd vw-rca-cube && node --env-file=.env.engine.local --import tsx scripts/fz-targets-check.ts [snapshot-dir]
//
// Loads the engine snapshot (default ~/.rca-engine-thiru/data/snapshot) into an in-process Host — the running engine
// is not touched — and calls the real handler (password gate + rep/team scoping) with a random one-time password
// that exists only in this process. For several scopes × windows it compares the answer with analytics/fzTargets.ts
// run on rows pulled straight from Cube, and asserts no patient id or hash appears in any answer.
// Prints aggregate numbers only. Exit 1 on failure.
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { load } from "../analytics/cube";
import { periodDefs } from "../analytics/dateUtils";
import { conversionRates, fzTargets, type FzRow } from "../analytics/fzTargets";
import { periodRange } from "../analytics/families";
import { sha256Hex } from "../analytics/password";
import { Host, loadExport } from "../engine/host";

const dir = process.argv[2] ?? path.join(os.homedir(), ".rca-engine-thiru", "data", "snapshot");
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
};

// --- engine side ---------------------------------------------------------------------------------------------
const pw = randomUUID();
process.env.DASHBOARD_PASSWORD_SHA256 = await sha256Hex(pw);
const db = loadExport(dir);
const host = new Host(db);
await host.ready;
const snapRows = (await host.ctx().db.query("fzScores").collect()) as unknown as FzRow[];
const cfg: any = await host.ctx().db.query("config").withIndex("by_key", (q: any) => q.eq("key", "main")).unique();
const meta: any[] = await host.ctx().db.query("clinicMeta").withIndex("by_gen", (q: any) => q.eq("gen", cfg.gen ?? 0)).collect();
console.log(`      snapshot ${dir}: ${snapRows.length} fzScores rows, window ${cfg.currentStart}..${cfg.currentEnd}`);

// --- independent side: straight from Cube, raw patient id as the key (kept in memory, never printed) ----------
const C = "fz_scores", m = (x: string) => `${C}.${x}`;
const DIMS = ["sample_id", "area", "product", "price_low", "price_high", "patient_id", "clinic_id", "score", "band", "trend",
  "target_reason", "is_target", "targets_on_sample", "is_top20_ytd", "had_product_before", "ordered_product_after"];
const bool = (x: unknown) => x === true || x === "true";
const pull = (dims: string[]) => load({ dimensions: dims.map(m), measures: [m("samples")],
  timeDimensions: [{ dimension: m("order_date"), granularity: "day" }] });
let withResult = true;
let raw: Awaited<ReturnType<typeof pull>>;
try { raw = await pull([...DIMS, "result_day"]); } catch (e) {
  if (!/result_day/.test(String(e))) throw e;
  withResult = false;
  raw = await pull(DIMS);
}
console.log(`      windows by ${withResult ? "result date" : "order date (Cube has no result_day yet)"}`);
const cubeRows: FzRow[] = raw.map(r => ({
  area: String(r[m("area")]), product: String(r[m("product")]), priceLow: Number(r[m("price_low")]),
  priceHigh: Number(r[m("price_high")]), clinic: String(r[m("clinic_id")]), day: String(r[m("order_date.day")]).slice(0, 10),
  resultDay: String((withResult ? r[m("result_day")] : null) ?? r[m("order_date.day")]).slice(0, 10),
  sample: String(r[m("sample_id")]), pt: String(r[m("patient_id")]), score: Number(r[m("score")]), band: String(r[m("band")]),
  trend: String(r[m("trend")]), reason: (r[m("target_reason")] as string | null) ?? null, isTarget: bool(r[m("is_target")]),
  targetsOnSample: Number(r[m("targets_on_sample")]), isTop20: bool(r[m("is_top20_ytd")]),
  hadBefore: bool(r[m("had_product_before")]), orderedAfter: bool(r[m("ordered_product_after")]),
}));
check(snapRows.length === cubeRows.length, `snapshot rows = Cube rows (${snapRows.length} vs ${cubeRows.length})`);
check(snapRows.every(r => /^[0-9a-f]{16}$/.test(r.pt)), "snapshot holds only hashed patient keys");
const rawIds = new Set(cubeRows.map(r => r.pt));
check(!snapRows.some(r => rawIds.has(r.pt)), "no raw patient id in the snapshot");
const hashes = new Set(snapRows.map(r => r.pt));
const rates = conversionRates(cubeRows);

// --- scopes × windows -------------------------------------------------------------------------------------------
const targetsByRep = new Map<string, number>();
const repOf = new Map(meta.map(x => [x.clinic, x.sales]));
for (const r of cubeRows) if (r.isTarget) targetsByRep.set(repOf.get(r.clinic) ?? "", (targetsByRep.get(repOf.get(r.clinic) ?? "") ?? 0) + 1);
const reps = [...targetsByRep].filter(([s]) => s && s !== "—").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
const leads = [...new Set(meta.map(x => x.teamLead).filter(Boolean))].slice(0, 1) as string[];
const scopes = [...reps, ...leads.map(l => `team:${l}`), "team:*"];
const defs = periodDefs(cfg.currentStart, cfg.currentEnd);
const last = (p: string) => defs.filter(d => d.id.startsWith(p)).map(d => d.id).sort().at(-1);
const windows = ["all", last("q:"), last("m:"), last("w:")].filter(Boolean) as string[];

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const scopeSet = (s: string) => {
  const lead = s.startsWith("team:") ? s.slice(5) : null;
  return new Set(meta.filter(x => lead === "*" ? true : lead ? x.teamLead === lead : x.sales === s).map(x => x.clinic));
};
let compared = 0, nonEmpty = 0, leaks = 0;
for (const s of scopes) {
  for (const w of windows) {
    const got: any = await host.invoke("fzScores:clinics", { password: pw, periodId: w, sales: s });
    const pr = periodRange(w, cfg.currentStart, cfg.currentEnd);
    const want = fzTargets(cubeRows, { start: pr.start, end: pr.end }, scopeSet(s), rates);
    const label = `${s.startsWith("team:") ? s : `rep #${reps.indexOf(s) + 1}`} × ${w}`;
    if (!got.ready) { check(false, `${label}: handler not ready (${got.reason})`); continue; }
    compared++;
    if (got.clinics.length) nonEmpty++;
    const t = got.totals, u = want.totals;
    const same = t.scored === u.scored && t.targetPatients === u.targetPatients && t.crossSell === u.crossSell &&
      t.clinics === u.clinics && near(t.low, u.low) && near(t.high, u.high) && near(t.likely, u.likely) &&
      got.clinics.length === want.clinics.length &&
      got.clinics.every((c: any, i: number) => { const d = want.clinics[i];
        return c.clinic === d.clinic && c.targetPatients === d.targetPatients && c.crossSell === d.crossSell &&
          c.scored === d.scored && near(c.low, d.low) && near(c.high, d.high) && JSON.stringify(c.products) === JSON.stringify(d.products); }) &&
      JSON.stringify(got.products.map((p: any) => [p.area, p.patients, p.clinics])) ===
        JSON.stringify(want.products.map(p => [p.area, p.patients, p.clinics]));
    if (!same) check(false, `${label}: engine ≠ recomputation (engine ${JSON.stringify(t)} vs ${JSON.stringify(u)})`);
    // Privacy: no raw id or hash among any string value in the answer, and no "pt" key.
    const json = JSON.stringify(got);
    const strings = json.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    if (strings.some(q => { const x = q.slice(1, -1); return rawIds.has(x) || hashes.has(x); }) || /"pt"\s*:/.test(json)) leaks++;
    console.log(`      ${label.padEnd(28)} clinics ${String(got.totals.clinics).padStart(4)}  target patients ${String(got.totals.targetPatients).padStart(5)}  cross-sell ${String(got.totals.crossSell).padStart(4)}  $${Math.round(got.totals.low)}–${Math.round(got.totals.high)}`);
  }
}
check(compared === scopes.length * windows.length && fails.length === 0, `engine = recomputation for ${compared} scope × window answers (${nonEmpty} non-empty)`);
check(leaks === 0, "no patient id or hash in any answer");
const noRep: any = await host.invoke("fzScores:clinics", { password: pw, periodId: "all" });
check(noRep.ready === false && noRep.reason === "pick-rep", "no scope → ready:false 'pick-rep' (no throw)");
let denied = false;
try { await host.invoke("fzScores:clinics", { password: "wrong", periodId: "all", sales: "team:*" }); } catch { denied = true; }
check(denied, "wrong password is refused");

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : "\nAll checks passed");
process.exit(fails.length ? 1 : 0);
