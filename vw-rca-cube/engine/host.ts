/**
 * Runs the existing Convex query handlers in plain Node against an in-memory
 * snapshot (engine/memdb.ts). No Convex deployment involved: the analytics
 * side reads a snapshot, app state (logins, windows, plans, insights) stays in
 * Convex.
 */
import fs from "node:fs";
import path from "node:path";
import { getFunctionName } from "convex/server";
import schema from "../analytics/schema";
import { MemDb, type Doc } from "./memdb";

type AnyFn = ((...a: any[]) => any) & {
  _handler?: (ctx: any, args: any) => any;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
};

/** Modules whose *public* functions the analytics service exposes over /rpc. */
export const SERVED_MODULES = [
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
  "families",
  "clinicalTouch",
  "plan",
  "familyLaunch",
];

/** Individual functions served from otherwise internal modules (the admin rep dropdown reads names from the snapshot). */
const EXTRA_SERVED = ["repAuth:repNames"];

/** Registered so handlers can runQuery them, but never served over /rpc. */
const HELPER_MODULES = ["config", "repAuth", "ingest"];
export const ANALYTICS_MODULES = [...SERVED_MODULES, ...HELPER_MODULES];

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
  /** Public functions in SERVED_MODULES: the only names callable from outside. */
  private served = new Set<string>();
  ready: Promise<void>;

  /**
   * @param modules convex/ module names to register
   * @param kinds   which function kinds to expose (analytics: queries only; the
   *                snapshot builder also needs mutations and actions)
   */
  constructor(
    public db: MemDb,
    private modules: string[] = ANALYTICS_MODULES,
    private kinds: Array<"query" | "mutation" | "action"> = ["query", "mutation", "action"],
  ) {
    this.ready = this.init();
  }

  private async init() {
    for (const mod of this.modules) {
      const m: Record<string, AnyFn> = await import(`../analytics/${mod}.ts`);
      for (const [name, fn] of Object.entries(m)) {
        if (typeof fn !== "function" || !fn._handler) continue;
        const kind = fn.isQuery ? "query" : fn.isMutation ? "mutation" : fn.isAction ? "action" : null;
        if (kind && this.kinds.includes(kind)) {
          this.registry.set(`${mod}:${name}`, fn);
          if ((SERVED_MODULES.includes(mod) && (fn as any).isPublic) || EXTRA_SERVED.includes(`${mod}:${name}`)) this.served.add(`${mod}:${name}`);
        }
      }
    }
  }

  names(): string[] {
    return [...this.registry.keys()].sort();
  }

  /** Context handed to handlers: db plus in-process runQuery/runMutation/runAction. */
  ctx(): any {
    const self = this;
    const run = async (ref: any, args: any) => self.invoke(getFunctionName(ref), args);
    return {
      db: this.db,
      auth: { getUserIdentity: async () => null },
      runQuery: run,
      runMutation: run,
      runAction: run,
      // Scheduled follow-ups (old-generation purges, rep-window requeues) have
      // no meaning for a throwaway in-memory snapshot.
      scheduler: { runAfter: async () => undefined, runAt: async () => undefined },
    };
  }

  /** Entry point for requests from outside the process: public, served functions only. */
  async invokeExternal(name: string, args: any): Promise<any> {
    await this.ready;
    if (!this.served.has(name)) throw new Error(`unknown function ${name}`);
    return this.invoke(name, args);
  }

  async invoke(name: string, args: any): Promise<any> {
    await this.ready;
    const fn = this.registry.get(name);
    if (!fn?._handler) throw new Error(`unknown function ${name}`);
    return await fn._handler(this.ctx(), args);
  }
}
