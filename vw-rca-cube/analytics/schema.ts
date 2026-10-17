import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // One row per calendar day (both baseline and current windows).
  dailyTotals: defineTable({
    date: v.string(), // YYYY-MM-DD
    orders: v.number(),
    revenue: v.number(),
    bundleOrders: v.number(),
    bundleRevenue: v.number(),
    // Distinct patients that day (absent on rows written before the traffic KPI).
    patients: v.optional(v.number()),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_date", ["date"])
    .index("by_gen", ["gen"]),

  // One row per calendar day per state.
  stateDaily: defineTable({
    date: v.string(),
    state: v.string(),
    revenue: v.number(),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_date", ["date"])
    .index("by_gen", ["gen"]),

  // Actual revenue per clinic cohort per day (current window only).
  cohortDaily: defineTable({
    date: v.string(),
    cohort: v.string(), // churned | new | retained_top20 | retained_rest | reactivated
    revenue: v.number(),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_date", ["date"])
    .index("by_gen", ["gen"]),

  // Baseline day-type revenue rates per cohort (per weekday / per weekend day).
  cohortBaseline: defineTable({
    cohort: v.string(),
    rates: v.array(v.number()), // expected revenue per calendar day, by weekday 0=Sun
    clinics: v.number(),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_cohort", ["cohort"])
    .index("by_gen", ["gen"]),

  // Current-window actuals per charge channel (wellProz, customerPay, ...).
  channelDaily: defineTable({
    date: v.string(),
    channel: v.string(),
    orders: v.number(),
    revenue: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_date", ["date"])
    .index("by_gen", ["gen"]),

  // Baseline day-type order/revenue rates per charge channel.
  channelBaseline: defineTable({
    channel: v.string(),
    rates: v.array(v.number()),
    ordRates: v.array(v.number()),
    gen: v.optional(v.number()),
  })
    .index("by_channel", ["channel"])
    .index("by_gen", ["gen"]),

  // Baseline day-type revenue rates per state.
  stateBaseline: defineTable({
    state: v.string(),
    rates: v.array(v.number()),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_state", ["state"])
    .index("by_gen", ["gen"]),

  // One row per clinic: identity + baseline day-type rates + cohort.
  clinicMeta: defineTable({
    clinic: v.string(),
    name: v.string(),
    state: v.string(),
    // ISO-2 country of the clinic's dominant billing geography, and the sales
    // supervisor / team lead that owns the clinic's rep.
    country: v.optional(v.string()),
    teamLead: v.optional(v.string()),
    sales: v.string(),
    cohort: v.string(),
    rev: v.array(v.number()),
    ord: v.array(v.number()),
    bRev: v.array(v.number()),
    bOrd: v.array(v.number()),
    // Baseline patient rates per weekday (absent before the traffic KPI).
    pat: v.optional(v.array(v.number())),
    baseRev: v.number(),
    baseOrders: v.number(),
    basePatients: v.optional(v.number()),
    health: v.optional(v.array(v.string())),
    pstatus: v.optional(v.array(v.string())),
    // Tenure fields behind the new-logo branch: first order ever, last order
    // in the current window, and the risk groups the clinic falls into.
    firstOrder: v.optional(v.string()),
    lastOrder: v.optional(v.string()),
    newGroups: v.optional(v.array(v.string())),
    // Distinct order-days this window (Shyam, 2026-09-28), same "one
    // calendar day = one order" definition as newClinicOrderSeq — used by
    // matchesFocus()'s newgrp:fN fallback so it agrees with the cached
    // stage tags above instead of drifting on raw transaction counts.
    windowOrderDays: v.optional(v.number()),
    // Year-to-date and trailing-13-week actuals for this one clinic, so the
    // year-end projection can be re-scoped to any state or salesperson (not
    // just team lead) by summing whichever clinics fall in that scope.
    ytdRevenue: v.optional(v.number()),
    ytdOrders: v.optional(v.number()),
    fwdRevenue: v.optional(v.number()),
    fwdOrders: v.optional(v.number()),
    // Precomputed monthly order cadence for the last 3 months of the current
    // window (oldest → newest), so the feed's "cheap top-20%"/"slipping" cards
    // don't need 3 extra full-table clinicPeriod collects at query time (that
    // pattern hit Convex's 32k-document read cap at production scale on
    // 2026-09-05 — see engineering notes). monthOrders = count of those months
    // with orders > 0.
    monthOrders: v.optional(v.number()),
    monthSeries: v.optional(v.array(v.number())),
    // RCA-computed clinic-health source inputs (2026-09-21 — replaces the
    // imported clinic_dimension[Note] text; see convex/flags.ts). All are
    // "as of" cfg.currentEnd (the refresh's reporting cutoff), never leaking
    // data past it, and independent of whichever periodId the dashboard is
    // browsing — same anchor the retired Power BI "Time Machine" used.
    // True last order date across the clinic's whole history (not just the
    // refresh window), used for churn/launch/slipping tenure flags.
    lastOrderAllTime: v.optional(v.string()),
    // Year-to-date VA-only order share (VA orders ÷ YTD orders); undefined
    // when the clinic has no YTD orders to divide by.
    vaYtdPct: v.optional(v.number()),
    // Lifetime (all-time, cutoff-bounded) revenue and fee/deduction rate
    // (consultation + markup + blood-draw fees ÷ lifetime revenue).
    lifetimeRevenue: v.optional(v.number()),
    lifetimeDeductionRate: v.optional(v.number()),
    // Last HubSpot touchpoint date (any type) mapped to this clinic via the
    // model's own hubspot_id<->contact_id relationship (~99% order coverage
    // — see refresh.ts); undefined when no touchpoint could be mapped
    // (blank hubspot_id on every one of the clinic's orders, or no
    // touchpoint row for that contact).
    lastTouchDate: v.optional(v.string()),
    // Whether ANY touchpoint could be mapped to this clinic at all — lets the
    // evaluator tell "never touched" apart from "we couldn't verify".
    touchDataAvailable: v.optional(v.boolean()),
    // Earliest HubSpot signup among the clinic's providers (Shyam,
    // 2026-09-28, Provider Retention Funnel): MIN(customer_signup_time)
    // across the clinic's order rows. Undefined when unreadable.
    signupDate: v.optional(v.string()),
    // DEPRECATED, never written or read (Power BI Note import removed
    // 2026-10-12). Kept optional so rows from older refresh generations
    // still validate until they are pruned.
    importedHealthFlags: v.optional(v.array(v.string())),
    // Buying Overdue inputs (business days, as of cutoff); undefined when
    // the clinic has <3 distinct order dates.
    medianGapBd: v.optional(v.number()),
    bdSinceLastOrder: v.optional(v.number()),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_clinic", ["clinic"])
    .index("by_gen", ["gen"])
    // Scoped reads (a rep's or team lead's own clinics) so drill() does not
    // have to read the whole table to filter it in memory.
    .index("by_gen_sales", ["gen", "sales"])
    .index("by_gen_lead", ["gen", "teamLead"]),

  // Current-window actuals per clinic per period (all / month / week / day).
  // expectedRevenue/expectedOrdersP75 are the Power BI-equivalent rolling
  // P75 baseline (trailing 13 weeks / 3 months, same formula as
  // dateUtils.ts's trailingDayP75/trailingWeekP75/trailingMonthP75),
  // precomputed per clinic per period at refresh time (2026-09-28, Thiru:
  // RSM/team-lead/clinic scoped views should match Power BI Revenue
  // Intelligence instead of the older static per-clinic day-of-week-rate ×
  // flat P75 scalar). Merged onto this table rather than a separate one so
  // drill()'s existing per-clinic collect doesn't grow a third full scan —
  // adding one did push a couple of callers (wins.ts's company-wide drill)
  // over Convex's 16MB per-query byte cap.
  clinicPeriod: defineTable({
    periodId: v.string(),
    clinic: v.string(),
    revenue: v.number(),
    orders: v.number(),
    bundleRevenue: v.number(),
    bundleOrders: v.number(),
    // Sum of daily distinct patients (absent before the traffic KPI).
    patients: v.optional(v.number()),
    expectedRevenue: v.optional(v.number()),
    expectedOrdersP75: v.optional(v.number()),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_period", ["periodId"])
    .index("by_gen", ["gen"])
    .index("by_gen_period", ["gen", "periodId"])
    .index("by_gen_period_clinic", ["gen", "periodId", "clinic"]),

  // Same rolling P75 baseline as clinicPeriod's expectedRevenue, but
  // computed from the team lead's / RSM's OWN aggregated daily revenue
  // (summed across every clinic in that scope, per day, BEFORE taking the
  // trailing P75) — not a sum of individual clinic baselines. Percentile
  // does not distribute over a sum, so this is the only way an RSM/team-lead
  // headline number matches what Power BI's RSM-filtered measure shows
  // (validated 2026-09-28). Small (a few dozen scopes × ~140 periods), so
  // its own table is fine.
  leadPeriodBaseline: defineTable({
    periodId: v.string(),
    lead: v.string(),
    expectedRevenue: v.number(),
    expectedOrders: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_period", ["gen", "periodId"]),

  // Same as leadPeriodBaseline, keyed by individual sales rep (RSM) instead
  // of team lead.
  // One row per period (Shyam, 2026-10-16 baseline / goal redesign). Baseline = the mean run rate over the baseline
  // window (additive across clinic, rep, lead, cohort, state, company). Goal = the company's rolling P75 for the
  // period. goalFactor = goal / baseline: every entity's goal is its baseline x this one factor, so goals add up
  // exactly and "ambition" (goal minus baseline) splits by baseline share.
  periodGoal: defineTable({
    periodId: v.string(),
    goalRevenue: v.number(),
    goalOrders: v.number(),
    baseRevenue: v.number(),
    baseOrders: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_period", ["gen", "periodId"]),

  salesPeriodBaseline: defineTable({
    periodId: v.string(),
    sales: v.string(),
    expectedRevenue: v.number(),
    expectedOrders: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_period", ["gen", "periodId"]),

  // Top-down allocated plan per geography (sales="") and per rep×geo cell
  // [Shyam, 2026-10-12]: geo rows sum to company; cells sum to their geo.
  geoPeriodBaseline: defineTable({
    periodId: v.string(),
    geo: v.string(),
    sales: v.string(),
    expectedRevenue: v.number(),
    expectedOrders: v.number(),
    actualRevenue: v.optional(v.number()),
    geoJson: v.optional(v.string()), // sales="#": compact {geo:[exp,act]} for bridge
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_sales", ["gen", "sales"])
    .index("by_gen_period", ["gen", "periodId"]),

  // Baseline revenue/order rates per product family, by weekday.
  familyBaseline: defineTable({
    // "all" | "bundle" | "nonbundle" — which order universe this row covers.
    scope: v.optional(v.string()),
    family: v.string(),
    rates: v.array(v.number()), // expected revenue per calendar day, weekday 0=Sun
    ordRates: v.array(v.number()), // expected orders per calendar day
    baseRev: v.number(),
    baseOrders: v.number(),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_family", ["family"])
    .index("by_gen", ["gen"]),

  // Current-window actuals per product family per period.
  familyPeriod: defineTable({
    periodId: v.string(),
    scope: v.optional(v.string()),
    family: v.string(),
    revenue: v.number(),
    orders: v.number(),
    // Refresh generation; readers only see rows from the current one.
    gen: v.optional(v.number()),
  })
    .index("by_period", ["periodId"])
    .index("by_gen", ["gen"])
    .index("by_gen_period", ["gen", "periodId"]),

  // Product-family series for one team lead: one doc per lead × scope × family,
  // holding the whole current window as a compact day array. Kept as series
  // (not per-period rows) so a lead-scoped family list for any period costs a
  // few hundred document reads instead of tens of thousands.
  familyLeadSeries: defineTable({
    lead: v.string(),
    scope: v.string(), // all | bundle | nonbundle
    family: v.string(),
    days: v.array(
      v.object({ d: v.string(), rev: v.number(), ord: v.number() }),
    ),
    rates: v.array(v.number()),
    ordRates: v.array(v.number()),
    baseRev: v.number(),
    baseOrders: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_lead", ["gen", "lead"]),

  // Same shape as familyLeadSeries, keyed by individual sales rep instead of
  // team lead. Built from the identical famBase/famDays rows in refresh.ts
  // (just grouped by rep instead of lead), so a rep's numbers always roll up
  // into their lead's numbers. Added 2026-09-04 so the product-mix panel can
  // re-scope to a single sales rep, matching the rest of the dashboard.
  familySalesSeries: defineTable({
    sales: v.string(),
    scope: v.string(), // all | bundle | nonbundle
    family: v.string(),
    days: v.array(
      v.object({ d: v.string(), rev: v.number(), ord: v.number() }),
    ),
    rates: v.array(v.number()),
    ordRates: v.array(v.number()),
    baseRev: v.number(),
    baseOrders: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_sales", ["gen", "sales"]),

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

  // Year-end projection primitives (one row per refresh generation).
  projection: defineTable({
    ytdStart: v.string(),
    ytdEnd: v.string(),
    ytdRevenue: v.number(),
    ytdOrders: v.number(),
    // Forward run rate per weekday (0=Sun), from the trailing 13 weeks of actuals.
    fwdRates: v.array(v.number()),
    fwdOrdRates: v.array(v.number()),
    // One entry per remaining calendar day of the year.
    days: v.array(
      v.object({
        date: v.string(),
        factor: v.number(), // prior-year seasonal factor for that calendar day
        rev: v.number(),
        ord: v.number(),
      }),
    ),
    // Days the prior year says are effectively closed (holidays / shutdown).
    holidays: v.array(v.string()),
    // Per-team-lead year-to-date actuals and share of the forward run rate,
    // so the projection can be re-expressed for one lead's book.
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
    gen: v.optional(v.number()),
  }).index("by_gen", ["gen"]),

  // Baseline-window counts of the SAME new-logo groups used at level 2/3 of
  // the new-clinics branch, so each group reads as up or down rather than as a
  // raw count. lead "" is the whole book.
  newLogoBaseline: defineTable({
    key: v.string(), // churn45 | lapsed14 | active | o1 | o2 | o3 | "churn45|o1" | __all__
    lead: v.string(),
    clinics: v.number(),
    orders: v.number(),
    revenue: v.number(),
    /** Calendar days in the baseline and current windows, for pace-adjustment. */
    baseDays: v.number(),
    curDays: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_lead", ["gen", "lead"]),

  // Trailing-12-month VA (VA-only order, sample_test_type_v2="VA") stats per
  // clinic, for the $400 Foundation Zoomer launch target list (Shyam,
  // 2026-09-15). Refreshed alongside everything else; filtered/sorted at
  // query time so the AOV and orders/week thresholds can move without a
  // re-pull.
  vaClinicTarget: defineTable({
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
    gen: v.optional(v.number()),
  })
    .index("by_clinic", ["clinic"])
    .index("by_gen", ["gen"]),

  // Per-new-clinic order-sequence (Shyam, 2026-09-28: "Provider Retention
  // Funnel"): the first up-to-5 order DAYS (date + that day's revenue) for
  // every clinic whose first-ever order falls inside the refresh's main
  // window — a superset of every quarter/custom sub-period's own "new
  // clinics" cohort, since a sub-period's cohort can only be narrower than
  // the full refresh window. `signupDate` is the clinic's earliest HubSpot
  // signup (MIN(customer_signup_time) across its orders); undefined when no
  // signup time could be read for that clinic's rows. Small table (only new
  // clinics, not the whole book), so a full by_gen collect at query time is
  // cheap.
  newClinicOrderSeq: defineTable({
    clinic: v.string(),
    name: v.string(),
    sales: v.string(),
    teamLead: v.optional(v.string()),
    firstOrder: v.string(),
    signupDate: v.optional(v.string()),
    orderDates: v.array(v.string()),
    orderRevenue: v.array(v.number()),
    // Sorted Call/Meeting touchpoint dates in-window (Shyam, 2026-09-29
    // funnel filter); [] means none mapped, not "definitely never touched"
    // (same caveat clinicMeta.touchDataAvailable uses elsewhere).
    touchDates: v.optional(v.array(v.string())),
    // Sorted Clinical Activity (consult/VCT) touchpoint dates in-window
    // (Shyam, 2026-09-29): `touchpoint_category = "Clinical Activity"` —
    // confirmed live; no literal "VCT" field exists anywhere in the model.
    clinicalTouchDates: v.optional(v.array(v.string())),
    gen: v.optional(v.number()),
  }).index("by_gen", ["gen"]),

  // Daily lead-signup counts by owning salesperson (customers_bq[sales_id],
  // MIN(customer_signup_time) per lead), for the Provider Retention Funnel's
  // top "Signup" bar — a broader population than clinics that ever ordered.
  // One row per lead signup in the refresh window (Shyam, 2026-10-13):
  // lets the Sankey / funnel list the signups that never placed order 1.
  signupLead: defineTable({
    date: v.string(),
    sales: v.string(),
    customerId: v.string(),
    name: v.string(),
    state: v.optional(v.string()),
    firstOrder: v.optional(v.string()),
    clinic: v.optional(v.string()),
    practice: v.optional(v.string()),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_sales", ["gen", "sales"]),

  signupDaily: defineTable({
    date: v.string(),
    sales: v.string(),
    count: v.number(),
    gen: v.optional(v.number()),
  })
    .index("by_gen", ["gen"])
    .index("by_gen_sales", ["gen", "sales"]),

  // Cached on-demand drill results (family → clinics, clinic → customers).
  drillCache: defineTable({
    key: v.string(),
    payload: v.string(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

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

  // An in-progress independent refresh can reserve a generation before its
  // config pointer is switched. The team cleanup must never delete it.
  generationLeases: defineTable({
    gen: v.number(),
    createdAt: v.number(),
  }).index("by_gen", ["gen"]),

  // Structured Business Feed insight cards (Shyam's format: fact / inference
  // / evidence / confidence / related / action / status). Auto-populated on
  // every refresh from the same feed items AlertRail already renders, but
  // persisted (not gen-scoped — these survive refreshes so history and
  // "related insights" links accumulate over time) and independently
  // editable. Never regenerate a field listed in `edited`.
  // Gut Zoomer / Total Tox STOPPED clinics per month-end (convex/familyStops.ts).
  // Replace-all after each live refresh; not gen-scoped.
  // First order date per product family (snapshot build step, analytics/familyLaunch.ts): drives "new product releases".
  familyLaunch: defineTable({
    family: v.string(),
    firstOrder: v.string(),
    orders: v.number(),
  }).index("by_family", ["family"]),

  familyStops: defineTable({
    month: v.string(),
    family: v.string(),
    clinic: v.string(),
    name: v.string(),
    state: v.string(),
    sales: v.string(),
    teamLead: v.optional(v.string()),
    priorOrders: v.number(),
    lastOrder: v.string(),
    resumedOn: v.string(),
    priorStart: v.string(),
    recentStart: v.string(),
    asOf: v.string(),
    builtAt: v.number(),
  }).index("by_month", ["month"]),

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
