import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { gatedMutation, gatedQuery } from "./gated";

/**
 * Structured Business Feed insights (Shyam, 2026-09-23): persisted, addressable
 * cards (Insight ID, Date, Domain, Topic, FACT, INFERENCE, EVIDENCE, CONFIDENCE,
 * RELATED INSIGHTS, ACTION, STATUS). Phase 3: the analytics service generates
 * them on each snapshot build (analytics/insights.ts) and pushes them here with
 * `ingest`, so history accumulates and human edits (ACTION / STATUS / CONFIDENCE)
 * survive. A field listed in `edited` is never overwritten by an ingest.
 */

/**
 * Generated rows from the analytics service: insert new ones, update auto fields on existing ones.
 *
 * Each row is found through the `by_date` index, once per date in the batch. It used to be a `.filter()` on insightId, which scans the
 * whole table for every row; with 40 rows per call that passed Convex's per-function read limit once the table grew, the push failed
 * ("consider using more selective index range expressions"), and with it the whole snapshot rebuild. An insight id carries its date, so
 * the rows of that date are all a lookup ever needs.
 */
export const ingest = internalMutation({
  args: { rows: v.array(v.any()) },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let updated = 0;
    const byId = new Map<string, Doc<"insights">>();
    const loaded = new Set<string>();
    const load = async (date: string) => {
      if (loaded.has(date)) return;
      loaded.add(date);
      for (const d of await ctx.db.query("insights").withIndex("by_date", q => q.eq("date", date)).collect()) byId.set(d.insightId, d);
    };
    for (const r of rows as Array<Record<string, any>>) {
      const { _id, _creationTime, ...doc } = r;
      if (typeof doc.date === "string") await load(doc.date);
      // A row with no date (never produced by the service) falls back to the old scan, one row at a time.
      const existing =
        byId.get(doc.insightId) ??
        (typeof doc.date === "string"
          ? null
          : await ctx.db.query("insights").filter(q => q.eq(q.field("insightId"), doc.insightId)).unique());
      if (!existing) {
        const id = await ctx.db.insert("insights", doc as any);
        const made = await ctx.db.get(id);
        if (made) byId.set(made.insightId, made);
        inserted++;
        continue;
      }
      const patch: Record<string, unknown> = { ...doc };
      delete patch.createdAt;
      for (const f of existing.edited ?? []) delete patch[f];
      delete patch.edited;
      await ctx.db.patch(existing._id, patch);
      updated++;
    }
    return { inserted, updated };
  },
});

/** Latest (or a specific date's) insight cards for one cadence. Defaults to
 * "daily" — the original per-refresh view. Weekly/monthly cadences (Shyam,
 * 2026-09-23) are separate snapshot timelines: same questions, tracked at a
 * controlled cadence instead of every refresh, so FACT/INFERENCE/EVIDENCE/
 * CONFIDENCE/ACTION/STATUS can be compared across time windows. */
export const list = gatedQuery({
  args: {
    date: v.optional(v.string()),
    cadence: v.optional(
      v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    ),
  },
  handler: async (ctx, { date, cadence }) => {
    const wantCadence = cadence ?? "daily";
    let targetDate = date;
    if (!targetDate) {
      if (wantCadence === "daily") {
        targetDate = (await ctx.db.query("insights").order("desc").first())?.date;
      } else {
        targetDate = (
          await ctx.db
            .query("insights")
            .withIndex("by_cadence_date", q => q.eq("cadence", wantCadence))
            .order("desc")
            .first()
        )?.date;
      }
    }
    if (!targetDate) return { ready: false as const, date: null, items: [] };
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_date", q => q.eq("date", targetDate))
      .collect();
    const items = rows.filter(r => (r.cadence ?? "daily") === wantCadence);
    return {
      ready: true as const,
      date: targetDate,
      items: items.sort((a, b) => a.insightId.localeCompare(b.insightId)),
    };
  },
});

/** Distinct snapshot dates available for a cadence, newest first — drives the
 * "compare over time" date picker for Weekly/Monthly. */
export const dates = gatedQuery({
  args: {
    cadence: v.union(v.literal("weekly"), v.literal("monthly")),
  },
  handler: async (ctx, { cadence }) => {
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_cadence_date", q => q.eq("cadence", cadence))
      .collect();
    return [...new Set(rows.map(r => r.date))].sort((a, b) => (a < b ? 1 : -1));
  },
});

/** Full history of one question (same sourceFeedId) at one cadence, oldest
 * first — how FACT/INFERENCE/EVIDENCE/CONFIDENCE/ACTION/STATUS moved over
 * successive snapshots. */
export const history = gatedQuery({
  args: {
    sourceFeedId: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
  },
  handler: async (ctx, { sourceFeedId, cadence }) => {
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_source_teamLead", q =>
        q.eq("sourceFeedId", sourceFeedId).eq("teamLead", undefined),
      )
      .collect();
    return rows
      .filter(r => (r.cadence ?? "daily") === cadence)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});

/** Human edit to one or more fields on an existing insight. Only ACTION,
 * STATUS and CONFIDENCE are editable (Shyam, 2026-09-23) — FACT/INFERENCE/
 * EVIDENCE/question always track the live feed computation. Marks the
 * edited fields so the next auto-generation leaves them alone. */
export const update = gatedMutation({
  args: {
    insightId: v.string(),
    patch: v.object({
      confidence: v.optional(v.string()),
      action: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { insightId, patch }) => {
    const row = await ctx.db
      .query("insights")
      .filter(q => q.eq(q.field("insightId"), insightId))
      .unique();
    if (!row) throw new Error("Insight not found.");
    const editedFields = new Set(row.edited ?? []);
    for (const k of Object.keys(patch)) editedFields.add(k);
    await ctx.db.patch(row._id, {
      ...patch,
      edited: [...editedFields],
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
