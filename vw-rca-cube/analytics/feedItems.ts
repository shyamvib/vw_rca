/**
 * Business Feed text, shared by the company feed (feed.ts, insights.ts) and the rep Business feed (feed.ts repQuestions), so the
 * same question reads the same wherever it appears. Pure functions: no database, no Convex imports.
 */
import type { FeedItem } from "./feed";

export const MONEY = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "+";
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1_000)}K`;
  return `${s}$${Math.round(a)}`;
};
export const INT = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- structured fields (moved from insights.ts) ------------------------------------------------------------------
export type Mapping = { domain: string; topic: string; prefix: string };

export const TAG_MAP: Record<string, Mapping> = {
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
export const DEFAULT_MAP: Mapping = { domain: "Revenue", topic: "General", prefix: "REV" };
export const mappingFor = (tag: string): Mapping => TAG_MAP[tag] ?? DEFAULT_MAP;

export const INFERENCE_BY_TAG: Record<string, (tone: string) => string> = {
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
// Cards whose wording is specific to the question, not the tag (the tag-level text for "Target list" describes the flagged-clinic list).
const ITEM_TEXT: Record<string, { inference: string; action: string }> = {
  "gz-loss": {
    inference: "Gut Zoomer leaves two ways: clinics that stop entirely, and clinics that keep ordering but less. Stopped clinics are the sharpest, most recoverable loss; declining ones are the slower leak that becomes the next stopped list.",
    action: "Call the stopped clinics first, biggest earlier volume first, and ask what changed (price, turnaround, a competing panel) before offering a restart. Then the declining clinics, largest shortfall first: they still order, so a call that finds the cause is the cheapest recovery.",
  },
  "va-target": {
    inference: "These clinics already pay premium prices on VA panels and order often, so they are the likeliest to take the $400 Foundation Zoomer.",
    action: "Lead the outreach with the top ten by VA revenue and share the $400 panel offer.",
  },
};
export const inferenceFor = (tag: string, tone: string, id?: string) =>
  (id && ITEM_TEXT[id]?.inference) || (INFERENCE_BY_TAG[tag] ?? (() => "Movement here is worth tracking against the next refresh."))(tone);

export const ACTION_BY_TAG: Record<string, string> = {
  Headline: "Open Where the gap comes from (state, cohort, product lenses) to locate the driver before setting next week's targets.",
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
/** Wording for the rep Business feed where the main feed's line is written for a manager (the main feed says "confirm with reps"). */
export const REP_ACTION: Record<string, string> = {
  "offset-Total Tox": "Call the clinics that dropped Total Tox without picking up Toxin Zoomer and find out why before you count it as a net loss.",
};
export const actionFor = (tag: string, id?: string) => (id && ITEM_TEXT[id]?.action) || ACTION_BY_TAG[tag] || "Monitor against the next refresh.";

export const statusFor = (tone: string): string => {
  if (tone === "good") return "On Track";
  if (tone === "info") return "Informational";
  return "Monitoring"; // alert | watch
};

export const confidenceFor = (tag: string, evidenceCount: number): string => {
  const HIGH_TAGS = new Set(["Headline", "Trend", "Channel"]);
  if (HIGH_TAGS.has(tag)) return "High";
  if (evidenceCount === 0) return "Low";
  return "Medium";
};

export const evidenceFrom = (detail?: string): string[] => {
  if (!detail) return [];
  return detail
    .split("|")
    .map(s => s.trim())
    .filter(Boolean);
};


// ---- the two cards the rep Business feed shares with the company feed ---------------------------------------------
export type FamDelta = { delta: number; orderDelta: number };

export const OFFSET_PAIRS: Array<[string, string]> = [["Total Tox", "Toxin Zoomer"]];

/** "Is <up> offsetting the <down> downfall?" Null when <down> is not below its baseline (nothing to offset). */
export function offsetFeedItem(downName: string, upName: string, d: FamDelta, u: FamDelta, baseLabel: string, yoy: boolean): FeedItem | null {
  if (d.delta >= 0) return null;
  const revCover = u.delta / -d.delta; // share of the loss covered
  const ordCover = d.orderDelta ? u.orderDelta / -d.orderDelta : 0;
  const full = u.delta + d.delta >= 0;
  const switchHint = yoy ? "" : " Switch the baseline to “same period last year” to judge the launch year-over-year instead.";
  return {
    id: `offset-${downName}`,
    tag: "Substitution",
    tone: full ? "good" : u.delta > 0 ? "watch" : "alert",
    q: `Is ${upName} offsetting the ${downName} downfall?`,
    a:
      u.delta > 0
        ? `${upName} is ${MONEY(u.delta)} / ${INT(u.orderDelta)} orders above baseline against ${downName} at ${MONEY(d.delta)} / ${INT(d.orderDelta)} orders — ${full ? "it more than covers the loss" : `it covers ${Math.round(Math.max(0, revCover) * 100)}% of the revenue and ${Math.round(Math.max(0, ordCover) * 100)}% of the orders`}. Net ${MONEY(u.delta + d.delta)}. Measured against ${baseLabel}. Open the list to see which clinics dropped ${downName} without picking up ${upName}.${switchHint}`
        : `No — ${upName} is also below baseline (${MONEY(u.delta)} / ${INT(u.orderDelta)} orders), so the ${MONEY(d.delta)} ${downName} drop is a real loss, not a switch. Net ${MONEY(u.delta + d.delta)}, measured against ${baseLabel}.${switchHint}`,
    focus: `pair:${downName}>${upName}`,
    focusLabel: `${downName} → ${upName} switchers`,
    detail: `${downName}: ${MONEY(d.delta)} · ${INT(d.orderDelta)} ord | ${upName}: ${MONEY(u.delta)} · ${INT(u.orderDelta)} ord | net ${MONEY(u.delta + d.delta)} · ${INT(u.orderDelta + d.orderDelta)} ord.`,
  };
}

export const VA_MIN_AOV = 275;
export const VA_MIN_ORDERS_PER_WEEK = 3;
export type VaQualified = { clinic: string; name: string; vaOrders: number; vaRevenue: number };

/** "Which clinics are ready for the $400 Foundation Zoomer panel?" Null when no clinic qualifies. */
export function vaFeedItem(qualified: VaQualified[], windowDays: number): FeedItem | null {
  if (!qualified.length) return null;
  const vaRevSum = qualified.reduce((s, r) => s + r.vaRevenue, 0);
  const vaOrdSum = qualified.reduce((s, r) => s + r.vaOrders, 0);
  return {
    id: "va-target",
    tag: "Target list",
    tone: "info",
    focus: `ids:${qualified.slice(0, 300).map(r => r.clinic).join(",")}`,
    focusLabel: "VA $275+ clinics ready for the $400 Foundation Zoomer launch",
    q: "Which clinics are ready for the $400 Foundation Zoomer panel?",
    a: `${INT(qualified.length)} clinics already run VA-only orders at $275+ AOV and 3+ orders/week (trailing 52 weeks) — ${MONEY(vaRevSum)} combined VA revenue, ${INT(vaOrdSum)} VA orders. Led by ${qualified.slice(0, 3).map(r => r.name).join(", ")}.`,
    detail: `Filter: VA-only orders (no VW line), AOV ≥ $${VA_MIN_AOV}, ≥${VA_MIN_ORDERS_PER_WEEK} orders/week, trailing ${INT(windowDays)} days.`,
  };
}

/** The baseline in words, for the "measured against ..." clause. */
export const baseLabelOf = (cfg: { baselineMode?: string; baselineStart: string; baselineEnd: string }): string =>
  (cfg.baselineMode ?? "prior_equal") === "yoy"
    ? "the same period last year"
    : (cfg.baselineMode ?? "prior_equal") === "trailing_13w"
      ? "the trailing 13-week same-weekday baseline"
      : (cfg.baselineMode ?? "prior_equal") === "prior_3m"
        ? "the prior 3-month run rate"
        : `the ${cfg.baselineStart} – ${cfg.baselineEnd} run rate`;


// ---- "Where am I losing Gut Zoomer orders?" (rep Business feed) --------------------------------------------------
export type GzStop = { clinic: string; name: string; state: string; sales: string; priorOrders: number; lastOrder: string };
export type GzRep = { name: string; delta: number; orderDelta: number };
export type GzDecline = { clinic: string; name: string; state: string; sales: string; orders: number; expected: number; status: string };

/** Gut Zoomer against baseline for the book, plus the clinics that stopped it and the ones still ordering below expected, by state and (for a team) by RSM. */
export function gzLossItem(
  gz: { delta: number; orderDelta: number; orders: number; expectedOrders: number } | undefined,
  stops: GzStop[],
  declining: GzDecline[],
  reps: GzRep[],
  baseLabel: string,
  built = true,
): FeedItem | null {
  if (!gz && !stops.length && !declining.length) return null;
  const delta = gz?.delta ?? 0, orderDelta = gz?.orderDelta ?? 0;
  const lost = stops.reduce((t, r) => t + r.priorOrders, 0);
  const short = declining.reduce((t, r) => t + Math.max(0, r.expected - r.orders), 0);
  const topStates = (xs: Array<{ state: string }>) => {
    const m = new Map<string, number>();
    for (const r of xs) m.set(r.state || "—", (m.get(r.state || "—") ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`);
  };
  const states = topStates(stops), dStates = topStates(declining);
  const behind = reps.filter(r => r.orderDelta < 0).sort((a, b) => a.orderDelta - b.orderDelta);
  const ahead = reps.filter(r => r.orderDelta > 0).sort((a, b) => b.orderDelta - a.orderDelta);
  const sInt = (n: number) => `${n > 0 ? "+" : ""}${INT(n)}`;
  const any = stops.length + declining.length > 0;
  const net = gz ? `${MONEY(delta)} / ${sInt(orderDelta)} orders against baseline (${INT(gz.orders)} ordered against ${INT(gz.expectedOrders)} expected)` : "";
  // Net below baseline: say where. Net at or above baseline: say so first, then the clinics that are still slipping inside it.
  const ahead$ = !!gz && delta >= 0 && orderDelta >= 0;
  const head = !gz
    ? "Gut Zoomer has no orders in this book in the window."
    : ahead$
      ? `Overall you are ahead on Gut Zoomer: ${net}.${any ? " Inside that, some clinics are still losing orders:" : " No clinic is losing it."}`
      : `Gut Zoomer is ${net}.`;
  const stopTxt = stops.length
    ? ` ${INT(stops.length)} clinics have stopped ordering it (3+ orders in the 90 days before, none since); together they used to place ${INT(lost)} orders per 90 days${states.length ? `, mostly in ${states.join(", ")}` : ""}.`
    : "";
  const decTxt = declining.length
    ? ` ${INT(declining.length)} ${stops.length ? "more " : ""}still order it but below what their baseline expects, ${INT(short)} orders short in total${dStates.length ? `, mostly in ${dStates.join(", ")}` : ""}.`
    : "";
  const noneTxt = !any && !ahead$ && built ? " No clinic has stopped it or fallen below its expected orders." : "";
  const unbuilt = !built ? " The stopped and declining clinic lists are built by the data refresh and are not available yet." : "";
  const repTxt = reps.length > 1 && (behind.length || ahead.length)
    ? ` By RSM${behind.length ? `, behind at ${behind.slice(0, 3).map(r => `${r.name} (${INT(r.orderDelta)} orders)`).join(", ")}` : ""}${ahead.length ? `${behind.length ? "; ahead at" : ", ahead at"} ${ahead.slice(0, 2).map(r => `${r.name} (${sInt(r.orderDelta)})`).join(", ")}` : ""}.`
    : "";
  const topStop = [...stops].sort((a, b) => b.priorOrders - a.priorOrders).slice(0, 4)
    .map(r => `Stopped: ${r.name} (${r.sales}${r.state ? `, ${r.state}` : ""}) — ${r.priorOrders} orders in the prior 90 days, last ${r.lastOrder}`);
  const topDec = [...declining].sort((a, b) => (b.expected - b.orders) - (a.expected - a.orders)).slice(0, 4)
    .map(r => `Declining: ${r.name} (${r.sales}${r.state ? `, ${r.state}` : ""}) — ${INT(r.orders)} ordered against ${r.expected.toFixed(1)} expected${r.status === "DECLINING" ? ", flagged DECLINING" : ""}`);
  const rsm = reps.length > 1 ? [...reps].sort((a, b) => a.orderDelta - b.orderDelta).slice(0, 8).map(r => `${r.name}: ${MONEY(r.delta)} · ${INT(r.orderDelta)} ord`) : [];
  const ids = [...stops.map(r => r.clinic), ...declining.map(r => r.clinic)];
  return {
    id: "gz-loss",
    tag: "Portfolio",
    tone: delta < 0 ? (any ? "alert" : "watch") : any ? "watch" : "good",
    q: "Where am I losing Gut Zoomer orders?",
    a: `${head}${stopTxt}${decTxt}${noneTxt}${unbuilt}${repTxt} Measured against ${baseLabel}.${any ? " Open the list to see the stopped and declining clinics." : ""}`,
    focus: ids.length ? `ids:${ids.slice(0, 300).join(",")}` : undefined,
    focusLabel: "Clinics that stopped or are declining on Gut Zoomer",
    detail: [...Array.from({ length: Math.max(topStop.length, topDec.length) }, (_, i) => [topStop[i], topDec[i]]).flat().filter((x): x is string => !!x), ...rsm, states.length ? `Stopped, by state: ${states.join(", ")}` : "", dStates.length ? `Declining, by state: ${dStates.join(", ")}` : ""].filter(Boolean).join(" | "),
  };
}
