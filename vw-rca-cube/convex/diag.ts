/**
 * Read-only size diagnostics (run from the Convex dashboard → Functions → diag:sizes).
 *
 * drill() reads every clinicMeta row plus a period's clinicPeriod rows in one
 * query, and Convex caps a single execution at 16 MiB. This measures how close
 * the live data is: row counts, approximate bytes (JSON length) and how many
 * clinics drill() would skip anyway. Pages through the tables in small
 * queries so the diagnostic itself never hits the cap. Not exposed to the
 * browser (internal only).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

const PAGE = 1500;

export const pageMeta = internalQuery({
  args: { gen: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { gen, cursor }) => {
    const res = await ctx.db
      .query("clinicMeta")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .paginate({ numItems: PAGE, cursor });
    const fieldBytes: Record<string, number> = {};
    let bytes = 0;
    let idle = 0;
    let withNewGroups = 0;
    for (const m of res.page) {
      const json = JSON.stringify(m);
      bytes += json.length;
      for (const [k, val] of Object.entries(m)) {
        if (k.startsWith("_")) continue;
        fieldBytes[k] = (fieldBytes[k] ?? 0) + k.length + JSON.stringify(val).length;
      }
      if ((m.newGroups ?? []).length) withNewGroups++;
      // Zero baseline and no new-clinic tag: contributes nothing unless the
      // clinic has actuals in some period (checked separately below).
      const zeroBase =
        m.rev.every(x => x === 0) && m.baseRev === 0 && m.baseOrders === 0;
      if (zeroBase && !(m.newGroups ?? []).length) idle++;
    }
    return {
      count: res.page.length,
      bytes,
      idle,
      withNewGroups,
      fieldBytes,
      isDone: res.isDone,
      cursor: res.continueCursor,
    };
  },
});

export const pagePeriod = internalQuery({
  args: {
    gen: v.number(),
    periodId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { gen, periodId, cursor }) => {
    const res = await ctx.db
      .query("clinicPeriod")
      .withIndex("by_gen_period", q => q.eq("gen", gen).eq("periodId", periodId))
      .paginate({ numItems: PAGE * 2, cursor });
    let bytes = 0;
    for (const r of res.page) bytes += JSON.stringify(r).length;
    return {
      count: res.page.length,
      bytes,
      isDone: res.isDone,
      cursor: res.continueCursor,
    };
  },
});

export const currentGen = internalQuery({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }) => {
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", key ?? "main"))
      .unique();
    return {
      gen: cfg?.gen ?? 0,
      currentStart: cfg?.currentStart,
      currentEnd: cfg?.currentEnd,
      baselineStart: cfg?.baselineStart,
      baselineEnd: cfg?.baselineEnd,
    };
  },
});

export const sizes = internalAction({
  // key: a config row ("main" by default, or e.g. "rep:someone@vibrant-wellness.com").
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key }): Promise<Record<string, unknown>> => {
    const cfg: { gen: number } = await ctx.runQuery(internal.diag.currentGen, { key });
    const gen = cfg.gen;

    let cursor: string | null = null;
    let metaCount = 0;
    let metaBytes = 0;
    let idle = 0;
    let withNewGroups = 0;
    const fieldBytes: Record<string, number> = {};
    for (;;) {
      const r: {
        count: number;
        bytes: number;
        idle: number;
        withNewGroups: number;
        fieldBytes: Record<string, number>;
        isDone: boolean;
        cursor: string;
      } = await ctx.runQuery(internal.diag.pageMeta, { gen, cursor });
      metaCount += r.count;
      metaBytes += r.bytes;
      idle += r.idle;
      withNewGroups += r.withNewGroups;
      for (const [k, b] of Object.entries(r.fieldBytes)) {
        fieldBytes[k] = (fieldBytes[k] ?? 0) + b;
      }
      if (r.isDone) break;
      cursor = r.cursor;
    }

    const periods: Record<string, { rows: number; bytes: number }> = {};
    for (const periodId of ["all"]) {
      let c: string | null = null;
      let rows = 0;
      let bytes = 0;
      for (;;) {
        const r: { count: number; bytes: number; isDone: boolean; cursor: string } =
          await ctx.runQuery(internal.diag.pagePeriod, { gen, periodId, cursor: c });
        rows += r.count;
        bytes += r.bytes;
        if (r.isDone) break;
        c = r.cursor;
      }
      periods[periodId] = { rows, bytes };
    }

    const topFields = Object.entries(fieldBytes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 45)
      .map(([field, b]) => ({
        field,
        totalKB: Math.round(b / 1024),
        avgBytes: metaCount ? Math.round(b / metaCount) : 0,
      }));
    const MiB = 1024 * 1024;
    return {
      window: cfg,
      clinicMeta: {
        rows: metaCount,
        totalMiB: +(metaBytes / MiB).toFixed(2),
        avgBytes: metaCount ? Math.round(metaBytes / metaCount) : 0,
        zeroBaselineNoNewTag: idle,
        withNewGroups,
      },
      clinicPeriod: Object.fromEntries(
        Object.entries(periods).map(([p, x]) => [
          p,
          { rows: x.rows, totalMiB: +(x.bytes / MiB).toFixed(2) },
        ]),
      ),
      drillAllPeriodMiB: +((metaBytes + (periods.all?.bytes ?? 0)) / MiB).toFixed(2),
      limitMiB: 16,
      topFieldsInClinicMeta: topFields,
    };
  },
});

/**
 * Rows per generation for the big gen-scoped tables. Readers only ever see the
 * current generation, so anything beyond it (and the generations still held by
 * personal windows) is leaked storage that deleteGen/purgeOldGens failed to
 * remove. Run: diag:genRows (internal; Convex dashboard → Functions).
 */
const GEN_TABLES = [
  "clinicPeriod",
  "clinicMeta",
  "familyPeriod",
  "familySalesSeries",
  "salesPeriodBaseline",
] as const;

export const countGenRows = internalQuery({
  args: {
    table: v.string(),
    gen: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { table, gen, cursor }) => {
    // Dynamic table name: all of GEN_TABLES have a by_gen index.
    const res = await (ctx.db as any)
      .query(table)
      .withIndex("by_gen", (q: any) => q.eq("gen", gen))
      .paginate({ numItems: table === "clinicPeriod" ? 8000 : 2000, cursor });
    return {
      count: res.page.length as number,
      isDone: res.isDone as boolean,
      cursor: res.continueCursor as string,
    };
  },
});

export const genRows = internalAction({
  args: { maxGen: v.optional(v.number()), tables: v.optional(v.array(v.string())) },
  handler: async (ctx, { maxGen, tables }): Promise<Record<string, Record<string, number>>> => {
    const cfg: { gen: number } = await ctx.runQuery(internal.diag.currentGen, {});
    const top = maxGen ?? cfg.gen + 25;
    const out: Record<string, Record<string, number>> = {};
    for (const table of tables ?? GEN_TABLES) {
      out[table] = {};
      for (let gen = 0; gen <= top; gen++) {
        let cursor: string | null = null;
        let n = 0;
        try {
          for (;;) {
            const r: { count: number; isDone: boolean; cursor: string } =
              await ctx.runQuery(internal.diag.countGenRows, { table, gen, cursor });
            n += r.count;
            if (r.isDone) break;
            cursor = r.cursor;
          }
        } catch (e) {
          out[table]["error"] = String(e).slice(0, 120) as unknown as number;
          break;
        }
        if (n) out[table][`gen ${gen}`] = n;
      }
    }
    return out;
  },
});
