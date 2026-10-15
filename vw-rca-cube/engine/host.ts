/**
 * Runs the existing Convex query handlers in plain Node against an in-memory
 * snapshot (engine/memdb.ts). No Convex deployment involved: the analytics
 * side reads a snapshot, app state (logins, windows, plans, insights) stays in
 * Convex.
 */
import fs from "node:fs";
import path from "node:path";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema";
import { MemDb, type Doc } from "./memdb";

type AnyFn = ((...a: any[]) => any) & { _handler?: (ctx: any, args: any) => any; isQuery?: boolean };

/** Convex modules whose query/internalQuery exports the analytics side serves. */
const MODULES = [
  "clinics",
  "geo",
  "wins",
  "repView",
  "feed",
  "projection",
  "bridge",
  "leadFamilies",
  "productGrowth",
  "newClinicFunnel",
  "newClinicTouches",
  "config",
];

export function schemaIndexes(): Record<string, { name: string; fields: string[] }[]> {
  const out: Record<string, { name: string; fields: string[] }[]> = {};
  for (const [table, def] of Object.entries((schema as any).tables as Record<string, any>)) {
    out[table] = (def.indexes ?? []).map((i: any) => ({ name: i.indexDescriptor, fields: i.fields }));
  }
  return out;
}

/** Load a `npx convex export` directory (one folder per table, documents.jsonl). */
export function loadExport(dir: string, only?: string[]): MemDb {
  const db = new MemDb(schemaIndexes());
  for (const t of fs.readdirSync(dir)) {
    const f = path.join(dir, t, "documents.jsonl");
    if (!fs.existsSync(f)) continue;
    if (only && !only.includes(t)) continue;
    const docs: Doc[] = fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l));
    docs.sort((a, b) => a._creationTime - b._creationTime);
    db.load(t, docs);
  }
  return db;
}

export class Host {
  private registry = new Map<string, AnyFn>();
  ready: Promise<void>;

  constructor(public db: MemDb) {
    this.ready = this.init();
  }

  private async init() {
    for (const mod of MODULES) {
      const m: Record<string, AnyFn> = await import(`../convex/${mod}.ts`);
      for (const [name, fn] of Object.entries(m)) {
        if (typeof fn === "function" && fn._handler && fn.isQuery) {
          this.registry.set(`${mod}:${name}`, fn);
        }
      }
    }
  }

  names(): string[] {
    return [...this.registry.keys()].sort();
  }

  private ctx(): any {
    const self = this;
    return {
      db: this.db,
      auth: { getUserIdentity: async () => null },
      runQuery: async (ref: any, args: any) => self.invoke(getFunctionName(ref), args),
    };
  }

  async invoke(name: string, args: any): Promise<any> {
    await this.ready;
    const fn = this.registry.get(name);
    if (!fn?._handler) throw new Error(`unknown analytics function ${name}`);
    return await fn._handler(this.ctx(), args);
  }
}
