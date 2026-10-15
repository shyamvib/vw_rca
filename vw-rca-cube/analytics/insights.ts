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

type Mapping = { domain: string; topic: string; prefix: string };

const TAG_MAP: Record<string, Mapping> = {
  Headline: { domain: "Revenue", topic: "Overview", prefix: "REV" },
  Trend: { domain: "Revenue", topic: "Momentum", prefix: "REV" },
  Calendar: { domain: "Revenue", topic: "Calendar", prefix: "REV" },
  "Call list": { domain: "Coverage", topic: "Call List", prefix: "COV" },
  "Churn risk": { domain: "Retention", topic: "Silent Clinics", prefix: "RET" },
  Price: { domain: "Revenue", topic: "AOV", prefix: "REV" },
  "Bright spots": { domain: "Revenue", topic: "Growth", prefix: "REV" },
  "Health notes": { domain: "Retention", topic: "Health Flags", prefix: "RET" },
  "Target list": { domain: "Coverage", topic: "Target List", prefix: "COV" },
  "Save list": { domain: "Retention", topic: "Intervention", prefix: "RET" },
  People: { domain: "Coverage", topic: "Sales Coverage", prefix: "COV" },
  Portfolio: { domain: "Product", topic: "Portfolio", prefix: "PRD" },
  Product: { domain: "Product", topic: "Family Mix", prefix: "PRD" },
  Substitution: { domain: "Product", topic: "Substitution", prefix: "PRD" },
  Geography: { domain: "Revenue", topic: "Geography", prefix: "REV" },
  Channel: { domain: "Revenue", topic: "Channel", prefix: "REV" },
  Mix: { domain: "Revenue", topic: "Bundle Mix", prefix: "REV" },
};
const DEFAULT_MAP: Mapping = { domain: "Revenue", topic: "General", prefix: "REV" };
const mappingFor = (tag: string): Mapping => TAG_MAP[tag] ?? DEFAULT_MAP;

const INFERENCE_BY_TAG: Record<string, (tone: string) => string> = {
  Headline: tone =>
    tone === "good"
      ? "Revenue is running ahead of the baseline run rate."
      : "Revenue is trailing the baseline run rate — this needs a lever, not a wait-and-see.",
  Trend: () =>
    "Whether the last 14 days ran better or worse than the 14 before them shows if recent effort is closing the gap or the slide is still active.",
  Calendar: () =>
    "A single bad day usually means a holiday or weekend, not a demand problem — confirm before reading it as a rep issue.",
  "Call list": () =>
    "These clinics carry the largest dollar gap and are the highest-leverage calls available this week.",
  "Churn risk": () =>
    "These accounts placed zero orders after actively ordering in the baseline — this is a win-back motion, not a nudge.",
  Price: () =>
    "Ticket size is falling while these clinics keep ordering, pointing to a mix/pricing shift rather than a demand drop.",
  "Bright spots": () =>
    "These clinics are the clearest proof that outreach or positioning is working right now — worth understanding what changed.",
  "Health notes": () =>
    "This flag concentrates a large share of the shortfall in a small number of clinics.",
  "Target list": () =>
    "The top 20% of flagged clinics by dollar drag account for a disproportionate share of the total gap.",
  "Save list": () =>
    "These accounts are decaying but have not broken rhythm yet — a call now can still hold them before they do.",
  People: () =>
    "Shortfall is unevenly distributed across owners; the largest book is worth a direct coaching conversation.",
  Portfolio: () =>
    "Stopped test lines behind these clinics may be a lab-ops issue rather than a sales/relationship one — worth checking before acting.",
  Product: () =>
    "This family's movement is large enough to matter at the whole-book level, not just clinic noise.",
  Substitution: () =>
    "One product's decline may be offset by growth in a related one — the net, not the gross drop, is the real signal.",
  Geography: () =>
    "A state flipping from growth to decline usually points to something local — a rep, a clinic, or a seasonal factor — not a company-wide shift.",
  Channel: () =>
    "A named ordering channel moving independently of the rest of the book points to a channel-specific cause.",
  Mix: () =>
    "Bundle share moves together with AOV — track the two side by side rather than in isolation.",
};
const inferenceFor = (tag: string, tone: string) =>
  (INFERENCE_BY_TAG[tag] ?? (() => "Movement here is worth tracking against the next refresh."))(tone);

const ACTION_BY_TAG: Record<string, string> = {
  Headline: "Open the shortfall tree (state, cohort, product lenses) to locate the driver before setting next week's targets.",
  Trend: "If the gap is widening, escalate the call list this week; if narrowing, hold the current motion and recheck next refresh.",
  Calendar: "Confirm the date against the holiday calendar before flagging it as a rep or region issue.",
  "Call list": "Assign this list to the relevant reps this week; recheck against the next refresh.",
  "Churn risk": "Route each silent clinic to its owner for a win-back call within the week.",
  Price: "Have reps confirm whether patients self-selected a single test or were downsold, and reinforce bundle positioning.",
  "Bright spots": "Capture what changed at these clinics (offer, cadence, rep motion) and try to replicate it elsewhere.",
  "Health notes": "Work this flag top-down — clearing the largest-dollar clinics first removes the most shortfall per call.",
  "Target list": "Lead the weekly target list with this slice; it returns the most dollars per call made.",
  "Save list": "Call these accounts this week, before the slide becomes a full broken-rhythm case.",
  People: "Discuss the shortfall with the owner directly; compare their % of book against peers before assuming it's a book-size issue.",
  Portfolio: "Check which test lines went STOPPED and confirm with lab ops whether it's operational or a real portfolio loss.",
  Product: "Confirm this family's movement against the substitution card before writing it into messaging.",
  Substitution: "Confirm the substitution story with reps before treating the decline as a net loss.",
  Geography: "Check state-specific factors (rep coverage, local competitor, seasonal effects) before treating this as company-wide.",
  Channel: "Loop in the channel owner if the movement doesn't self-correct within a week.",
  Mix: "Track alongside the AOV card; the two should move together.",
};
const actionFor = (tag: string) => ACTION_BY_TAG[tag] ?? "Monitor against the next refresh.";

const statusFor = (tone: string): string => {
  if (tone === "good") return "On Track";
  if (tone === "info") return "Informational";
  return "Monitoring"; // alert | watch
};

const confidenceFor = (tag: string, evidenceCount: number): string => {
  const HIGH_TAGS = new Set(["Headline", "Trend", "Channel"]);
  if (HIGH_TAGS.has(tag)) return "High";
  if (evidenceCount === 0) return "Low";
  return "Medium";
};

const evidenceFrom = (detail?: string): string[] => {
  if (!detail) return [];
  return detail
    .split("|")
    .map(s => s.trim())
    .filter(Boolean);
};

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
      inference: inferenceFor(item.tag, item.tone),
      evidence,
      confidence: confidenceFor(item.tag, evidence.length),
      action: actionFor(item.tag),
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
