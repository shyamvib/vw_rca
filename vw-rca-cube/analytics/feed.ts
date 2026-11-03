import { loadCfg } from "./config";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { drill } from "./clinics";
import {
  windowP75, dow, eachDay } from "./dateUtils";
import { gatedQuery, scopedAction, scopedQuery } from "./gated";
import { loadStops } from "./familyStops";
import { MONEY, INT, offsetFeedItem, vaFeedItem, gzLossItem, baseLabelOf, OFFSET_PAIRS, VA_MIN_AOV, VA_MIN_ORDERS_PER_WEEK, mappingFor, inferenceFor, actionFor, REP_ACTION, statusFor, confidenceFor, evidenceFrom } from "./feedItems";
import { salesFamilyRows } from "./leadFamilies";
import { createJiraIssue, jiraConfig } from "./jira";
import { isCompanyLead, isTeamScope, repsInScope, teamOf } from "./scope";

declare const process: { env: Record<string, string | undefined> };

/**
 * Relay target for "raise a question" in the Business Feed (Design A). This
 * is a Viktor event-trigger webhook (server-side only, never shipped to the
 * client) whose subscribed agent posts the question + asker email to
 * #internal-test (Slack channel C0C0AEEGB6H). Rotate by creating a new
 * trigger at /vw-rca/raise-question and swapping this URL — see
 * skills/integrations/microsoft_power_bi/references/vw_rca_engineering_notes.md.
 */
const RAISE_QUESTION_WEBHOOK_URL = process.env.RAISE_QUESTION_WEBHOOK_URL ?? "";

/**
 * The alert rail: the dashboard's numbers turned into a short list of
 * question-and-answer cards — what is happening, what is worth attending to
 * right now, and what is going the right way. Everything is derived from the
 * same stored tables the tree uses, so the feed can never disagree with it.
 */

export type FeedItem = {
  id: string;
  tag: string; // grouping label shown on the card
  tone: "alert" | "watch" | "good" | "info";
  q: string;
  a: string;
  detail?: string;
  /** Clinic cohort this card counted; the drill list below re-cuts to it. */
  focus?: string;
  focusLabel?: string;
};

const PLAIN = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${Math.round(a / 1_000)}K`;
  return `$${Math.round(a)}`;
};

export async function build(
  ctx: QueryCtx,
  args?: { teamLead?: string; configKey?: string },
): Promise<{
  ready: boolean;
  items: FeedItem[];
  generatedFor?: string;
}> {
  const teamLead = args?.teamLead;
  // Historical insight snapshots (Shyam, 2026-09-23) point this at a
  // "snapshot" config row instead of "main" so backfilling weekly/monthly
  // history never touches the live dashboard's window.
  const configKey = args?.configKey;
  const cfg = await loadCfg(ctx, configKey);
  if (!cfg) return { ready: false, items: [] };
  const gen = cfg.gen ?? 0;

  const daily = await ctx.db
    .query("dailyTotals")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const stateBaseline = await ctx.db
    .query("stateBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const cohortBaseline = await ctx.db
    .query("cohortBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const famBase = await ctx.db
    .query("familyBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const famPeriod = await ctx.db
    .query("familyPeriod")
    .withIndex("by_gen_period", q => q.eq("gen", gen).eq("periodId", "all"))
    .collect();
  if (
    daily.length === 0 ||
    stateBaseline.length === 0 ||
    cohortBaseline.length === 0
  ) {
    return { ready: false, items: [] };
  }

  const p75f = windowP75(cfg);
  const days = eachDay(cfg.currentStart, cfg.currentEnd);
  // Expected revenue per weekday for the whole book = sum of the state rates.
  const rateByDow = [0, 0, 0, 0, 0, 0, 0];
  for (const s of stateBaseline) {
    for (let i = 0; i < 7; i++) rateByDow[i] += s.rates[i] ?? 0;
  }
  const expectedOn = (d: string) => (rateByDow[dow(d)] ?? 0) * p75f;

  const actualOn = new Map(daily.map(d => [d.date, d]));
  let expected = 0;
  let actual = 0;
  let orders = 0;
  let bundleRev = 0;
  for (const d of days) {
    expected += expectedOn(d);
    const a = actualOn.get(d);
    actual += a?.revenue ?? 0;
    orders += a?.orders ?? 0;
    bundleRev += a?.bundleRevenue ?? 0;
  }
  const delta = actual - expected;
  const items: FeedItem[] = [];

  // Clinic level: worst offenders, quiet churn, bright spots. Fetched before
  // the headline cards below because a team-lead scope reads its totals off
  // these rows instead of the company-wide daily tables (see note there).
  const clinicRows = await drill(ctx, {
    periodId: "all",
    lens: "total",
    unlimited: true,
    teamLead,
    configKey,
  });
  const rows = clinicRows.rows ?? [];

  if (!teamLead) {
    // Company-wide headline/trend/day cards need day-grain totals, which are
    // only stored at the whole-book level (`dailyTotals` has no per-clinic or
    // per-team-lead breakdown) — so these three only run unscoped. A scoped
    // book gets an equivalent headline built from its own clinic rows below
    // instead (see the "headline-scoped" card).
    items.push({
      id: "headline",
      tag: "Headline",
      tone: delta < 0 ? "alert" : "good",
      q: "Where do we stand right now?",
      a: `${MONEY(delta)} against the baseline run rate over ${days.length} days — ${PLAIN(actual)} actual vs ${PLAIN(expected)} expected.`,
      detail: `${cfg.currentStart} → ${cfg.currentEnd}, measured against ${cfg.baselineStart} → ${cfg.baselineEnd}.`,
    });

    // Is it still bleeding? Last 14 days vs the 14 before them.
    const tail = days.slice(-14);
    const prev = days.slice(-28, -14);
    const dsum = (arr: string[]) =>
      arr.reduce(
        (acc, d) => {
          acc.a += actualOn.get(d)?.revenue ?? 0;
          acc.e += expectedOn(d);
          return acc;
        },
        { a: 0, e: 0 },
      );
    if (tail.length && prev.length) {
      const t = dsum(tail);
      const p = dsum(prev);
      const td = t.a - t.e;
      const pd = p.a - p.e;
      const better = td > pd;
      items.push({
        id: "trend",
        tag: "Trend",
        tone: td < 0 ? (better ? "watch" : "alert") : "good",
        q: "Is the gap closing or widening?",
        a: `Last 14 days ran ${MONEY(td)} vs run rate, the 14 before them ${MONEY(pd)} — ${better ? "the gap is narrowing" : "the gap is widening"}.`,
        detail: `${tail[0]} → ${tail[tail.length - 1]} vs ${prev[0]} → ${prev[prev.length - 1]}.`,
      });
    }

    // Worst single day still in the window.
    let worstDay = "";
    let worstDelta = 0;
    for (const d of days) {
      const g = (actualOn.get(d)?.revenue ?? 0) - expectedOn(d);
      if (g < worstDelta) {
        worstDelta = g;
        worstDay = d;
      }
    }
    if (worstDay) {
      items.push({
        id: "worstday",
        tag: "Calendar",
        tone: "info",
        q: "Which single day hurt most?",
        a: `${worstDay} came in ${MONEY(worstDelta)} against its own weekday run rate.`,
        detail:
          "Holiday weeks show up here first — check before reading it as demand.",
      });
    }
  } else if (rows.length) {
    // Scoped equivalent of "headline" above: no day-grain data per team
    // lead, so this sums the same P75-baseline expected/actual the clinic
    // tree already carries per row instead of walking daily rates.
    const schedExpected = rows.reduce((s, r) => s + r.expected, 0);
    const schedActual = rows.reduce((s, r) => s + r.actual, 0);
    const schedDelta = schedActual - schedExpected;
    items.push({
      id: "headline-scoped",
      tag: "Headline",
      tone: schedDelta < 0 ? "alert" : "good",
      q: "Where does this book stand right now?",
      a: `${MONEY(schedDelta)} against the baseline for ${teamLead} — ${PLAIN(schedActual)} actual vs ${PLAIN(schedExpected)} expected, across ${INT(rows.length)} clinics.`,
      detail: `${cfg.currentStart} → ${cfg.currentEnd}, measured against ${cfg.baselineStart} → ${cfg.baselineEnd}. Day-by-day trend isn't broken out per team lead yet — see the company-wide feed for that.`,
    });
  }

  if (rows.length) {
    const down = [...rows].sort((a, b) => a.delta - b.delta);
    const up = [...rows].sort((a, b) => b.delta - a.delta);
    const top5 = down.slice(0, 5);
    const top5Sum = top5.reduce((s, r) => s + r.delta, 0);
    items.push({
      id: "worst-clinics",
      tag: "Call list",
      tone: "alert",
      focus: "losers",
      focusLabel: "Clinics behind baseline",
      q: "Who should we call first?",
      a: `${top5.map(r => r.name).join(", ")} — those five alone are ${MONEY(top5Sum)}.`,
      detail: top5
        .map(
          r =>
            `${r.name} ${MONEY(r.delta)}${r.sales !== "—" ? ` · ${r.sales}` : ""}`,
        )
        .join(" | "),
    });

    // Clinics that stopped ordering entirely but used to matter.
    const silent = rows
      .filter(r => r.orders === 0 && r.expected > 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);
    if (silent.length) {
      const silentAll = rows.filter(r => r.orders === 0 && r.expected > 0);
      items.push({
        id: "silent",
        tag: "Churn risk",
        tone: "alert",
        focus: "silent",
        focusLabel: "Silent clinics",
        q: "Which clinics have gone completely silent?",
        a: `${INT(silentAll.length)} clinics that were ordering in the baseline have placed zero orders in this window, worth ${MONEY(silentAll.reduce((s, r) => s + r.delta, 0))}.`,
        detail: `Biggest: ${silent.map(r => `${r.name} (${MONEY(r.delta)})`).join(", ")}.`,
      });
    }

    // AOV collapse without an order collapse — a pricing / mix problem.
    const priceDrop = rows
      .filter(r => r.orders >= 20 && r.baseAov > 0 && r.aov < r.baseAov * 0.75)
      .sort((a, b) => a.aovEffect - b.aovEffect)
      .slice(0, 5);
    const priceDropAll = rows.filter(
      r => r.orders >= 20 && r.baseAov > 0 && r.aov < r.baseAov * 0.75,
    );
    if (priceDrop.length) {
      items.push({
        id: "aovdrop",
        tag: "Price",
        tone: "watch",
        focus: "aovdrop",
        focusLabel: "Clinics with >25% AOV drop",
        q: "Who is still ordering but at a much lower ticket?",
        a: `${INT(priceDropAll.length)} active clinics dropped their AOV more than 25% — led by ${priceDrop[0].name} ($${INT(priceDrop[0].baseAov)} → $${INT(priceDrop[0].aov)}).`,
        detail: priceDrop
          .map(
            r =>
              `${r.name} $${INT(r.baseAov)} → $${INT(r.aov)} (${MONEY(r.aovEffect)})`,
          )
          .join(" | "),
      });
    }

    const risers = up.slice(0, 5);
    items.push({
      id: "risers",
      tag: "Bright spots",
      tone: "good",
      focus: "risers",
      focusLabel: "Clinics ahead of baseline",
      q: "What is actually working?",
      a: `${risers.map(r => r.name).join(", ")} are running ahead of baseline, together ${MONEY(risers.reduce((s, r) => s + r.delta, 0))}.`,
      detail: risers.map(r => `${r.name} ${MONEY(r.delta)}`).join(" | "),
    });

    // Health flags worth attending to. "✅ Healthy" shows up in some rows'
    // health arrays alongside a real flag (or alone) — it's a status, not an
    // alert, so every count/detail/target-list below excludes it explicitly.
    const HEALTHY_TAG = "✅ Healthy";
    const flags = (r: (typeof rows)[number]) =>
      (r.health ?? []).filter(f => f !== HEALTHY_TAG);
    const flagCount = new Map<string, number>();
    for (const r of rows) {
      for (const f of flags(r)) {
        flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
      }
    }
    const flagDelta = new Map<string, number>();
    for (const r of rows) {
      for (const f of flags(r)) {
        flagDelta.set(f, (flagDelta.get(f) ?? 0) + r.delta);
      }
    }
    const worstFlag = [...flagDelta].sort((a, b) => a[1] - b[1])[0];
    if (worstFlag) {
      items.push({
        id: "health",
        tag: "Health notes",
        tone: "watch",
        focus: `health:${worstFlag[0]}`,
        focusLabel: `Clinics flagged "${worstFlag[0]}"`,
        q: "Which health flag is costing us the most?",
        a: `"${worstFlag[0]}" — ${INT(flagCount.get(worstFlag[0]) ?? 0)} clinics carrying it net ${MONEY(worstFlag[1])}.`,
        detail: [...flagDelta]
          .sort((a, b) => a[1] - b[1])
          .slice(0, 4)
          .map(([f, d]) => `${f} ${MONEY(d)}`)
          .join(" | "),
      });
    }

    // Every health tag, not just the single worst one — added 2026-09-06 per
    // Shyam's ask to give reps/enablement a full tag breakdown they can open
    // straight from the feed instead of a one-off exported spreadsheet.
    if (flagDelta.size > 0) {
      const allFlags = [...flagDelta].sort((a, b) => a[1] - b[1]);
      items.push({
        id: "health-all",
        tag: "Health notes",
        tone: "watch",
        focus: `ids:${rows
          .filter(r => flags(r).length > 0)
          .slice(0, 300)
          .map(r => r.clinic)
          .join(",")}`,
        focusLabel: "Every clinic carrying a health flag",
        q: "How is the drag spread across health flags?",
        a: `${INT(allFlags.length)} distinct flags across ${INT(rows.filter(r => flags(r).length > 0).length)} flagged clinics — worst 3: ${allFlags
          .slice(0, 3)
          .map(([f, d]) => `${f} (${MONEY(d)})`)
          .join(", ")}.`,
        detail: allFlags
          .map(([f, d]) => `${f} · ${INT(flagCount.get(f) ?? 0)} clinics · ${MONEY(d)}`)
          .join(" | "),
      });
    }

    // Top-20%-by-$-drag target list — the standard RCA output requested by
    // Thiru 2026-09-04 (Suzi Hansen RCA) and generalized here so every scope
    // can pull its own version straight from the feed instead of a one-off
    // CSV export.
    const flagged = rows
      .filter(r => flags(r).length > 0)
      .sort((a, b) => a.delta - b.delta);
    if (flagged.length > 0) {
      const cut = Math.max(1, Math.ceil(flagged.length * 0.2));
      const top20 = flagged.slice(0, cut);
      const top20Sum = top20.reduce((s, r) => s + r.delta, 0);
      const tagCount = new Map<string, number>();
      for (const r of top20) {
        for (const f of flags(r)) {
          tagCount.set(f, (tagCount.get(f) ?? 0) + 1);
        }
      }
      const topTags = [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 3);
      items.push({
        id: "target-list",
        tag: "Target list",
        tone: "alert",
        focus: `ids:${top20
          .slice(0, 300)
          .map(r => r.clinic)
          .join(",")}`,
        focusLabel: "Top 20% flagged clinics by $ drag (target list)",
        q: "Which clinics should the target list lead with?",
        a: `Top 20% of flagged clinics = ${INT(top20.length)} of ${INT(flagged.length)}, worth ${MONEY(top20Sum)}. Led by ${top20
          .slice(0, 3)
          .map(r => r.name)
          .join(", ")}.`,
        detail: `Most common tags in this slice: ${topTags
          .map(([f, c]) => `${f} (${INT(c)})`)
          .join(", ")}.`,
      });
    }

    // VA $275+ / 3+ orders-wk target list for the $400 Foundation Zoomer
    // launch (Shyam, 2026-09-15/16) — was a standalone dashboard panel
    // (VaTargetPanel, backed by convex/va.ts:targetList); promoted into the
    // Business Feed too so the same question surfaces there and opens
    // straight into the clinic list like every other feed card, instead of
    // living only in its own section. Uses the same `vaClinicTarget` table
    // (trailing-365-day VA-only revenue/orders per clinic, refreshed
    // alongside everything else) and the same $275 AOV / 3 orders-wk
    // thresholds as va.ts, scoped by teamLead directly off the stored rows
    // since vaClinicTarget already carries teamLead per clinic.
    const vaAll = await ctx.db
      .query("vaClinicTarget")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    const vaScoped = teamLead
      ? vaAll.filter(r => r.teamLead === teamLead)
      : vaAll;
    const vaWindowDays = vaScoped[0]?.windowDays ?? vaAll[0]?.windowDays ?? 365;
    const vaWeeks = vaWindowDays / 7;
    const vaQualified = vaScoped
      .map(r => ({
        clinic: r.clinic,
        name: r.name,
        vaOrders: r.vaOrders,
        vaRevenue: r.vaRevenue,
        vaAov: r.vaOrders ? r.vaRevenue / r.vaOrders : 0,
        ordersPerWeek: r.vaOrders / vaWeeks,
      }))
      .filter(
        r => r.vaAov >= VA_MIN_AOV && r.ordersPerWeek >= VA_MIN_ORDERS_PER_WEEK,
      )
      .sort((a, b) => b.vaRevenue - a.vaRevenue);
    const vaItem = vaFeedItem(vaQualified, vaWindowDays);
    if (vaItem) items.push(vaItem);

    // Broken buying rhythm: still alive, but ordering far below their own
    // expected order count (expected orders come from the clinic's baseline).
    const rhythm = rows
      .filter(
        r =>
          r.expectedOrders >= 8 &&
          r.orders > 0 &&
          r.orders < r.expectedOrders * 0.5,
      )
      .sort((a, b) => a.delta - b.delta);
    if (rhythm.length) {
      const rSum = rhythm.reduce((s2, r) => s2 + r.delta, 0);
      const rOrd = rhythm.reduce(
        (s2, r) => s2 + (r.orders - r.expectedOrders),
        0,
      );
      items.push({
        id: "rhythm",
        tag: "Call list",
        tone: "alert",
        focus: `ids:${rhythm
          .slice(0, 300)
          .map(r => r.clinic)
          .join(",")}`,
        focusLabel: "Clinics that broke their buying rhythm",
        q: "Which clinics have broken their buying rhythm?",
        a: `${INT(rhythm.length)} clinics are still ordering but at less than half their expected order count — ${INT(rOrd)} orders and ${MONEY(rSum)} short. Silent clinics are counted separately.`,
        detail: rhythm
          .slice(0, 5)
          .map(
            r =>
              `${r.name} ${INT(r.orders)} vs ${INT(r.expectedOrders)} ord (${MONEY(r.delta)})`,
          )
          .join(" | "),
      });
    }

    // Top-20% clinics whose ticket collapsed below $400 while they keep
    // ordering every month of the window.
    //
    // The last-3-months order cadence (monthOrders/monthSeries) is now
    // precomputed per clinic in refresh.ts and carried straight off the
    // clinicMeta row through drill()'s `rows` — no extra collects here. This
    // replaced 3 live full-table clinicPeriod scans that hit Convex's 32k
    // document-read cap at production scale (2026-09-05 outage — see
    // engineering notes for the incident and why the old approach broke).
    const monthKeys = [...new Set(days.map(d => d.slice(0, 7)))].sort();
    const lastMonths = monthKeys.slice(-3);
    // Days of each of those months that actually fall inside the window — the
    // newest month is usually partial, so counts must be compared as rates.
    const monthDays = lastMonths.map(
      mk => days.filter(d => d.slice(0, 7) === mk).length || 1,
    );
    const cheapTop = rows
      .filter(
        r =>
          r.cohort === "retained_top20" &&
          r.orders > 0 &&
          r.aov > 0 &&
          r.aov < 400 &&
          r.baseAov >= 400 &&
          r.monthOrders >= lastMonths.length,
      )
      .sort((a, b) => a.aovEffect - b.aovEffect);
    if (lastMonths.length > 0 && cheapTop.length) {
      items.push({
        id: "cheap-top20",
        tag: "Price",
        tone: "watch",
        focus: `ids:${cheapTop
          .slice(0, 300)
          .map(r => r.clinic)
          .join(",")}`,
        focusLabel: "Top-20% clinics now under $400 AOV",
        q: "Which top-20% clinics dropped below $400 AOV but still order monthly?",
        a: `${INT(cheapTop.length)} of them — ordering in every one of the last ${lastMonths.length} months, but at an average ticket under $400 against a baseline of $400+. Ticket effect ${MONEY(cheapTop.reduce((s2, r) => s2 + r.aovEffect, 0))}.`,
        detail: cheapTop
          .slice(0, 5)
          .map(
            r =>
              `${r.name} $${INT(r.baseAov)} → $${INT(r.aov)} (${MONEY(r.aovEffect)})`,
          )
          .join(" | "),
      });
    }

    // Save list: clinics still ordering this month but decaying fast — they
    // have not broken rhythm yet, so a call now can still hold the account.
    if (lastMonths.length >= 3) {
      const slipping = rows
        .map(r => {
          const ser = r.monthSeries;
          // Guards a stale precomputed series (e.g. refresh ran with a
          // different window length) from misaligning with monthDays below.
          if (!ser || ser.length !== monthDays.length) return null;
          // Orders per day, so a partial newest month is comparable.
          const rates = ser.map((o, i) => o / monthDays[i]);
          const lastRate = rates[rates.length - 1];
          const priorRate =
            rates.slice(0, -1).reduce((a, b) => a + b, 0) / (rates.length - 1);
          // Monthly-equivalent counts for display.
          const last = lastRate * 30;
          const priorAvg = priorRate * 30;
          if (ser[ser.length - 1] <= 0 || priorAvg < 2) return null;
          if (lastRate >= priorRate * 0.6) return null;
          if (r.expectedOrders < 8) return null;
          // Already broken — the rhythm card owns those.
          if (r.orders < r.expectedOrders * 0.5) return null;
          const aov = r.aov > 0 ? r.aov : r.baseAov;
          return {
            row: r,
            last,
            priorAvg,
            drop: 1 - last / priorAvg,
            risk: (priorAvg - last) * aov,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.risk - a.risk);
      if (slipping.length) {
        const riskSum = slipping.reduce((s2, x) => s2 + x.risk, 0);
        items.push({
          id: "intervention",
          tag: "Save list",
          tone: "alert",
          focus: `ids:${slipping
            .slice(0, 300)
            .map(x => x.row.clinic)
            .join(",")}`,
          focusLabel: "Clinics to intervene on right now",
          q: "Which clinics need intervention right now?",
          a: `${INT(slipping.length)} clinics ordered again this month but at under 60% of their own recent monthly pace, while still holding above half their expected order count — slipping, not lost yet. About ${PLAIN(riskSum)} of ordering per month is at risk if the slide continues, and every one still has an owner to call.`,
          detail: slipping
            .slice(0, 5)
            .map(
              x =>
                `${x.row.name} ${INT(x.last)} vs ${INT(Math.round(x.priorAvg))} ord/mo (-${Math.round(x.drop * 100)}%, ${PLAIN(x.risk)}/mo, ${x.row.sales})`,
            )
            .join(" | "),
        });
      }
    }

    // Sales owners: absolute shortfall and shortfall relative to their book.
    const byOwner = new Map<
      string,
      { delta: number; expected: number; clinics: number }
    >();
    for (const r of rows) {
      if (!r.sales || r.sales === "—") continue;
      const o = byOwner.get(r.sales) ?? { delta: 0, expected: 0, clinics: 0 };
      o.delta += r.delta;
      o.expected += r.expected;
      o.clinics += 1;
      byOwner.set(r.sales, o);
    }
    const owners = [...byOwner]
      .filter(([, o]) => o.expected >= 100_000)
      .map(([sales, o]) => ({
        sales,
        ...o,
        pct: o.expected ? (o.delta / o.expected) * 100 : 0,
      }));
    const worstOwner = [...owners].sort((a, b) => a.delta - b.delta)[0];
    if (worstOwner) {
      const relative = [...owners]
        .filter(o => o.sales !== worstOwner.sales)
        .sort((a, b) => a.pct - b.pct);
      items.push({
        id: "owner-shortfall",
        tag: "People",
        tone: "watch",
        focus: `sales:${worstOwner.sales}`,
        focusLabel: `${worstOwner.sales}'s clinics`,
        q: "Which salesperson carries the biggest share of the shortfall?",
        a: `${worstOwner.sales} — ${MONEY(worstOwner.delta)} across ${INT(worstOwner.clinics)} clinics, ${worstOwner.pct.toFixed(1)}% of their own expected book. ${relative[0] ? `Steepest relative drop elsewhere: ${relative[0].sales} at ${relative[0].pct.toFixed(1)}% (${MONEY(relative[0].delta)}).` : ""}`,
        detail: [...owners]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, 5)
          .map(
            o => `${o.sales} ${MONEY(o.delta)} (${o.pct.toFixed(1)}% of book)`,
          )
          .join(" | "),
      });
    }

    const stopped = rows.filter(r => (r.pstatus ?? []).includes("STOPPED"));
    const stoppedDelta = stopped.reduce((s2, r) => s2 + r.delta, 0);
    if (stopped.length) {
      items.push({
        id: "stopped",
        tag: "Portfolio",
        tone: stoppedDelta < 0 ? "alert" : "watch",
        focus: "stopped",
        focusLabel: "Clinics with STOPPED test lines",
        q: "How much sits behind STOPPED portfolio lines?",
        a: `${INT(stopped.length)} clinics have at least one stopped test line; together they are ${MONEY(stoppedDelta)}.`,
        detail: "Open any clinic in the drill to see which test lines stopped.",
      });
    }
  }

  // Gut Zoomer / Total Tox stopped clinics, month by month (Shyam,
  // 2026-10-13). Live feed only — the table is rebuilt from the latest
  // refresh, so historical snapshots must not read it. Clicking opens the
  // regular clinic list with focus "famstops" (clinics.ts drill()).
  if (!configKey || configKey === "main") {
    const stops = await loadStops(ctx, teamLead);
    const months = [...new Set(stops.map(r => r.month))].sort();
    const latest = months[months.length - 1];
    if (latest) {
      const MON = (ym: string) =>
        new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      const count = (ym: string, fam: string) =>
        stops.filter(r => r.month === ym && r.family === fam).length;
      const famTotal = (fam: string) => stops.filter(r => r.family === fam).length;
      const clinics = new Set(stops.map(r => r.clinic));
      const gzSet = new Set(stops.filter(r => r.family === "Gut Zoomer").map(r => r.clinic));
      const both = stops.filter(r => r.family === "Total Tox" && gzSet.has(r.clinic)).length;
      const trend = (fam: string) => months.map(m => `${MON(m)} ${INT(count(m, fam))}`).join(" + ");
      const top = [...stops]
        .sort((a, b) => b.priorOrders - a.priorOrders)
        .slice(0, 5)
        .map(r => `${r.name} (${r.sales}) — ${r.family === "Gut Zoomer" ? "GZ" : "TT"} ${r.priorOrders} orders in prior 90d, last ${r.lastOrder}, out since ${MON(r.month)}`);
      items.push({
        id: "famstops",
        tag: "Portfolio",
        tone: "watch",
        focus: "famstops",
        focusLabel: "Gut Zoomer / Total Tox stopped clinics",
        q: "Which clinics stopped ordering Gut Zoomer or Total Tox?",
        a: `${INT(famTotal("Gut Zoomer"))} clinics stopped Gut Zoomer and ${INT(famTotal("Total Tox"))} stopped Total Tox since May and still haven't reordered (${INT(both)} both; ${INT(clinics.size)} clinics) — ≥3 orders in the prior 90 days, then none since. Click to open them in the clinic list, filterable by family and month stopped.`,
        detail: [`Gut Zoomer: ${trend("Gut Zoomer")}`, `Total Tox: ${trend("Total Tox")}`, ...top].join(" | "),
      });
    }
  }

  // Product families — worst and best. Company-wide only: famBase/famPeriod
  // are stored per order-universe scope ("all"/"bundle"/"nonbundle"), not per
  // team lead — leadFamilies.ts is the per-lead equivalent but isn't wired
  // into the feed yet.
  if (!teamLead && famBase.length && famPeriod.length) {
    // Family rows are stored per order universe; the feed reads the "all" one.
    const famBaseAll = famBase.filter(b => (b.scope ?? "all") === "all");
    const actualBy = new Map(
      famPeriod
        .filter(f => (f.scope ?? "all") === "all")
        .map(f => [f.family, f]),
    );
    const wkCount = [0, 0, 0, 0, 0, 0, 0];
    for (const d of days) wkCount[dow(d)]++;
    const fam = famBaseAll.map(b => {
      const exp = b.rates.reduce((s, r, i) => s + r * wkCount[i], 0);
      const expOrd = b.ordRates.reduce((s, r, i) => s + r * wkCount[i], 0);
      const a = actualBy.get(b.family);
      return {
        family: b.family,
        delta: (a?.revenue ?? 0) - exp,
        orderDelta: (a?.orders ?? 0) - expOrd,
      };
    });
    const worst = [...fam].sort((a, b) => a.delta - b.delta)[0];
    const best = [...fam].sort((a, b) => b.delta - a.delta)[0];
    if (worst && worst.delta < 0) {
      items.push({
        id: "fam-worst",
        tag: "Product",
        tone: "alert",
        q: "Which product family is leaking most?",
        a: `${worst.family}: ${MONEY(worst.delta)} on ${INT(worst.orderDelta)} orders versus baseline.`,
        detail: [...fam]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, 4)
          .map(f => `${f.family} ${MONEY(f.delta)}`)
          .join(" | "),
      });
    }
    if (best && best.delta > 0) {
      items.push({
        id: "fam-best",
        tag: "Product",
        tone: "good",
        q: "Which product family is growing?",
        a: `${best.family}: ${MONEY(best.delta)} on ${INT(best.orderDelta)} orders above baseline.`,
        detail: [...fam]
          .sort((a, b) => b.delta - a.delta)
          .slice(0, 4)
          .map(f => `${f.family} ${MONEY(f.delta)}`)
          .join(" | "),
      });
    }
    // Substitution watch: is a growing family absorbing a shrinking one?
    // Pairs are products that compete for the same order, so a drop in one is
    // only a real loss if the other is not picking it up.
    const baseLabel = baseLabelOf(cfg);
    const famBy = new Map(fam.map(f => [f.family, f]));
    for (const [downName, upName] of OFFSET_PAIRS) {
      const d = famBy.get(downName);
      const u = famBy.get(upName);
      if (!d || !u) continue;
      const it = offsetFeedItem(downName, upName, d, u, baseLabel, (cfg.baselineMode ?? "prior_equal") === "yoy");
      if (it) items.push(it);
    }
  }

  // States that flipped from growth to decline in the latest month.
  // Company-wide only: stateDaily/stateBaseline have no team-lead breakdown.
  const months = [...new Set(days.map(d => d.slice(0, 7)))].sort();
  if (!teamLead && months.length >= 2) {
    const cur = months[months.length - 1];
    const prevM = months[months.length - 2];
    const stateDaily = await ctx.db
      .query("stateDaily")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    const inWin = new Set(days);
    type MRow = { a: number; e: number };
    const act = new Map<string, { cur: MRow; prev: MRow }>();
    const blank = (): { cur: MRow; prev: MRow } => ({
      cur: { a: 0, e: 0 },
      prev: { a: 0, e: 0 },
    });
    for (const r of stateDaily) {
      if (!inWin.has(r.date)) continue;
      const mk = r.date.slice(0, 7);
      if (mk !== cur && mk !== prevM) continue;
      const e = act.get(r.state) ?? blank();
      (mk === cur ? e.cur : e.prev).a += r.revenue;
      act.set(r.state, e);
    }
    for (const b of stateBaseline) {
      const e = act.get(b.state) ?? blank();
      for (const d of days) {
        const mk = d.slice(0, 7);
        if (mk !== cur && mk !== prevM) continue;
        (mk === cur ? e.cur : e.prev).e += (b.rates[dow(d)] ?? 0) * p75f;
      }
      act.set(b.state, e);
    }
    const flips = [...act]
      .map(([state, e]) => ({
        state,
        curD: e.cur.a - e.cur.e,
        prevD: e.prev.a - e.prev.e,
        curPct: e.cur.e ? ((e.cur.a - e.cur.e) / e.cur.e) * 100 : 0,
        prevPct: e.prev.e ? ((e.prev.a - e.prev.e) / e.prev.e) * 100 : 0,
        exp: e.cur.e,
      }))
      .filter(f => f.exp >= 50_000 && f.prevD > 0 && f.curD < 0)
      .sort((a, b) => a.curD - b.curD);
    if (flips.length) {
      const f = flips[0];
      items.push({
        id: "state-flip",
        tag: "Geography",
        tone: "alert",
        q: "Which state flipped from growth to decline this month?",
        a: `${f.state} — ${MONEY(f.prevD)} in ${prevM} turned into ${MONEY(f.curD)} in ${cur} (${f.curPct.toFixed(1)}% vs run rate). ${flips.length > 1 ? `${INT(flips.length)} states flipped in all.` : "It is the only flip."} ${cur} may be a partial month, so compare the percentages, not the dollars.`,
        detail: flips
          .slice(0, 5)
          .map(
            x =>
              `${x.state} ${x.prevPct.toFixed(1)}% → ${x.curPct.toFixed(1)}% (${MONEY(x.curD)})`,
          )
          .join(" | "),
      });
    }
  }

  // Charge channels: is a named ordering channel (wellProz) down?
  const chanBase = await ctx.db
    .query("channelBaseline")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  const chanDaily = await ctx.db
    .query("channelDaily")
    .withIndex("by_gen", q => q.eq("gen", gen))
    .collect();
  // Company-wide only: channelBaseline/channelDaily have no team-lead split.
  if (!teamLead && chanBase.length > 0) {
    const wkCount = [0, 0, 0, 0, 0, 0, 0];
    for (const d of days) wkCount[dow(d)]++;
    const inWindow = new Set(days);
    const act = new Map<string, { revenue: number; orders: number }>();
    for (const r of chanDaily) {
      if (!inWindow.has(r.date)) continue;
      const a = act.get(r.channel) ?? { revenue: 0, orders: 0 };
      a.revenue += r.revenue;
      a.orders += r.orders;
      act.set(r.channel, a);
    }
    const chan = chanBase.map(b => {
      const exp = b.rates.reduce((s, r, i) => s + r * wkCount[i], 0);
      const expOrd = b.ordRates.reduce((s, r, i) => s + r * wkCount[i], 0);
      const a = act.get(b.channel);
      return {
        channel: b.channel,
        actual: a?.revenue ?? 0,
        orders: a?.orders ?? 0,
        expected: exp,
        expectedOrders: expOrd,
        delta: (a?.revenue ?? 0) - exp,
        orderDelta: (a?.orders ?? 0) - expOrd,
      };
    });
    const wp = chan.find(c => c.channel.toLowerCase() === "wellproz");
    if (wp && wp.expectedOrders >= 1) {
      const pct = wp.expectedOrders
        ? (wp.orderDelta / wp.expectedOrders) * 100
        : 0;
      const down = wp.orderDelta < 0;
      items.push({
        id: "channel-wellproz",
        tag: "Channel",
        tone: down ? (pct <= -10 ? "alert" : "watch") : "good",
        q: "Are WellProz orders down?",
        a: `${down ? "Yes" : "No"} — ${INT(wp.orders)} WellProz orders in the window vs ${INT(wp.expectedOrders)} expected (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%), ${MONEY(wp.delta)} of revenue. WellProz is the charge method on the order, so this is the channel's own volume, not one clinic.`,
        detail: chan
          .filter(c => c.expectedOrders >= 1)
          .sort((a, b) => a.orderDelta - b.orderDelta)
          .slice(0, 5)
          .map(c => `${c.channel} ${INT(c.orderDelta)} ord / ${MONEY(c.delta)}`)
          .join(" | "),
      });
    }
  }

  // Bundle share of the book — company-wide only (`actual`/`bundleRev` come
  // from the whole-book daily tables, same limitation as the headline cards
  // above).
  if (!teamLead && actual > 0) {
    items.push({
      id: "bundle",
      tag: "Mix",
      tone: "info",
      q: "How much of the book is bundles right now?",
      a: `${((bundleRev / actual) * 100).toFixed(1)}% of revenue in the window came from bundle orders (${PLAIN(bundleRev)} of ${PLAIN(actual)}).`,
      detail: `${INT(orders)} orders in the window.`,
    });
  }

  return { ready: true, items, generatedFor: cfg.currentEnd };
}

export const feed = gatedQuery({
  args: { teamLead: v.optional(v.string()) },
  handler: async (ctx, { teamLead }) => await build(ctx, { teamLead }),
});

/**
 * Clinic search. Finds clinics by name or id and reports every list on the
 * dashboard the clinic belongs to — the feed cards that counted it, the tree
 * nodes it contributes to, and its own flags — so one clinic can be traced
 * across the whole dashboard without hunting through each list.
 */
export type SearchList = {
  kind: "feed" | "node" | "flag";
  label: string;
  /** Drill focus / lens key the frontend can open, when clickable. */
  focus?: string;
  lens?: string;
  key?: string;
  value?: string;
};

async function searchClinics(ctx: QueryCtx, term: string, sales?: string) {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return { ready: true as const, matches: [] };
  const res = await drill(ctx, {
    periodId: "all",
    lens: "total",
    unlimited: true,
    sales,
  });
  const rows = res.rows ?? [];
  if (!rows.length) return { ready: false as const, matches: [] };
  const hits = rows
    .filter(r => r.name.toLowerCase().includes(q) || r.clinic === q)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8);

  const byDelta = [...rows].sort((a, b) => a.delta - b.delta);
  const rankOf = new Map(byDelta.map((r, i) => [r.clinic, i + 1]));

  const matches = hits.map(r => {
    const lists: SearchList[] = [];
    lists.push({
      kind: "node",
      label:
        r.delta < 0 ? "Total gap (behind baseline)" : "Total gap (ahead of it)",
      lens: "total",
      key: "",
      value: MONEY(r.delta),
    });
    lists.push({
      kind: "node",
      label: "Volume & product mix",
      lens: "volume",
      key: "",
      value: MONEY(r.volume),
    });
    lists.push({
      kind: "node",
      label: "Price / ticket (AOV)",
      lens: "aov",
      key: "",
      value: MONEY(r.aovEffect),
    });
    lists.push({
      kind: "node",
      label: "Bundles",
      lens: "bundle",
      key: "",
      value: MONEY(r.bundleDelta),
    });
    lists.push({
      kind: "node",
      label: "Non-bundle",
      lens: "nonbundle",
      key: "",
      value: MONEY(r.nonBundleDelta),
    });
    const cohortLabel: Record<string, string> = {
      churned: "Churned clinics",
      new: "New clinics (still ordering)",
      retained_top20: "Active top-20% clinics",
      retained_rest: "Active — everyone else",
      reactivated: "Reactivated clinics",
    };
    lists.push({
      kind: "node",
      label: cohortLabel[r.cohort] ?? r.cohort,
      lens: "cohort",
      key: r.cohort,
      value: MONEY(r.delta),
    });
    lists.push({
      kind: "node",
      label: `Geography · ${r.state}`,
      lens: "state",
      key: r.state,
      value: MONEY(r.delta),
    });
    for (const h of r.health ?? []) {
      lists.push({ kind: "flag", label: h, focus: `health:${h}` });
    }
    for (const p of r.pstatus ?? []) {
      lists.push({
        kind: "flag",
        label: `Portfolio ${p}`,
        focus: p === "STOPPED" ? "stopped" : undefined,
      });
    }
    return {
      clinic: r.clinic,
      name: r.name,
      state: r.state,
      sales: r.sales,
      cohort: r.cohort,
      expected: r.expected,
      actual: r.actual,
      delta: r.delta,
      orders: r.orders,
      expectedOrders: r.expectedOrders,
      aov: r.aov,
      baseAov: r.baseAov,
      health: r.health ?? [],
      pstatus: r.pstatus ?? [],
      rank: rankOf.get(r.clinic) ?? 0,
      total: rows.length,
      lists,
    };
  });
  return { ready: true as const, matches };
}

export const clinicSearch = scopedQuery({
  args: { term: v.string() },
  handler: async (ctx, { term }) =>
    await searchClinics(
      ctx,
      term,
      ctx.viewer.kind === "rep" ? ctx.viewer.rep : undefined,
    ),
});

/**
 * The rep Business feed (2026-10-20): the same cards as the main feed, built by the same functions (feedItems.ts), for one
 * rep's own clinics: "Is Toxin Zoomer offsetting the Total Tox downfall?" and "Which clinics are ready for the $400
 * Foundation Zoomer panel?". A rep login is pinned to its own name by the access wrapper; a manager login passes the rep
 * it is looking at. A question that does not apply to the rep right now still comes back, with `applies: false`.
 */
export const repQuestions = scopedQuery({
  args: { sales: v.optional(v.string()) },
  handler: async (ctx, { sales }) => {
    const cfg = await loadCfg(ctx);
    if (!cfg || !sales) return { ready: false as const, cards: [] };
    const gen = cfg.gen ?? 0;
    const cards: Array<{
      id: string; applies: boolean; domain: string; topic: string; tag: string; tone: string; question: string; fact: string; inference: string;
      evidence: string[]; action: string; confidence: string; status: string; focus?: string; focusLabel?: string;
    }> = [];
    const shape = (it: FeedItem, applies: boolean) => {
      const m = mappingFor(it.tag);
      const evidence = evidenceFrom(it.detail);
      cards.push({
        id: it.id, applies, domain: m.domain, topic: m.topic, tag: it.tag, tone: it.tone, question: it.q, fact: it.a,
        inference: inferenceFor(it.tag, it.tone, it.id), evidence, action: REP_ACTION[it.id] ?? actionFor(it.tag, it.id), confidence: confidenceFor(it.tag, evidence.length),
        status: statusFor(it.tone), focus: it.focus, focusLabel: it.focusLabel,
      });
    };
    // Substitution
    const fam = await salesFamilyRows(ctx, "all", sales);
    for (const [downName, upName] of OFFSET_PAIRS) {
      const d = fam.all.find(f => f.family === downName), u = fam.all.find(f => f.family === upName);
      // `true` drops the "switch the baseline" hint: a rep has no Settings to switch it in.
      const it = d && u ? offsetFeedItem(downName, upName, d, u, baseLabelOf(cfg), true) : null;
      if (it) shape(it, true);
      else
        shape({
          id: `offset-${downName}`, tag: "Substitution", tone: "good", q: `Is ${upName} offsetting the ${downName} downfall?`,
          a: d ? `${downName} is not below baseline for your clinics (${MONEY(d.delta)} / ${INT(d.orderDelta)} orders), so there is no decline for ${upName} to offset.` : `${downName} has no orders in your book in this window.`,
          detail: d ? `${downName}: ${MONEY(d.delta)} · ${INT(d.orderDelta)} ord${u ? ` | ${upName}: ${MONEY(u.delta)} · ${INT(u.orderDelta)} ord` : ""}.` : undefined,
        }, false);
    }
    // $400 Foundation Zoomer panel
    const all = await ctx.db.query("vaClinicTarget").withIndex("by_gen", q => q.eq("gen", gen)).collect();
    const mine = all.filter(r => (isTeamScope(sales) ? isCompanyLead(teamOf(sales)) || r.teamLead === teamOf(sales) : r.sales === sales));
    const windowDays = mine[0]?.windowDays ?? all[0]?.windowDays ?? 365;
    const weeks = windowDays / 7;
    const qualified = mine
      .filter(r => (r.vaOrders ? r.vaRevenue / r.vaOrders : 0) >= VA_MIN_AOV && r.vaOrders / weeks >= VA_MIN_ORDERS_PER_WEEK)
      .sort((a, b) => b.vaRevenue - a.vaRevenue)
      .map(r => ({ clinic: r.clinic, name: r.name, vaOrders: r.vaOrders, vaRevenue: r.vaRevenue }));
    const va = vaFeedItem(qualified, windowDays);
    if (va) shape(va, true);
    else
      shape({
        id: "va-target", tag: "Target list", tone: "info", q: "Which clinics are ready for the $400 Foundation Zoomer panel?",
        a: `None of your clinics currently meet both bars (VA-only orders at $${VA_MIN_AOV}+ AOV and ${VA_MIN_ORDERS_PER_WEEK}+ orders/week).`,
      }, false);
    // Where Gut Zoomer orders are going: the family gap, the clinics that stopped it, and (for a team) which RSMs.
    const gzRow = fam.all.find(f => f.family === "Gut Zoomer");
    const stopRows = (await loadStops(ctx, isTeamScope(sales) && !isCompanyLead(teamOf(sales)) ? teamOf(sales) : undefined))
      .filter(r => r.family === "Gut Zoomer" && (isTeamScope(sales) || r.sales === sales))
      .map(r => ({ clinic: r.clinic, name: r.name, state: r.state, sales: r.sales, priorOrders: r.priorOrders, lastOrder: r.lastOrder }));
    const gzReps: Array<{ name: string; delta: number; orderDelta: number }> = [];
    if (isTeamScope(sales))
      for (const rep of await repsInScope(ctx, gen, sales)) {
        const g = (await salesFamilyRows(ctx, "all", rep)).all.find(f => f.family === "Gut Zoomer");
        if (g) gzReps.push({ name: rep, delta: g.delta, orderDelta: g.orderDelta });
      }
    const decRows = (await ctx.db.query("familyDecline").withIndex("by_family", q => q.eq("family", "Gut Zoomer")).collect())
      .filter(r => (isTeamScope(sales) ? isCompanyLead(teamOf(sales)) || r.teamLead === teamOf(sales) : r.sales === sales))
      .map(r => ({ clinic: r.clinic, name: r.name, state: r.state, sales: r.sales, orders: r.orders, expected: r.expected, status: r.status }));
    const dLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const gl = gzLossItem(gzRow, stopRows, decRows, gzReps, baseLabelOf(cfg), !!(await ctx.db.query("familyStops").first()) || !!(await ctx.db.query("familyDecline").first()), `${dLabel(cfg.currentStart)} – ${dLabel(cfg.currentEnd)}, ${cfg.currentEnd.slice(0, 4)} (the whole analysis window, not a single tab)`);
    if (gl) shape(gl, true);
    else
      shape({ id: "gz-loss", tag: "Portfolio", tone: "good", q: "Where am I losing Gut Zoomer orders?", a: "Gut Zoomer has no orders and no stopped clinics in your book in this window." }, false);
    return { ready: true as const, cards };
  },
});

export const clinicSearchInternal = internalQuery({
  args: { term: v.string() },
  handler: async (ctx, { term }) => await searchClinics(ctx, term),
});

export const feedInternal = internalQuery({
  args: { teamLead: v.optional(v.string()) },
  handler: async (ctx, { teamLead }) => await build(ctx, { teamLead }),
});

// Raised questions per person per hour, so a stuck button cannot flood the Jira project.
const RAISE_LIMIT = 10;
const raised = new Map<string, number[]>();

/**
 * "Raise a question" from the Business Feed: creates a Jira issue (analytics/jira.ts) and, if RAISE_QUESTION_WEBHOOK_URL is
 * set, also posts it to the Slack relay (see URL comment above). Open to team, rep and manager logins; the asker's email
 * comes from the session, not from the browser. Returns the issue key and link when Jira is configured.
 */
export const raiseQuestion = scopedAction({
  args: {
    question: v.string(),
    email: v.optional(v.string()),
    context: v.optional(v.string()),
    card: v.optional(v.object({ id: v.string(), question: v.string(), fact: v.string() })),
    sales: v.optional(v.string()),
  },
  handler: async (ctx, { question, email, context, card, sales }): Promise<{ ok: true; key?: string; url?: string }> => {
    const q = question.trim();
    if (!q) throw new Error("Question is empty.");
    if (q.length > 4000) throw new Error("Question is too long (4000 characters at most).");
    const who = (ctx.viewer.email ?? email ?? "").trim() || "unknown (email not captured)";
    const scope =
      ctx.viewer.kind === "rep" ? `Rep login, ${ctx.viewer.rep}'s book`
      : ctx.viewer.kind === "lead" ? `Manager login${sales ? (isTeamScope(sales) ? `, looking at ${teamOf(sales)}'s whole team` : `, looking at ${sales}'s book`) : ""}`
      : "Team login, company-wide";
    const now = Date.now();
    const recent = (raised.get(who) ?? []).filter(t => now - t < 3_600_000);
    if (recent.length >= RAISE_LIMIT) throw new Error("You have raised several questions in the last hour. Try again later.");
    raised.set(who, [...recent, now]);

    const where = context?.trim() || "vw-rca Business Feed";
    let out: { ok: true; key?: string; url?: string } = { ok: true };
    if (jiraConfig()) {
      const issue = await createJiraIssue({ question: q, asker: who, scope, context: where, card });
      out = { ok: true, key: issue.key, url: issue.url };
    } else if (!RAISE_QUESTION_WEBHOOK_URL) {
      throw new Error("Raise Question is not configured on this deployment.");
    }
    if (RAISE_QUESTION_WEBHOOK_URL) {
      const res = await fetch(RAISE_QUESTION_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, email: who, context: `${where}${out.key ? ` · ${out.key}` : ""}` }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (!out.key && !res?.ok) throw new Error(`Could not send the question (status ${res?.status ?? "unreachable"}).`);
    }
    return out;
  },
});
