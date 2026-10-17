import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // Product whitespace planning (Shyam, 2026-10-06): reps mark clinics as
  // eligible for a product family; whitespace = eligible but never ordered.
  productEligible: defineTable({
    sales: v.string(),
    clinic: v.string(),
    family: v.string(),
    at: v.number(),
  }).index("by_sales", ["sales"]),

  // Per-clinic weekly plan: sales-entered targets that feed the projection.
  clinicPlan: defineTable({
    clinic: v.string(),
    name: v.string(),
    targetRevenueWeek: v.number(),
    targetOrdersWeek: v.number(),
    updatedAt: v.number(),
  }).index("by_clinic", ["clinic"]),

  // Singleton configuration row.
  config: defineTable({
    key: v.string(), // "main"
    currentStart: v.string(),
    baselineStart: v.string(),
    baselineEnd: v.string(),
    currentEnd: v.string(),
    lagDays: v.number(),
    autoBaseline: v.boolean(),
    autoEnd: v.boolean(),
    baselineMode: v.optional(v.string()),
    /** Where the baseline window sits: "trailing" (91 days before the window, default), "best" (the best 91 days of data before the window) or "custom" (baselineStart..baselineEnd). */
    baselineSource: v.optional(v.string()),
    annualTarget: v.optional(v.number()),
    p75: v.optional(
      v.object({
        day: v.array(v.number()),
        week: v.number(),
        month: v.number(),
      }),
    ),
    gen: v.optional(v.number()),
    // Highest generation number ever handed out, including refreshes that
    // failed. Reused generations used to stack duplicate rows.
    genSeq: v.optional(v.number()),
    // Rep-picked windows ("rep:<email>" rows): recompute status.
    status: v.optional(v.string()), // "running" | "ready" | "error"
    reqStart: v.optional(v.string()),
    reqEnd: v.optional(v.string()),
    // True when the rep's end date was the latest data date when picked: the
    // nightly requeue then moves their end forward with the team window.
    followLatest: v.optional(v.boolean()),
    // Sums of baseRev / baseOrders over ALL of this generation's clinicMeta
    // rows (set at refresh). drill() needs them for the global baseline AOV
    // even when it reads only one rep's or team lead's clinics.
    baseRevAll: v.optional(v.number()),
    baseOrdersAll: v.optional(v.number()),
    error: v.optional(v.string()),
    requestedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // One row per successful unlock of the dashboard (self-reported work email
  // + shared password). Attribution trail, not authentication.
  accessLog: defineTable({
    email: v.string(),
    at: v.number(),
    agent: v.optional(v.string()),
  })
    .index("by_at", ["at"])
    .index("by_email", ["email"]),

  // Per-rep dashboard logins (Shyam, 2026-09-25): email + password that
  // locks the whole dashboard to one salesperson's book. Passwords are stored
  // as salted SHA-256; managed from the admin panel in Settings.
  repAccounts: defineTable({
    email: v.string(),
    rep: v.string(), // exact salesperson name as in clinicMeta.sales
    salt: v.string(),
    hash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  // Browser sessions for rep logins. The token is what the browser sends as
  // the `password` argument (prefixed `rs:`) on every data call.
  repSessions: defineTable({
    token: v.string(),
    email: v.string(),
    rep: v.string(),
    createdAt: v.number(),
    lastSeen: v.number(),
  }).index("by_token", ["token"]),

  // Small key/value facts about the deployment, e.g. the analytics service's
  // current public URL (it changes whenever a quick tunnel restarts).
  appMeta: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  refreshLog: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.string(), // running | ok | error
    scope: v.optional(v.string()), // main/snapshot share a lock; rep:<email> is independent
    message: v.string(),
    dataThrough: v.optional(v.string()),
    rows: v.optional(v.number()),
  })
    .index("by_started", ["startedAt"])
    .index("by_scope_started", ["scope", "startedAt"]),

  insights: defineTable({
    insightId: v.string(), // e.g. REV-2026-0914-003 — stable once assigned
    date: v.string(), // YYYY-MM-DD data-as-of date this snapshot represents
    domain: v.string(), // Revenue | Coverage | Retention | Product
    topic: v.string(), // short topic label, e.g. "AOV", "Call List"
    question: v.optional(v.string()), // the card's headline question (feed item's `q`) — shown as the card title; optional only for rows written before this field existed, backfilled on next generate
    focus: v.optional(v.string()), // feed.ts focus token — re-cuts the clinic drill list, same as AlertRail
    focusLabel: v.optional(v.string()), // drill panel label to show for that focus
    fact: v.string(),
    inference: v.string(),
    evidence: v.array(v.string()),
    confidence: v.string(), // Low | Medium | High
    relatedInsightIds: v.array(v.string()),
    action: v.string(),
    status: v.string(), // Monitoring | On Track | Informational | (user-set)
    tone: v.string(), // carried from the source feed card, for card styling
    teamLead: v.optional(v.string()), // undefined = company-wide (MVP scope)
    sourceFeedId: v.string(), // feed.ts FeedItem.id — links same signal across days
    seq: v.number(), // domain+day sequence used to build insightId
    edited: v.optional(v.array(v.string())), // field names a human edited
    // Snapshot cadence (Shyam, 2026-09-23): undefined/"daily" = the existing
    // per-refresh row; "weekly"/"monthly" are point-in-time snapshots of the
    // same question so its fields can be compared across time windows. Kept
    // distinct from the daily row so cadences never overwrite each other.
    cadence: v.optional(
      v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_source_teamLead", ["sourceFeedId", "teamLead"])
    .index("by_domain", ["domain"])
    .index("by_cadence_source", ["cadence", "sourceFeedId", "teamLead"])
    .index("by_cadence_date", ["cadence", "date"]),
});

export default schema;
