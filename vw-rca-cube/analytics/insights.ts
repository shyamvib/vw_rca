import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { build, type FeedItem } from "./feed";

/**
 * Structured Business Feed insights (Shyam, 2026-09-23): every feed card
 * AlertRail already computes also gets written here as a persisted,
 * addressable record — Insight ID, Date, Domain, Topic, FACT, INFERENCE,
 * EVIDENCE, CONFIDENCE, RELATED INSIGHTS, ACTION, STATUS — auto-populated on
 * each refresh, editable afterward. Fields a human edits are protected from
 * being overwritten by the next auto-run (see `edited`).
 *
 * MVP scope: company-wide only (teamLead undefined), matching the default
 * feed view. Per-team-lead insight rows are a straightforward follow-on
 * (same generator, pass teamLead through) once this shape is approved.
 */

import { mappingFor, inferenceFor, actionFor, statusFor, confidenceFor, evidenceFrom } from "./feedItems";

/**
 * Build/refresh a cadence's insight rows from a feed computation.
 * Idempotent per (date, sourceFeedId, cadence): re-running the same
 * date+cadence updates auto-populated fields in place (unless a field was
 * hand-edited) instead of creating duplicates. Called from refresh.ts after
 * a data refresh (daily) or a historical snapshot (weekly/monthly) commits.
 *
 * `cadence` defaults to "daily" (the original per-refresh row, kept
 * backward-compatible with rows written before cadence existed — those have
 * `cadence: undefined` and are treated as daily). `configKey` lets a
 * historical snapshot compute the feed off a "snapshot" config row instead
 * of the live "main" one (see refresh.ts `refreshSnapshot`).
 */
export async function generateInsights(
  ctx: MutationCtx,
  date: string,
  opts?: { cadence?: "daily" | "weekly" | "monthly"; configKey?: string },
) {
  const cadence = opts?.cadence ?? "daily";
  const configKey = opts?.configKey;
  const feed = await build(ctx, { configKey });
  if (!feed.ready) return { written: 0 };

  // Daily rows keep the original insightId shape for backward compatibility;
  // weekly/monthly snapshots embed the cadence so they never collide with a
  // daily row (or each other) minted on the same calendar date.
  const cadenceTag = cadence === "weekly" ? "W" : cadence === "monthly" ? "M" : "";
  const cadenceMatch = (r: { cadence?: string }) =>
    cadence === "daily" ? !r.cadence || r.cadence === "daily" : r.cadence === cadence;

  const seqByDomain = new Map<string, number>();
  // Deterministic order: use the same order feed.ts emits items in.
  for (const item of feed.items as FeedItem[]) {
    const { domain, topic, prefix } = mappingFor(item.tag);
    const sameSignal = await ctx.db
      .query("insights")
      .withIndex("by_source_teamLead", q =>
        q.eq("sourceFeedId", item.id).eq("teamLead", undefined),
      )
      .collect();
    const existing = sameSignal.find(r => r.date === date && cadenceMatch(r));

    const evidence = evidenceFrom(item.detail);
    const edited = new Set(existing?.edited ?? []);
    const now = Date.now();

    // Related insights: most recent prior rows for the same signal *and the
    // same cadence* — a weekly card's history should compare to other weekly
    // snapshots, not to the daily row minted the same week.
    const related = sameSignal
      .filter(r => r.date < date && cadenceMatch(r) && r.insightId !== existing?.insightId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 2)
      .map(r => r.insightId);

    const autoFields = {
      domain,
      topic,
      question: item.q,
      focus: item.focus,
      focusLabel: item.focusLabel,
      fact: item.a,
      inference: inferenceFor(item.tag, item.tone, item.id),
      evidence,
      confidence: confidenceFor(item.tag, evidence.length),
      action: actionFor(item.tag, item.id),
      status: statusFor(item.tone),
      tone: item.tone,
      relatedInsightIds: related,
    };
    // Only ACTION, STATUS and CONFIDENCE are human-editable (Shyam,
    // 2026-09-23) — everything else always tracks the live feed computation.
    // Keep any hand-edited field's current value instead of overwriting it.
    const patch: Record<string, unknown> = { ...autoFields, cadence };
    for (const f of edited) if (existing && f in existing) patch[f] = (existing as Record<string, unknown>)[f];

    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      continue;
    }

    const seq = (seqByDomain.get(domain) ?? 0) + 1;
    seqByDomain.set(domain, seq);
    const insightId = `${prefix}-${cadenceTag ? `${cadenceTag}-` : ""}${date.slice(0, 4)}-${date.slice(5, 7)}${date.slice(8, 10)}-${String(seq).padStart(3, "0")}`;
    await ctx.db.insert("insights", {
      insightId,
      date,
      sourceFeedId: item.id,
      seq,
      teamLead: undefined,
      cadence,
      edited: [],
      createdAt: now,
      updatedAt: now,
      ...autoFields,
    });
  }
  return { written: feed.items.length };
}

export const generateFromRefresh = internalMutation({
  args: {
    date: v.string(),
    cadence: v.optional(
      v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    ),
    configKey: v.optional(v.string()),
  },
  handler: async (ctx, { date, cadence, configKey }) =>
    await generateInsights(ctx, date, { cadence, configKey }),
});
