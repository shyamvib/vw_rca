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

function convexClient(): ConvexHttpClient | null {
  if (!process.env.CONVEX_URL || !process.env.CONVEX_ADMIN_KEY) return null;
  const client = new ConvexHttpClient(process.env.CONVEX_URL);
  (client as any).setAdminAuth(process.env.CONVEX_ADMIN_KEY);
  return client;
}

/** Pull the user-edited app state (window, target, eligibility, plans) and insight history from Convex. */
export async function seedFromConvex(db: MemDb, client: ConvexHttpClient) {
  const seed = (await client.query("appState:snapshotSeed" as any, {})) as Record<string, Doc[]>;
  db.load("config", seed.config.filter(r => r.key === "main"));
  db.load("productEligible", seed.productEligible);
  db.load("clinicPlan", seed.clinicPlan);
  db.load("insights", seed.insights ?? []);
}

/** Send what the build produced for app state back to Convex: new/changed insight cards and the refresh log. */
export async function pushToConvex(db: MemDb, client: ConvexHttpClient, since: number) {
  const dump = db.dump();
  const rows = (dump.insights ?? []).filter(r => (r.updatedAt ?? 0) >= since);
  for (let i = 0; i < rows.length; i += 40) {
    await client.mutation("insights:ingest" as any, { rows: rows.slice(i, i + 40) });
  }
  const logs = (dump.refreshLog ?? []).filter(r => (r.startedAt ?? 0) >= since && r.status !== "running");
  for (const l of logs) {
    const { _id, _creationTime, ...rec } = l;
    await client.mutation("ops:recordRefresh" as any, { finishedAt: Date.now(), ...rec });
  }
  return { insights: rows.length, logs: logs.length };
}

export type Mode = "daily" | "weekly" | "monthly";

/**
 * @param mode "daily" is the full Refresh that produces a servable snapshot. "weekly" / "monthly"
 *   only generate that cadence's insight snapshot (they need the current derived window, taken
 *   from `liveDir`, the snapshot being served) and push it to Convex.
 */
export async function buildSnapshot(
  seedDir?: string,
  mode: Mode = "daily",
  liveDir?: string,
): Promise<{ db: MemDb; result: unknown; secs: number }> {
  const db = new MemDb(schemaIndexes());
  const client = convexClient();
  const startedAt = Date.now();
  if (client) {
    await seedFromConvex(db, client);
  } else if (seedDir) {
    const seed = loadExport(seedDir, SEED_TABLES);
    for (const [t, docs] of Object.entries(seed.dump())) db.load(t, docs);
  }
  if (mode !== "daily" && liveDir && fs.existsSync(path.join(liveDir, "config"))) {
    db.load("config", loadExport(liveDir, ["config"]).dump().config.filter(r => r.key === "main"));
  }
  const host = new Host(db, ["ingest", "config", "insights", "refresh"], ["query", "mutation", "action"]);
  await host.ready;
  const t0 = Date.now();
  const fn = mode === "weekly" ? "refresh:weeklySnapshotTick" : mode === "monthly" ? "refresh:monthlySnapshotTick" : "refresh:refreshData";
  const result = await host.invoke(fn, {});
  if (client) console.log("pushed to convex:", JSON.stringify(await pushToConvex(db, client, startedAt)));
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
  const r = result as { dataThrough?: string; rows?: number } | null;
  fs.writeFileSync(
    path.join(outDir, "meta.json"),
    JSON.stringify({ builtAt: Date.now(), dataThrough: r?.dataThrough ?? null, rows: r?.rows ?? 0 }),
  );
}

if (process.argv[1]?.endsWith("builder.ts")) {
  const [seed, out, modeArg, liveDir] = process.argv.slice(2);
  const mode = (modeArg as Mode) || "daily";
  const { db, result, secs } = await buildSnapshot(seed, mode, liveDir);
  console.log("refresh result:", JSON.stringify(result), `in ${secs}s`);
  const counts = Object.entries(db.dump()).map(([t, d]) => [t, d.length] as const).sort((a, b) => b[1] - a[1]);
  console.log(counts.slice(0, 8).map(([t, n]) => `${t}:${n}`).join("  "));
  if (out && mode === "daily") {
    writeSnapshot(db, out);
    writeMeta(out, result);
    console.log("snapshot written to", out);
  }
}
