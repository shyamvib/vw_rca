import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

type TableName = keyof DataModel & string;

const CLEARABLE = [
  "dailyTotals",
  "stateDaily",
  "cohortDaily",
  "cohortBaseline",
  "stateBaseline",
  "clinicMeta",
  "clinicPeriod",
  "leadPeriodBaseline",
  "salesPeriodBaseline",
  "geoPeriodBaseline",
  "familyBaseline",
  "familyPeriod",
  "familyLeadSeries",
  "familySalesSeries",
  "channelDaily",
  "channelBaseline",
  "newLogoBaseline",
  "drillCache",
] as const;

/** Delete all rows of a fact table in bounded batches. Returns true when empty. */
export const clearTable = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    if (!(CLEARABLE as readonly string[]).includes(table)) {
      throw new Error(`Refusing to clear ${table}`);
    }
    const rows = await ctx.db.query(table as TableName).take(2000);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length < 2000;
  },
});

export const putDailyTotals = internalMutation({
  args: {
    rows: v.array(
      v.object({
        date: v.string(),
        orders: v.number(),
        revenue: v.number(),
        bundleOrders: v.number(),
        bundleRevenue: v.number(),
        patients: v.optional(v.number()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("dailyTotals", { ...row, gen });
  },
});

export const putStateDaily = internalMutation({
  args: {
    rows: v.array(
      v.object({ date: v.string(), state: v.string(), revenue: v.number() }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("stateDaily", { ...row, gen });
  },
});

export const putStateBaseline = internalMutation({
  args: {
    rows: v.array(v.object({ state: v.string(), rates: v.array(v.number()) })),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("stateBaseline", { ...row, gen });
  },
});

export const putCohortDaily = internalMutation({
  args: {
    rows: v.array(
      v.object({ date: v.string(), cohort: v.string(), revenue: v.number() }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("cohortDaily", { ...row, gen });
  },
});

export const putCohortBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        cohort: v.string(),
        rates: v.array(v.number()),
        clinics: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("cohortBaseline", { ...row, gen });
  },
});

export const putClinicMeta = internalMutation({
  args: {
    rows: v.array(
      v.object({
        clinic: v.string(),
        name: v.string(),
        state: v.string(),
        country: v.optional(v.string()),
        teamLead: v.optional(v.string()),
        sales: v.string(),
        cohort: v.string(),
        rev: v.array(v.number()),
        ord: v.array(v.number()),
        bRev: v.array(v.number()),
        bOrd: v.array(v.number()),
        pat: v.optional(v.array(v.number())),
        baseRev: v.number(),
        baseOrders: v.number(),
        basePatients: v.optional(v.number()),
        health: v.optional(v.array(v.string())),
        pstatus: v.optional(v.array(v.string())),
        firstOrder: v.optional(v.string()),
        lastOrder: v.optional(v.string()),
        newGroups: v.optional(v.array(v.string())),
        windowOrderDays: v.optional(v.number()),
        ytdRevenue: v.optional(v.number()),
        ytdOrders: v.optional(v.number()),
        fwdRevenue: v.optional(v.number()),
        fwdOrders: v.optional(v.number()),
        monthOrders: v.optional(v.number()),
        monthSeries: v.optional(v.array(v.number())),
        lastOrderAllTime: v.optional(v.string()),
        vaYtdPct: v.optional(v.number()),
        lifetimeRevenue: v.optional(v.number()),
        lifetimeDeductionRate: v.optional(v.number()),
        lastTouchDate: v.optional(v.string()),
        touchDataAvailable: v.optional(v.boolean()),
        medianGapBd: v.optional(v.number()),
        bdSinceLastOrder: v.optional(v.number()),
        signupDate: v.optional(v.string()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("clinicMeta", { ...row, gen });
  },
});

export const putNewClinicOrderSeq = internalMutation({
  args: {
    rows: v.array(
      v.object({
        clinic: v.string(),
        name: v.string(),
        sales: v.string(),
        teamLead: v.optional(v.string()),
        firstOrder: v.string(),
        signupDate: v.optional(v.string()),
        orderDates: v.array(v.string()),
        orderRevenue: v.array(v.number()),
        touchDates: v.optional(v.array(v.string())),
        clinicalTouchDates: v.optional(v.array(v.string())),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("newClinicOrderSeq", { ...row, gen });
  },
});

export const putSignupDaily = internalMutation({
  args: {
    rows: v.array(
      v.object({ date: v.string(), sales: v.string(), count: v.number() }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("signupDaily", { ...row, gen });
  },
});

export const putSignupLead = internalMutation({
  args: {
    rows: v.array(
      v.object({
        date: v.string(), sales: v.string(), customerId: v.string(), name: v.string(),
        state: v.optional(v.string()), firstOrder: v.optional(v.string()),
        clinic: v.optional(v.string()), practice: v.optional(v.string()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("signupLead", { ...row, gen });
  },
});

export const putVaClinicTarget = internalMutation({
  args: {
    rows: v.array(
      v.object({
        clinic: v.string(),
        name: v.string(),
        state: v.string(),
        sales: v.string(),
        teamLead: v.string(),
        vaOrders: v.number(),
        vaRevenue: v.number(),
        allOrders: v.number(),
        allRevenue: v.number(),
        windowDays: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("vaClinicTarget", { ...row, gen });
  },
});

export const putNewLogoBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        key: v.string(),
        lead: v.string(),
        clinics: v.number(),
        orders: v.number(),
        revenue: v.number(),
        baseDays: v.number(),
        curDays: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("newLogoBaseline", { ...row, gen });
  },
});

export const putClinicPeriod = internalMutation({
  args: {
    rows: v.array(
      v.object({
        periodId: v.string(),
        clinic: v.string(),
        revenue: v.number(),
        orders: v.number(),
        bundleRevenue: v.number(),
        bundleOrders: v.number(),
        patients: v.optional(v.number()),
        // Power BI-equivalent rolling P75 baseline (trailing 13 weeks / 3
        // months), precomputed at refresh time (2026-09-28) — see
        // refresh.ts's "4d." section and dateUtils.ts's rollingBaseline.
        expectedRevenue: v.optional(v.number()),
        expectedOrdersP75: v.optional(v.number()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("clinicPeriod", { ...row, gen });
  },
});

export const putLeadPeriodBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        periodId: v.string(),
        lead: v.string(),
        expectedRevenue: v.number(),
        expectedOrders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("leadPeriodBaseline", { ...row, gen });
  },
});

export const putSalesPeriodBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        periodId: v.string(),
        sales: v.string(),
        expectedRevenue: v.number(),
        expectedOrders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("salesPeriodBaseline", { ...row, gen });
  },
});

export const putGeoPeriodBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        periodId: v.string(),
        geo: v.string(),
        sales: v.string(),
        expectedRevenue: v.number(),
        expectedOrders: v.number(),
        actualRevenue: v.optional(v.number()),
        geoJson: v.optional(v.string()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows) await ctx.db.insert("geoPeriodBaseline", { ...row, gen });
  },
});

export const putFamilyBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        scope: v.string(),
        family: v.string(),
        rates: v.array(v.number()),
        ordRates: v.array(v.number()),
        baseRev: v.number(),
        baseOrders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("familyBaseline", { ...row, gen });
  },
});

export const putFamilyLeadSeries = internalMutation({
  args: {
    rows: v.array(
      v.object({
        lead: v.string(),
        scope: v.string(),
        family: v.string(),
        days: v.array(
          v.object({ d: v.string(), rev: v.number(), ord: v.number() }),
        ),
        rates: v.array(v.number()),
        ordRates: v.array(v.number()),
        baseRev: v.number(),
        baseOrders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("familyLeadSeries", { ...row, gen });
  },
});

export const putFamilySalesSeries = internalMutation({
  args: {
    rows: v.array(
      v.object({
        sales: v.string(),
        scope: v.string(),
        family: v.string(),
        days: v.array(
          v.object({ d: v.string(), rev: v.number(), ord: v.number() }),
        ),
        rates: v.array(v.number()),
        ordRates: v.array(v.number()),
        baseRev: v.number(),
        baseOrders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("familySalesSeries", { ...row, gen });
  },
});

export const putFamilyPeriod = internalMutation({
  args: {
    rows: v.array(
      v.object({
        periodId: v.string(),
        scope: v.string(),
        family: v.string(),
        revenue: v.number(),
        orders: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("familyPeriod", { ...row, gen });
  },
});

export const putChannelDaily = internalMutation({
  args: {
    rows: v.array(
      v.object({
        date: v.string(),
        channel: v.string(),
        orders: v.number(),
        revenue: v.number(),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("channelDaily", { ...row, gen });
  },
});

export const putChannelBaseline = internalMutation({
  args: {
    rows: v.array(
      v.object({
        channel: v.string(),
        rates: v.array(v.number()),
        ordRates: v.array(v.number()),
      }),
    ),
    gen: v.number(),
  },
  handler: async (ctx, { rows, gen }) => {
    for (const row of rows)
      await ctx.db.insert("channelBaseline", { ...row, gen });
  },
});

export const putProjection = internalMutation({
  args: {
    row: v.object({
      ytdStart: v.string(),
      ytdEnd: v.string(),
      ytdRevenue: v.number(),
      ytdOrders: v.number(),
      fwdRates: v.array(v.number()),
      fwdOrdRates: v.array(v.number()),
      days: v.array(
        v.object({
          date: v.string(),
          factor: v.number(),
          rev: v.number(),
          ord: v.number(),
        }),
      ),
      holidays: v.array(v.string()),
      leads: v.optional(
        v.array(
          v.object({
            lead: v.string(),
            ytdRevenue: v.number(),
            ytdOrders: v.number(),
            share: v.number(),
            ordShare: v.number(),
          }),
        ),
      ),
    }),
    gen: v.number(),
  },
  handler: async (ctx, { row, gen }) => {
    await ctx.db.insert("projection", { ...row, gen });
  },
});

const GEN_TABLES = [
  "projection",
  "dailyTotals",
  "stateDaily",
  "cohortDaily",
  "cohortBaseline",
  "stateBaseline",
  "clinicMeta",
  "clinicPeriod",
  "leadPeriodBaseline",
  "salesPeriodBaseline",
  "geoPeriodBaseline",
  "familyBaseline",
  "familyPeriod",
  "familyLeadSeries",
  "familySalesSeries",
  "channelDaily",
  "channelBaseline",
  "newLogoBaseline",
  "vaClinicTarget",
  "newClinicOrderSeq",
  "signupDaily",
  "signupLead",
] as const;

/**
 * Deletes rows left over from older refresh generations. Runs after the swap
 * (scheduled, so it never sits on the refresh's critical path) and reschedules
 * itself until every stale row is gone.
 */
export const purgeOldGens = internalMutation({
  args: { keep: v.number() },
  handler: async (ctx, { keep }) => {
    // Protect both completed rep windows and independent refresh generations
    // still being written before their config pointers are switched.
    const repGens = (await ctx.db.query("config").collect())
      .filter(r => r.key.startsWith("rep:") && r.gen)
      .map(r => r.gen as number)
      .filter(g => g < keep);
    const leasedGens = (await ctx.db.query("generationLeases").collect())
      .map(r => r.gen)
      .filter(g => g < keep);
    // Never erase the just-replaced main generation while an overlapping
    // rep cache may still be reading its daily rows. A main refresh swaps
    // config.gen before this scheduled purge begins; protection of a source
    // version must be via a lease, not merely a live config pointer.
    const protectedGens = [...new Set([...repGens, ...leasedGens])].sort(
      (a, b) => a - b,
    );
    const bounds = [-1, ...protectedGens, keep];
    let budget = 4000;
    outer: for (const table of GEN_TABLES) {
      for (let i = 0; i < bounds.length - 1; i++) {
        const lo = bounds[i];
        const hi = bounds[i + 1];
        while (budget > 0) {
          const stale = await ctx.db
            .query(table)
            .withIndex("by_gen", q =>
              i === 0 ? q.lt("gen", hi) : q.gt("gen", lo).lt("gen", hi),
            )
            .take(Math.min(budget, 1000));
          for (const row of stale) await ctx.db.delete(row._id);
          budget -= stale.length;
          if (stale.length < 1000) break;
        }
        if (budget <= 0) break outer;
      }
    }
    if (budget <= 0) {
      await ctx.scheduler.runAfter(0, internal.ingest.purgeOldGens, { keep });
    }
  },
});

/** Clears one rep's cached drill payloads (keys are prefixed "rep:<email>"). */
export const clearCachePrefix = internalMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    const rows = await ctx.db
      .query("drillCache")
      .withIndex("by_key", q =>
        q.gte("key", prefix).lt("key", prefix + "\uffff"),
      )
      .take(500);
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length < 500;
  },
});

/**
 * Deletes every row of one specific generation across all gen-scoped tables.
 * Used by historical insight snapshots (Shyam, 2026-09-23): a snapshot
 * refresh reserves its own gen, writes under it, extracts insights, then
 * calls this to clean itself up — unlike purgeOldGens, this never touches
 * any other generation (including the live one), so it's safe to call while
 * the live dashboard is pointed at a different gen.
 */
export const deleteGen = internalMutation({
  args: { gen: v.number() },
  handler: async (ctx, { gen }) => {
    let budget = 4000;
    for (const table of GEN_TABLES) {
      while (budget > 0) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_gen", q => q.eq("gen", gen))
          .take(Math.min(budget, 1000));
        for (const row of rows) await ctx.db.delete(row._id);
        budget -= rows.length;
        if (rows.length < 1000) break;
      }
      if (budget <= 0) break;
    }
    if (budget <= 0) {
      await ctx.scheduler.runAfter(0, internal.ingest.deleteGen, { gen });
    } else {
      const lease = await ctx.db
        .query("generationLeases")
        .withIndex("by_gen", q => q.eq("gen", gen))
        .unique();
      if (lease) await ctx.db.delete(lease._id);
    }
  },
});

export const releaseGenLease = internalMutation({
  args: { gen: v.number() },
  handler: async (ctx, { gen }) => {
    const lease = await ctx.db
      .query("generationLeases")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .unique();
    if (lease) await ctx.db.delete(lease._id);
  },
});

/** Inspect a generation's reservation during preview concurrency tests. */
export const inspectGenerationProtection = internalQuery({
  args: { gen: v.number() },
  handler: async (ctx, { gen }) => {
    const lease = await ctx.db
      .query("generationLeases")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .unique();
    const owners = (await ctx.db.query("config").collect())
      .filter(r => r.gen === gen)
      .map(r => r.key);
    return { leased: !!lease, owners };
  },
});

/** Dev probe of a rep config row; never exposes this state to the browser. */
export const inspectRepWindow = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if (!key.startsWith("rep:")) throw new Error("Rep key required");
    const r = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", key))
      .unique();
    return (
      r && {
        gen: r.gen,
        status: r.status,
        reqStart: r.reqStart,
        reqEnd: r.reqEnd,
        currentStart: r.currentStart,
        currentEnd: r.currentEnd,
      }
    );
  },
});

/** Reads a cached drill payload (JSON string) if present. */
export const getCache = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const hit = await ctx.db
      .query("drillCache")
      .withIndex("by_key", q => q.eq("key", key))
      .unique();
    return hit?.payload ?? null;
  },
});

export const putCache = internalMutation({
  args: { key: v.string(), payload: v.string() },
  handler: async (ctx, { key, payload }) => {
    const hit = await ctx.db
      .query("drillCache")
      .withIndex("by_key", q => q.eq("key", key))
      .unique();
    if (hit) {
      await ctx.db.patch(hit._id, { payload, createdAt: Date.now() });
      return;
    }
    await ctx.db.insert("drillCache", { key, payload, createdAt: Date.now() });
  },
});

/**
 * Starts a refresh unless one is already running (started < 15 min ago).
 * Concurrent refreshes used to collide on the bulk tables and fail with an
 * optimistic-concurrency error, which is what surfaced as "refresh error".
 */
export const startLog = internalMutation({
  args: { message: v.string(), scope: v.optional(v.string()) },
  handler: async (ctx, { message, scope }) => {
    // Old rows have no scope and belong to the shared refresh lane.
    // A rep's run must neither lock nor mark the company refresh as running.
    const last = await ctx.db
      .query("refreshLog")
      .withIndex("by_scope_started", q => q.eq("scope", scope))
      .order("desc")
      .first();
    const STALE_MS = scope ? 5 * 60_000 : 90 * 1000;
    if (last && last.status === "running") {
      const age = Date.now() - last.startedAt;
      if (age < STALE_MS) {
        const secs = Math.max(1, Math.round((STALE_MS - age) / 1000));
        throw new Error(
          `REFRESH_IN_PROGRESS: a refresh started ${Math.round(age / 1000)}s ago is still running. It finishes on its own — the page updates automatically. Retry in ~${secs}s if nothing changes.`,
        );
      }
      // The previous run died without closing its log (action timeout or a
      // dropped connection). Close it out so status display stays truthful.
      await ctx.db.patch(last._id, {
        status: "error",
        finishedAt: Date.now(),
        message: "Timed out — superseded by a newer refresh.",
      });
    }
    return await ctx.db.insert("refreshLog", {
      startedAt: Date.now(),
      status: "running",
      scope,
      message,
    });
  },
});

export const finishLog = internalMutation({
  args: {
    id: v.id("refreshLog"),
    status: v.string(),
    message: v.string(),
    dataThrough: v.optional(v.string()),
    rows: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, { ...patch, finishedAt: Date.now() });
  },
});

/** Preview profiling: latest rep refresh duration, without exposing credentials. */
export const latestRepRefresh = internalQuery({
  args: { scope: v.string() },
  handler: async (ctx, { scope }) => {
    if (!scope.startsWith("rep:")) throw new Error("Rep scope required");
    const row = await ctx.db
      .query("refreshLog")
      .withIndex("by_scope_started", q => q.eq("scope", scope))
      .order("desc")
      .first();
    return row
      ? {
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          status: row.status,
          message: row.message,
        }
      : null;
  },
});

/** Phase checkpoint for refreshData so prod timings are queryable. */
export const progressLog = internalMutation({
  args: { id: v.id("refreshLog"), message: v.string() },
  handler: async (ctx, { id, message }) => {
    const row = await ctx.db.get(id);
    if (row && row.status === "running") await ctx.db.patch(id, { message });
  },
});
