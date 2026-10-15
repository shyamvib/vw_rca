/**
 * In-memory stand-in for Convex's `ctx.db` (read side only).
 *
 * Lets the existing Convex query handlers run unchanged in plain Node against a
 * snapshot of the data (see engine/host.ts). Implements the query surface the
 * handlers use: query(table).withIndex(name, range).filter(expr).order(dir)
 * followed by collect / take / first / unique / paginate / async iteration,
 * plus get(id). Index order follows Convex: index fields, then _creationTime,
 * then _id; missing optional fields sort first.
 *
 * Writes throw: the analytics side never mutates (app state stays in Convex).
 */

export type Doc = Record<string, any> & { _id: string; _creationTime: number };

type Cond = { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: any };

function rank(v: any): number {
  if (v === undefined) return 0;
  if (v === null) return 1;
  switch (typeof v) {
    case "bigint":
      return 2;
    case "number":
      return 3;
    case "boolean":
      return 4;
    case "string":
      return 5;
  }
  if (Array.isArray(v)) return 7;
  return 8;
}

/** Convex value ordering (enough of it for index keys and filter comparisons). */
export function cmp(a: any, b: any): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (ra) {
    case 0:
    case 1:
      return 0;
    case 2:
    case 3:
    case 5:
      return a < b ? -1 : a > b ? 1 : 0;
    case 4:
      return a === b ? 0 : a ? 1 : -1;
    case 7: {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const c = cmp(a[i], b[i]);
        if (c) return c;
      }
      return a.length - b.length;
    }
    default:
      return 0;
  }
}

type IndexDef = { name: string; fields: string[] };

class Table {
  docs: Doc[] = [];
  private cache = new Map<string, Doc[]>();
  constructor(
    readonly name: string,
    readonly indexes: IndexDef[],
  ) {}

  sorted(indexName: string): { fields: string[]; rows: Doc[] } {
    let fields: string[];
    if (indexName === "by_creation_time") fields = ["_creationTime"];
    else if (indexName === "by_id") fields = ["_id"];
    else {
      const def = this.indexes.find(i => i.name === indexName);
      if (!def) throw new Error(`MemDb: table ${this.name} has no index ${indexName}`);
      fields = def.fields;
    }
    const full = [...fields, "_creationTime", "_id"];
    let rows = this.cache.get(indexName);
    if (!rows) {
      rows = [...this.docs].sort((x, y) => {
        for (const f of full) {
          const c = cmp(x[f], y[f]);
          if (c) return c;
        }
        return 0;
      });
      this.cache.set(indexName, rows);
    }
    return { fields, rows };
  }
}

/** Expression builder passed to .filter(q => ...). */
type Expr = { __e: (doc: Doc) => any };
const lit = (x: any): ((d: Doc) => any) => (x && x.__e ? x.__e : () => x);
const mk = (f: (d: Doc) => any): Expr => ({ __e: f });
const exprBuilder = {
  field: (name: string) => mk(d => d[name]),
  eq: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) === 0),
  neq: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) !== 0),
  lt: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) < 0),
  lte: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) <= 0),
  gt: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) > 0),
  gte: (a: any, b: any) => mk(d => cmp(lit(a)(d), lit(b)(d)) >= 0),
  and: (...xs: any[]) => mk(d => xs.every(x => lit(x)(d))),
  or: (...xs: any[]) => mk(d => xs.some(x => lit(x)(d))),
  not: (x: any) => mk(d => !lit(x)(d)),
  add: (a: any, b: any) => mk(d => lit(a)(d) + lit(b)(d)),
  sub: (a: any, b: any) => mk(d => lit(a)(d) - lit(b)(d)),
  mul: (a: any, b: any) => mk(d => lit(a)(d) * lit(b)(d)),
  div: (a: any, b: any) => mk(d => lit(a)(d) / lit(b)(d)),
  mod: (a: any, b: any) => mk(d => lit(a)(d) % lit(b)(d)),
  neg: (a: any) => mk(d => -lit(a)(d)),
};

class QueryBuilder {
  private indexName = "by_creation_time";
  private conds: Cond[] = [];
  private dir: "asc" | "desc" = "asc";
  private filters: Array<(d: Doc) => boolean> = [];

  constructor(private table: Table) {}

  withIndex(name: string, range?: (q: any) => any): this {
    this.indexName = name;
    if (range) {
      const ib: any = {};
      for (const op of ["eq", "gt", "gte", "lt", "lte"] as const) {
        ib[op] = (field: string, value: any) => {
          this.conds.push({ op, field, value });
          return ib;
        };
      }
      range(ib);
    }
    return this;
  }

  order(dir: "asc" | "desc"): this {
    this.dir = dir;
    return this;
  }

  filter(fn: (q: any) => any): this {
    const e = fn(exprBuilder);
    const f = lit(e);
    this.filters.push(d => !!f(d));
    return this;
  }

  private run(): Doc[] {
    const { fields, rows } = this.table.sorted(this.indexName);
    // Leading equality conditions narrow the sorted rows by binary search;
    // anything after them (a range on the next field) is checked linearly.
    const eqs: Cond[] = [];
    const rest: Cond[] = [];
    for (const c of this.conds) {
      if (c.op === "eq" && rest.length === 0 && fields[eqs.length] === c.field) eqs.push(c);
      else rest.push(c);
    }
    const prefix = eqs.map(c => c.value);
    const cmpPrefix = (d: Doc) => {
      for (let i = 0; i < eqs.length; i++) {
        const c = cmp(d[eqs[i].field], prefix[i]);
        if (c) return c;
      }
      return 0;
    };
    let lo = 0;
    let hi = rows.length;
    if (eqs.length) {
      let a = 0;
      let b = rows.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (cmpPrefix(rows[m]) < 0) a = m + 1;
        else b = m;
      }
      lo = a;
      b = rows.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (cmpPrefix(rows[m]) <= 0) a = m + 1;
        else b = m;
      }
      hi = a;
    }
    let out: Doc[] = rows.slice(lo, hi);
    for (const c of rest) {
      out = out.filter(d => {
        const k = cmp(d[c.field], c.value);
        return c.op === "gt" ? k > 0 : c.op === "gte" ? k >= 0 : c.op === "lt" ? k < 0 : c.op === "lte" ? k <= 0 : k === 0;
      });
    }
    for (const f of this.filters) out = out.filter(f);
    if (this.dir === "desc") out = out.reverse();
    return out;
  }

  async collect(): Promise<Doc[]> {
    return this.run();
  }
  async take(n: number): Promise<Doc[]> {
    return this.run().slice(0, n);
  }
  async first(): Promise<Doc | null> {
    return this.run()[0] ?? null;
  }
  async unique(): Promise<Doc | null> {
    const r = this.run();
    if (r.length > 1) throw new Error(`MemDb: unique() found ${r.length} documents in ${this.table.name}`);
    return r[0] ?? null;
  }
  async paginate(opts: { numItems: number; cursor: string | null }) {
    const all = this.run();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = all.slice(start, start + opts.numItems);
    const end = start + page.length;
    return { page, isDone: end >= all.length, continueCursor: String(end) };
  }
  async *[Symbol.asyncIterator]() {
    for (const d of this.run()) yield d;
  }
}

export class MemDb {
  private tables = new Map<string, Table>();
  private byId = new Map<string, Doc>();

  constructor(private schemaIndexes: Record<string, IndexDef[]>) {}

  load(table: string, docs: Doc[]) {
    const t = new Table(table, this.schemaIndexes[table] ?? []);
    t.docs = docs;
    for (const d of docs) this.byId.set(d._id, d);
    this.tables.set(table, t);
  }

  query(table: string): QueryBuilder {
    const t = this.tables.get(table) ?? (this.tables.set(table, new Table(table, this.schemaIndexes[table] ?? [])), this.tables.get(table)!);
    return new QueryBuilder(t);
  }

  async get(id: string): Promise<Doc | null> {
    return this.byId.get(id) ?? null;
  }

  insert(): never {
    throw new Error("MemDb is read-only");
  }
  patch(): never {
    throw new Error("MemDb is read-only");
  }
  replace(): never {
    throw new Error("MemDb is read-only");
  }
  delete(): never {
    throw new Error("MemDb is read-only");
  }
}
