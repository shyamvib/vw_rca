/**
 * Equivalence check: run analytics handlers in Node against an exported
 * snapshot and compare with what a live Convex deployment returns for the
 * same arguments.
 *
 *   CONVEX_AGENT_MODE=anonymous npx tsx engine/scripts/compare.ts <export-dir>
 *
 * The Convex side is called with `npx convex run` (local anonymous backend
 * the snapshot was exported from). Numbers compare with a tiny tolerance.
 */
import { execFileSync } from "node:child_process";
import { Host, loadExport } from "../host";

const dir = process.argv[2];
if (!dir) throw new Error("usage: compare.ts <export-dir>");

const PW = "vw-rca-2026";
type Case = { fn: string; args: Record<string, unknown> };
const cases: Case[] = [];
const scopes: Array<Record<string, string>> = [
  {},
  { sales: "Madelyn Wiggins" },
  { sales: "Sara Simiele" },
  { teamLead: "Suzi Hansen" },
];
for (const periodId of ["all", "m:2026-09", "w:2026-10-05"]) {
  for (const scope of scopes) {
    const base = { password: PW, periodId, ...scope };
    if (Object.keys(scope).length === 0) {
      cases.push({ fn: "geo:geoSummary", args: base });
      cases.push({ fn: "geo:salesReps", args: base });
    } else {
      cases.push({ fn: "geo:scopeTotals", args: base });
      cases.push({ fn: "wins:winsSummary", args: base });
      cases.push({ fn: "clinics:cohortDriverSplit", args: base });
      cases.push({ fn: "clinics:clinicDrill", args: { ...base, lens: "total", limit: 500 } });
    }
  }
}

function convexRun(fn: string, args: unknown): unknown {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    maxBuffer: 256 * 1024 * 1024,
  });
  const i = out.search(/^[\[{]/m);
  return JSON.parse(out.slice(i));
}

function diff(a: any, b: any, path = ""): string[] {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (typeof a === "number" && typeof b === "number") {
      return Math.abs(a - b) <= 1e-6 + 1e-9 * Math.max(Math.abs(a), Math.abs(b)) ? [] : [`${path}: ${a} vs ${b}`];
    }
    return a === b ? [] : [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) !== Array.isArray(b)) return [`${path}: array vs object`];
  if (Array.isArray(a)) {
    if (a.length !== b.length) return [`${path}: length ${a.length} vs ${b.length}`];
    const out: string[] = [];
    for (let i = 0; i < a.length && out.length < 5; i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (out.length >= 5) break;
    if (!(k in a) || !(k in b)) {
      // Convex drops undefined; treat missing and undefined alike.
      if ((a as any)[k] === undefined && (b as any)[k] === undefined) continue;
      out.push(`${path}.${k}: missing on one side`);
      continue;
    }
    out.push(...diff(a[k], b[k], `${path}.${k}`));
  }
  return out;
}

const db = loadExport(dir);
const host = new Host(db);
await host.ready;
console.log(`registered ${host.names().length} analytics functions; ${cases.length} cases`);

let same = 0;
const bad: string[] = [];
const t0 = Date.now();
let nodeMs = 0;
for (const c of cases) {
  const n0 = Date.now();
  let mine: unknown;
  try {
    mine = JSON.parse(JSON.stringify(await host.invoke(c.fn, c.args)));
  } catch (e) {
    bad.push(`${c.fn} ${JSON.stringify(c.args)} -> node error: ${String(e).slice(0, 160)}`);
    continue;
  }
  nodeMs += Date.now() - n0;
  let theirs: unknown;
  try {
    theirs = convexRun(c.fn, c.args);
  } catch (e) {
    bad.push(`${c.fn} ${JSON.stringify(c.args)} -> convex error: ${String(e).slice(0, 160)}`);
    continue;
  }
  const d = diff(mine, theirs);
  if (d.length) bad.push(`${c.fn} ${JSON.stringify(c.args)}\n    ${d.join("\n    ")}`);
  else same++;
}
console.log(`identical ${same}/${cases.length}; node handler time total ${nodeMs} ms (${Math.round(nodeMs / cases.length)} ms avg); wall ${Math.round((Date.now() - t0) / 1000)}s`);
for (const b of bad.slice(0, 12)) console.log("DIFF", b);
