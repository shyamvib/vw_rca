import { v } from "convex/values";
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

/** Generated rows from the analytics service: insert new ones, update auto fields on existing ones. */
export const ingest = internalMutation({
  args: { rows: v.array(v.any()) },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let updated = 0;
    for (const r of rows as Array<Record<string, any>>) {
      const { _id, _creationTime, ...doc } = r;
      const existing = await ctx.db
        .query("insights")
        .filter(q => q.eq(q.field("insightId"), doc.insightId))
        .unique();
      if (!existing) {
        await ctx.db.insert("insights", doc as any);
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
