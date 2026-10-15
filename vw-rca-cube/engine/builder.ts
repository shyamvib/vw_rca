/**
 * Snapshot builder: runs the existing Refresh (convex/refresh.ts refreshData)
 * in Node. Its Cube pulls are real; every database write it makes lands in an
 * in-memory MemDb instead of Convex. The result is a snapshot of all analytics
 * tables that the analytics service can serve from (see engine/host.ts).
 *
 *   CUBE_API_URL=... CUBE_API_SECRET=... npx tsx engine/builder.ts <config-seed-export-dir> <out-dir>
 *
 * The config row (window, target, p75) is app state that lives in Convex; it is
 * seeded from `seed` (an export dir) here.
 */
import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { Host, loadExport, schemaIndexes } from "./host";
import { MemDb, type Doc } from "./memdb";

/** App-state tables the Refresh reads or writes; analytics output is everything else. */
const SEED_TABLES = ["config", "plan", "productEligible", "clinicPlan", "insights", "refreshLog"];

/** Pull the user-edited app state (window, target, eligibility, plans) from Convex. */
export async function seedFromConvex(db: MemDb) {
  const client = new ConvexHttpClient(process.env.CONVEX_URL!);
  (client as any).setAdminAuth(process.env.CONVEX_ADMIN_KEY!);
  const seed = (await client.query("appState:snapshotSeed" as any, {})) as Record<string, Doc[]>;
  db.load("config", seed.config.filter(r => r.key === "main"));
  db.load("productEligible", seed.productEligible);
  db.load("clinicPlan", seed.clinicPlan);
}

export async function buildSnapshot(seedDir?: string): Promise<{ db: MemDb; result: unknown; secs: number }> {
  const db = new MemDb(schemaIndexes());
  if (process.env.CONVEX_URL && process.env.CONVEX_ADMIN_KEY) {
    await seedFromConvex(db);
  } else if (seedDir) {
    const seed = loadExport(seedDir, SEED_TABLES);
    for (const [t, docs] of Object.entries(seed.dump())) db.load(t, docs);
  }
  const host = new Host(db, ["ingest", "config", "insights", "refresh"], ["query", "mutation", "action"]);
  await host.ready;
  const t0 = Date.now();
  const result = await host.invoke("refresh:refreshData", {});
  return { db, result, secs: Math.round((Date.now() - t0) / 1000) };
}

export function writeSnapshot(db: MemDb, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [t, docs] of Object.entries(db.dump())) {
    const dir = path.join(outDir, t);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "documents.jsonl"), docs.map((d: Doc) => JSON.stringify(d)).join("\n") + "\n");
  }
}

export function writeMeta(outDir: string, result: unknown) {
  const dataThrough = (result as { dataThrough?: string } | null)?.dataThrough ?? null;
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ builtAt: Date.now(), dataThrough }));
}

if (process.argv[1]?.endsWith("builder.ts")) {
  const [seed, out] = process.argv.slice(2);
  const { db, result, secs } = await buildSnapshot(seed);
  console.log("refresh result:", JSON.stringify(result), `in ${secs}s`);
  const counts = Object.entries(db.dump()).map(([t, d]) => [t, d.length] as const).sort((a, b) => b[1] - a[1]);
  console.log(counts.slice(0, 8).map(([t, n]) => `${t}:${n}`).join("  "));
  if (out) {
    writeSnapshot(db, out);
    writeMeta(out, result);
    console.log("snapshot written to", out);
  }
}
