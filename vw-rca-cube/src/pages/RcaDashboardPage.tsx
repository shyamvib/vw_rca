import { Logo } from "@/components/Logo";
import { useMutation, useQuery } from "convex/react";
import { useRcaQuery, useRcaAction } from "@/lib/rca";
import { GeoMap, GeoRsmTable, type GeoRow } from "./GeoMap";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { pw, email as gateEmail, repSession, signOut } from "./gatePw";
import { CLINIC_FOOTPRINTS } from "./clinicFootprints";
import "./rca.css";
import { RepView } from "./RepView";

type Row = {
  label: string;
  sub: string;
  value: number;
  lens: string;
  key: string;
  /** Clinic count behind a cohort row (used to total the grouped "Active" stage). */
  clinics?: number;
  /** Real change (actual - baseline) and ambition (goal - baseline) behind `value` (= real - ambition). */
  real?: number;
  ambition?: number;
  /** The grouped "Active" lifecycle stage keeps its size tiers (top 20% / everyone else) here. */
  tiers?: Row[];
  /** "patients" rows carry a headcount, not dollars, and are read on their
   * own scale rather than as a share of the revenue gap. */
  unit?: "patients";
  /** Reference value the unit row is measured against (expected patients). */
  base?: number;
};
type FamilyRow = {
  family: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
};
type Period = {
  /** New-business goal inside `expected`: a slice of the target for this year's new clinics (group level). */
  newGoal?: number;
  /** Factor the cohort rows' expected was scaled by so they add up to the headline delta. */
  cohortCalibration?: number;
  /** Baseline (mean run rate), real change (actual - baseline) and ambition (goal - baseline; `expected` is the goal). */
  baseline?: number;
  realChange?: number;
  ambition?: number;
  id: string;
  kind: "all" | "quarter" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  days: number;
  partial?: boolean;
  holiday: string | null;
  actual: number;
  expected: number;
  delta: number;
  orders: number;
  expectedOrders: number;
  aov: number;
  baseAov: number;
  patients: number;
  expectedPatients: number;
  families: FamilyRow[];
  familiesBundle: FamilyRow[];
  familiesNonBundle: FamilyRow[];
  lensA: Row[];
  lensB: Row[];
  lensC: Row[];
  lensD: Row[];
  topStates: Array<{ state: string; value: number }>;
};

const MONEY = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(3)}M`;
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${Math.round(abs)}`;
};
const MONEY_PLAIN = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${Math.round(n).toLocaleString("en-US")}`;
const INT = (n: number) => Math.round(n).toLocaleString("en-US");
/** A 0–1 share as a whole-percent label. */
const PCT_SHARE = (n: number) => `${Math.round((n || 0) * 100)}%`;

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[Number(m) - 1]} ${Number(day)}`;
}

const LENS_META = [
  {
    key: "lensA" as const,
    letter: "A",
    title: "Volume vs price vs traffic",
    question:
      "Fewer orders, cheaper orders, or fewer patients walking in?",
  },
  {
    key: "lensB" as const,
    letter: "B",
    title: "Product mix",
    question: "Are we losing bundles or single tests?",
  },
  {
    key: "lensC" as const,
    letter: "C",
    title: "Clinic cohort",
    question: "Churn, new clients, or existing clinics ordering less?",
  },
  {
    key: "lensD" as const,
    letter: "D",
    title: "Geography",
    question: "Concentrated pockets or a broad market move?",
  },
];

type FeedItem = {
  id: string;
  tag: string;
  tone: "alert" | "watch" | "good" | "info";
  q: string;
  a: string;
  detail?: string;
  focus?: string;
  focusLabel?: string;
};

/** Mirrors convex/clinics.ts matchesFocus so a searched clinic can be tested
 * against the feed cards the browser already holds, without a second query. */
function rowMatchesFocus(
  r: {
    clinic: string;
    orders: number;
    expected: number;
    baseAov: number;
    aov: number;
    delta: number;
    sales: string;
    health: string[];
    pstatus: string[];
  },
  focus: string,
): boolean {
  if (!focus || focus.startsWith("pair:")) return false;
  if (focus === "silent") return r.orders === 0 && r.expected > 0;
  if (focus === "aovdrop")
    return r.orders >= 20 && r.baseAov > 0 && r.aov < r.baseAov * 0.75;
  if (focus === "stopped") return r.pstatus.includes("STOPPED");
  if (focus === "risers") return r.delta > 0;
  if (focus === "losers") return r.delta < 0;
  if (focus.startsWith("ids:"))
    return focus.slice(4).split(",").includes(r.clinic);
  if (focus.startsWith("sales:")) return r.sales === focus.slice(6);
  if (focus.startsWith("health:")) return r.health.includes(focus.slice(7));
  return false;
}

/**
 * Clinic search results: one card per matched clinic showing its own numbers
 * and every list on the dashboard it belongs to — feed cards, tree nodes and
 * its flags — each chip opening that list with the clinic inside it.
 */
function ClinicSearchResults({
  term,
  feedItems,
  onOpenFocus,
  onOpenLens,
  onClose,
}: {
  term: string;
  feedItems: FeedItem[];
  onOpenFocus: (focus: string, label: string) => void;
  onOpenLens: (lens: string, key: string, label: string) => void;
  onClose: () => void;
}) {
  const data = useRcaQuery(
    api.feed.clinicSearch,
    term.trim().length >= 2 ? { term, password: pw() } : "skip",
  );
  if (term.trim().length < 2) return null;
  const matches = data?.matches ?? [];
  return (
    <section className="rca-card rca-search-card">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">Clinic search</div>
          <div className="rca-drill-title">"{term}"</div>
          <div className="rca-sub">
            {data === undefined
              ? "Searching…"
              : matches.length === 0
                ? "No clinic in this window matches that name or id."
                : `${matches.length} match${matches.length > 1 ? "es" : ""} — every list each clinic appears in is listed below. Click a chip to open that list.`}
          </div>
        </div>
        <div className="rca-drill-actions">
          <button type="button" className="rca-tab" onClick={onClose}>
            clear
          </button>
        </div>
      </div>

      {matches.map(m => {
        const feedLists = feedItems.filter(
          i => i.focus && rowMatchesFocus(m, i.focus),
        );
        return (
          <div key={m.clinic} className="rca-search-hit">
            <div className="rca-search-hit-head">
              <div>
                <strong>{m.name}</strong>{" "}
                <span className="rca-dim">
                  #{m.clinic} · {m.state} · {m.sales} · rank {INT(m.rank)} of{" "}
                  {INT(m.total)} by gap
                </span>
              </div>
              <div
                className="rca-search-hit-delta"
                style={{
                  color: m.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                }}
              >
                {MONEY(m.delta)}
              </div>
            </div>
            <div className="rca-sub">
              {MONEY_PLAIN(m.actual)} actual vs {MONEY_PLAIN(m.expected)}{" "}
              expected · {INT(m.orders)} orders vs {INT(m.expectedOrders)}{" "}
              expected · AOV ${INT(m.aov)} vs ${INT(m.baseAov)} baseline
            </div>
            <div className="rca-chips">
              {feedLists.map(i => (
                <button
                  type="button"
                  key={`f-${i.id}`}
                  className="rca-chip rca-chip-feed"
                  onClick={() =>
                    onOpenFocus(i.focus as string, i.focusLabel ?? i.q)
                  }
                >
                  {i.focusLabel ?? i.q}
                </button>
              ))}
              {m.lists
                .filter(l => l.kind === "node")
                .map(l => (
                  <button
                    type="button"
                    key={`n-${l.label}`}
                    className="rca-chip"
                    onClick={() =>
                      onOpenLens(l.lens ?? "total", l.key ?? "", l.label)
                    }
                  >
                    {l.label}
                    {l.value ? ` · ${l.value}` : ""}
                  </button>
                ))}
              {m.lists
                .filter(l => l.kind === "flag")
                .map(l =>
                  l.focus ? (
                    <button
                      type="button"
                      key={`g-${l.label}`}
                      className="rca-chip rca-chip-flag"
                      onClick={() =>
                        onOpenFocus(l.focus as string, l.label as string)
                      }
                    >
                      {l.label}
                    </button>
                  ) : (
                    <span
                      key={`g-${l.label}`}
                      className="rca-chip rca-chip-flag"
                    >
                      {l.label}
                    </span>
                  ),
                )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** One card in the business feed — shared by every feed layout. */
function FeedCard({
  item,
  isOpen,
  onOpen,
}: {
  item: FeedItem;
  isOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`rca-feed rca-feed-${item.tone}${isOpen ? " is-open" : ""}`}
      onClick={onOpen}
    >
      <span className="rca-feed-tag">{item.tag}</span>
      <span className="rca-feed-q">{item.q}</span>
      <span className="rca-feed-a">{item.a}</span>
      {item.detail && isOpen ? (
        <span className="rca-feed-detail">{item.detail}</span>
      ) : null}
      {item.focus ? (
        <span className="rca-feed-cta">show these clinics ↓</span>
      ) : null}
    </button>
  );
}

/** Design A: one independently auto-scrolling column of feed cards. */
function FeedColumn({
  items,
  openCard,
  onOpenCard,
}: {
  items: FeedItem[];
  openCard: string | null;
  onOpenCard: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused || items.length === 0) return;
    const timer = setInterval(() => {
      const node = ref.current;
      if (!node) return;
      const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 8;
      node.scrollTo({
        top: atEnd ? 0 : node.scrollTop + Math.max(100, node.clientHeight * 0.45),
        behavior: "smooth",
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [paused, items.length]);

  return (
    <div
      className="rca-feed-col"
      ref={ref}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map(item => (
        <FeedCard
          key={item.id}
          item={item}
          isOpen={openCard === item.id}
          onOpen={() => onOpenCard(item.id)}
        />
      ))}
    </div>
  );
}

/**
 * The business feed: turns the dashboard's numbers into short Q&A cards and
 * auto-scrolls through them in 4 columns, collapsible vertically in the main
 * page flow above the year-end projection (Design A, finalized 2026-09-08).
 * A search box finds a previously-seen question without hunting through
 * columns, and "raise a question" relays a free-text ask + the reader's
 * email to Slack (#internal-test) via convex/feed.ts:raiseQuestion.
 */
export function AlertRail({
  onFocus,
  teamLead,
}: {
  onFocus: (focus: string, label: string) => void;
  teamLead?: string;
}) {
  const feed = useRcaQuery(api.feed.feed, {
    password: pw(),
    teamLead: teamLead || undefined,
  });
  const raiseQuestion = useRcaAction(api.feed.raiseQuestion);
  const [open, setOpen] = useState(true);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [tag, setTag] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [askState, setAskState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const all: FeedItem[] = (feed?.items ?? []) as FeedItem[];
  const tags = [...new Set(all.map(i => i.tag))];
  const items = tag === "all" ? all : all.filter(i => i.tag === tag);
  const alerts = items.filter(i => i.tone === "alert").length;

  const searchTerm = search.trim().toLowerCase();
  const searchResults = searchTerm
    ? all.filter(
        i =>
          i.q.toLowerCase().includes(searchTerm) ||
          i.a.toLowerCase().includes(searchTerm) ||
          i.tag.toLowerCase().includes(searchTerm),
      )
    : [];

  const handleOpenCard = (id: string) => {
    setOpenCard(openCard === id ? null : id);
    const item = all.find(i => i.id === id);
    if (item?.focus) {
      onFocus(item.focus, item.focusLabel ?? item.q);
    }
  };

  const submitQuestion = async () => {
    const q = askText.trim();
    if (!q) return;
    setAskState("sending");
    try {
      await raiseQuestion({
        password: pw(),
        question: q,
        email: gateEmail(),
        context: "Business feed",
      });
      setAskState("sent");
      setAskText("");
      setTimeout(() => {
        setAskState("idle");
        setAskOpen(false);
      }, 2000);
    } catch {
      setAskState("error");
    }
  };

  if (!feed?.ready) {
    return null;
  }

  const numCols = 4;
  const columns: FeedItem[][] = Array.from({ length: numCols }, () => []);
  items.forEach((item, i) => columns[i % numCols].push(item));

  return (
    <section className={`rca-feed-shelf${open ? "" : " is-collapsed"}`}>
      <div className="rca-feed-shelf-head">
        <div>
          <div className="rca-eyebrow">
            Business feed{teamLead ? ` · ${teamLead}` : ""}
          </div>
          <div className="rca-rail-sub">
            {items.length} reads · {alerts} flagged
          </div>
        </div>
        <div className="rca-feed-shelf-actions">
          {open ? (
            <>
              <input
                type="text"
                className="rca-feed-search"
                placeholder="Search a question you read earlier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <button
                type="button"
                className="rca-tab rca-feed-ask-btn"
                onClick={() => setAskOpen(v => !v)}
              >
                {askOpen ? "cancel" : "raise a question"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="rca-tab"
            onClick={() => setOpen(v => !v)}
          >
            {open ? "collapse ▲" : `expand ▼ (${items.length} · ${alerts} flagged)`}
          </button>
        </div>
      </div>
      {open ? (
        <>
          {askOpen ? (
            <div className="rca-feed-ask">
              <textarea
                className="rca-feed-ask-input"
                placeholder="Type your question — it goes to the Decision Intelligence team with your email attached."
                value={askText}
                onChange={e => setAskText(e.target.value)}
                rows={2}
              />
              <div className="rca-feed-ask-actions">
                <button
                  type="button"
                  className="rca-gate-btn"
                  disabled={!askText.trim() || askState === "sending"}
                  onClick={submitQuestion}
                >
                  {askState === "sending" ? "Sending…" : askState === "sent" ? "Sent ✓" : "Send to Decision Intelligence team"}
                </button>
                {askState === "error" ? (
                  <span className="rca-feed-ask-error">Couldn't send — try again.</span>
                ) : null}
                <span className="rca-feed-ask-from">as {gateEmail() || "unknown"}</span>
              </div>
            </div>
          ) : null}
          {searchTerm ? (
            <div className="rca-feed-search-results">
              {searchResults.length === 0 ? (
                <div className="rca-feed-search-empty">No questions match "{search}".</div>
              ) : (
                searchResults.map(item => (
                  <FeedCard
                    key={item.id}
                    item={item}
                    isOpen={openCard === item.id}
                    onOpen={() => handleOpenCard(item.id)}
                  />
                ))
              )}
            </div>
          ) : (
            <>
              <div className="rca-rail-tags">
                <button
                  type="button"
                  className={`rca-tag-chip${tag === "all" ? " is-active" : ""}`}
                  onClick={() => setTag("all")}
                >
                  All · {all.length}
                </button>
                {tags.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`rca-tag-chip${tag === t ? " is-active" : ""}`}
                    onClick={() => setTag(tag === t ? "all" : t)}
                  >
                    {t} · {all.filter(i => i.tag === t).length}
                  </button>
                ))}
              </div>
              <div className="rca-feed-shelf-cols">
                {columns.map((col, i) => (
                  <FeedColumn
                    key={i}
                    items={col}
                    openCard={openCard}
                    onOpenCard={handleOpenCard}
                  />
                ))}
              </div>
            </>
          )}
          <div className="rca-rail-foot">
            Auto-scrolls · hover a card to pause and read it, click for detail,
            clinic cards also re-cut the list below · search finds a question
            you read earlier · raise a question to send it to the team
          </div>
        </>
      ) : null}
    </section>
  );
}

type Insight = {
  insightId: string;
  date: string;
  domain: string;
  topic: string;
  question?: string;
  focus?: string;
  focusLabel?: string;
  fact: string;
  inference: string;
  evidence: string[];
  confidence: string;
  relatedInsightIds: string[];
  action: string;
  status: string;
  tone: string;
  edited?: string[];
  sourceFeedId: string;
  cadence?: "daily" | "weekly" | "monthly";
};

const CONFIDENCE_OPTS = ["Low", "Medium", "High"];
const STATUS_OPTS = ["Monitoring", "On Track", "Informational", "Escalated", "Resolved"];
const CONFIDENCE_RANK: Record<string, number> = { Low: 1, Medium: 2, High: 3 };
/** Status → dot color for the history timeline strip (Shyam, 2026-09-24):
 * reuses the same semantics as the card's top-border tone. */
const STATUS_DOT_COLOR: Record<string, string> = {
  Escalated: "var(--vw-error)",
  Monitoring: "var(--vw-warning)",
  "On Track": "var(--vw-success)",
  Resolved: "var(--vw-success)",
  Informational: "var(--vw-blue)",
};
function statusDotColor(status: string): string {
  return STATUS_DOT_COLOR[status] ?? "var(--vw-gray-40)";
}

/** Compact glance at how one question moved across its weekly/monthly
 * history — a colored dot per snapshot (status) plus a confidence trend
 * arrow vs. the prior snapshot (Shyam, 2026-09-24). Cheaper than opening
 * History for every card; the full modal still has the exact numbers. */
function InsightTimelineStrip({ sourceFeedId, cadence }: { sourceFeedId: string; cadence: "weekly" | "monthly" }) {
  const rows = useQuery(api.insights.history, { password: pw(), sourceFeedId, cadence });
  if (!rows || rows.length < 2) return null; // nothing to compare yet
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const lastRank = CONFIDENCE_RANK[last.confidence] ?? 0;
  const prevRank = CONFIDENCE_RANK[prev.confidence] ?? 0;
  const trend = lastRank === prevRank ? "–" : lastRank > prevRank ? "▲" : "▼";
  const trendClass = lastRank === prevRank ? "is-flat" : lastRank > prevRank ? "is-up" : "is-down";
  const statusChanged = last.status !== prev.status;
  return (
    <div className="rca-insight-timeline" title={`Confidence ${prev.confidence} → ${last.confidence} vs prior ${cadence} snapshot`}>
      <div className="rca-insight-timeline-dots">
        {rows.map(r => (
          <span
            key={r.insightId}
            className="rca-insight-timeline-dot"
            style={{ background: statusDotColor(r.status) }}
            title={`${r.date}: ${r.status}`}
          />
        ))}
      </div>
      <span className={`rca-insight-timeline-trend ${trendClass}`}>
        {trend} conf.
      </span>
      {statusChanged ? <span className="rca-insight-timeline-changed">status changed</span> : null}
    </div>
  );
}

function InsightCard({
  item,
  onDrill,
  onHistory,
}: {
  item: Insight;
  onDrill?: (focus: string, label: string) => void;
  onHistory?: () => void;
}) {
  const update = useMutation(api.insights.update);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    confidence: item.confidence,
    action: item.action,
    status: item.status,
  });
  const [saving, setSaving] = useState(false);
  const edited = new Set(item.edited ?? []);

  const startEdit = () => {
    setDraft({
      confidence: item.confidence,
      action: item.action,
      status: item.status,
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await update({
        password: pw(),
        insightId: item.insightId,
        patch: {
          confidence: draft.confidence,
          action: draft.action,
          status: draft.status,
        },
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rca-insight-card rca-insight-${item.tone}`}>
      <div className="rca-insight-head">
        <div>
          <div className="rca-insight-id">{item.insightId}</div>
          <div
            className={`rca-insight-question${item.focus && onDrill ? " rca-insight-question-clickable" : ""}`}
            onClick={() => {
              if (item.focus && onDrill) onDrill(item.focus, item.focusLabel ?? item.question ?? item.topic);
            }}
          >
            {item.question ?? `${item.domain} · ${item.topic}`}
          </div>
          <div className="rca-rail-sub">
            {item.date} · {item.domain} · {item.topic}
          </div>
          {item.cadence && item.cadence !== "daily" ? (
            <InsightTimelineStrip sourceFeedId={item.sourceFeedId} cadence={item.cadence} />
          ) : null}
        </div>
        <div className="rca-insight-head-actions">
          {onHistory ? (
            <button type="button" className="rca-tab" onClick={onHistory}>
              history
            </button>
          ) : null}
          <button type="button" className="rca-tab" onClick={() => (editing ? setEditing(false) : startEdit())}>
            {editing ? "cancel" : "edit"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="rca-insight-edit">
          <label>CONFIDENCE</label>
          <select value={draft.confidence} onChange={e => setDraft(d => ({ ...d, confidence: e.target.value }))}>
            {CONFIDENCE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <label>ACTION</label>
          <textarea rows={2} value={draft.action} onChange={e => setDraft(d => ({ ...d, action: e.target.value }))} />
          <label>STATUS</label>
          <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
            {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <div className="rca-insight-edit-actions">
            <button type="button" className="rca-gate-btn" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rca-insight-row"><span>FACT</span><p>{item.fact}</p></div>
          <div className="rca-insight-row"><span>INFERENCE</span><p>{item.inference}</p></div>
          {item.evidence.length ? (
            <div className="rca-insight-row">
              <span>EVIDENCE</span>
              <ul>{item.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          ) : null}
          <div className="rca-insight-row"><span>CONFIDENCE</span><p>{item.confidence}{edited.has("confidence") ? " (edited)" : ""}</p></div>
          {item.relatedInsightIds.length ? (
            <div className="rca-insight-row">
              <span>RELATED</span>
              <p>{item.relatedInsightIds.join(", ")}</p>
            </div>
          ) : null}
          <div className="rca-insight-row"><span>ACTION</span><p>{item.action}{edited.has("action") ? " (edited)" : ""}</p></div>
          <div className="rca-insight-row"><span>STATUS</span><p>{item.status}{edited.has("status") ? " (edited)" : ""}</p></div>
        </>
      )}
    </div>
  );
}

/**
 * Business Feed, redesigned (Shyam, 2026-09-23): the same signals AlertRail
 * surfaces, but as persisted structured records — Insight ID, FACT,
 * INFERENCE, EVIDENCE, CONFIDENCE, RELATED, ACTION, STATUS — auto-populated
 * on every refresh and editable afterward. Company-wide only for now; the
 * existing question/answer shelf above still runs unchanged (not removed
 * yet — it drives the click-to-drill interaction the new tab doesn't have).
 */
const CADENCE_OPTS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;
type Cadence = (typeof CADENCE_OPTS)[number]["key"];

function InsightsView({
  teamLead,
  onDrill,
}: {
  teamLead?: string;
  onDrill?: (focus: string, label: string) => void;
}) {
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [snapDate, setSnapDate] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const dates = useQuery(
    api.insights.dates,
    cadence === "daily" ? "skip" : { password: pw(), cadence },
  );
  // Reset the picked snapshot date whenever the cadence tab changes.
  const dateList = cadence === "daily" ? undefined : (dates as string[] | undefined);
  const effectiveDate = cadence === "daily" ? undefined : snapDate ?? dateList?.[0];
  const data = useQuery(api.insights.list, {
    password: pw(),
    cadence,
    date: effectiveDate,
  });
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");

  const ready = !!data?.ready;
  const items = ready ? (data!.items as Insight[]) : [];
  const domains = [...new Set(items.map(i => i.domain))];
  const statuses = [...new Set(items.map(i => i.status))];
  const shown = items.filter(
    i => (domain === "all" || i.domain === domain) && (status === "all" || i.status === status),
  );

  // The cadence switcher always renders — even when the picked cadence has
  // no data yet — so a user can get back to a cadence that does.
  const cadenceTabs = (
    <div className="rca-view-tabs rca-cadence-tabs">
      {CADENCE_OPTS.map(c => (
        <button
          key={c.key}
          type="button"
          className={`rca-tab${cadence === c.key ? " is-active" : ""}`}
          onClick={() => {
            setCadence(c.key);
            setSnapDate(null);
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  if (!ready) {
    return (
      <div className="rca-insights">
        <div className="rca-insights-head">
          <div className="rca-eyebrow rca-section-title" style={{ marginTop: 0 }}>Business Feed — Insights{teamLead ? ` · ${teamLead}` : ""}</div>
          <div className="rca-insights-filters">{cadenceTabs}</div>
        </div>
        <div className="rca-insight-empty">
          {cadence === "daily"
            ? "No insights generated yet — run a refresh first."
            : `No ${cadence} snapshots yet — they build up automatically (${cadence === "weekly" ? "every Monday" : "on the 1st of each month"}), or wait for the history backfill to finish.`}
        </div>
      </div>
    );
  }

  return (
    <div className="rca-insights">
      <div className="rca-insights-head">
        <div>
          <div className="rca-eyebrow rca-section-title" style={{ marginTop: 0 }}>Business Feed — Insights{teamLead ? ` · ${teamLead}` : ""}</div>
          <div className="rca-rail-sub">
            As of {data!.date} · {shown.length} of {items.length} insights · company-wide (per-team-lead coming next)
          </div>
        </div>
        <div className="rca-insights-filters">
          {cadenceTabs}
          {cadence !== "daily" && dateList && dateList.length > 0 ? (
            <select value={effectiveDate ?? ""} onChange={e => setSnapDate(e.target.value)}>
              {dateList.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : null}
          <select value={domain} onChange={e => setDomain(e.target.value)}>
            <option value="all">All domains</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="rca-insights-grid">
        {shown.map(item => (
          <InsightCard
            key={item.insightId}
            item={item}
            onDrill={onDrill}
            onHistory={cadence !== "daily" ? () => setHistoryOf(item.sourceFeedId) : undefined}
          />
        ))}
      </div>
      {historyOf && cadence !== "daily" ? (
        <InsightHistoryPanel
          sourceFeedId={historyOf}
          cadence={cadence}
          onClose={() => setHistoryOf(null)}
        />
      ) : null}
    </div>
  );
}

/** How one question's FACT/INFERENCE/EVIDENCE/CONFIDENCE/ACTION/STATUS moved
 * across successive weekly or monthly snapshots (Shyam, 2026-09-23). */
function InsightHistoryPanel({
  sourceFeedId,
  cadence,
  onClose,
}: {
  sourceFeedId: string;
  cadence: "weekly" | "monthly";
  onClose: () => void;
}) {
  const rows = useQuery(api.insights.history, { password: pw(), sourceFeedId, cadence });
  return (
    <div className="rca-insight-history-overlay" onClick={onClose}>
      <div className="rca-insight-history" onClick={e => e.stopPropagation()}>
        <div className="rca-insight-history-head">
          <div className="rca-eyebrow">{cadence === "weekly" ? "Weekly" : "Monthly"} history</div>
          <button type="button" className="rca-tab" onClick={onClose}>close</button>
        </div>
        {!rows ? (
          <div className="rca-insight-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rca-insight-empty">No prior snapshots yet for this question.</div>
        ) : (
          <div className="rca-insight-history-table">
            <div className="rca-insight-history-row rca-insight-history-header">
              <span>Date</span><span>Insight ID</span><span>Fact</span><span>Confidence</span><span>Status</span>
            </div>
            {rows.map(r => (
              <div className="rca-insight-history-row" key={r.insightId}>
                <span>{r.date}</span>
                <span className="rca-insight-history-id">{r.insightId}</span>
                <span>{r.fact}</span>
                <span>{r.confidence}</span>
                <span>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Turns Convex's stack-trace-laden action errors into one readable line. */
function refreshErrorText(e: unknown): string {
  const raw = String(e);
  const marked = raw.indexOf("REFRESH_IN_PROGRESS: ");
  if (marked >= 0) {
    const rest = raw.slice(marked + "REFRESH_IN_PROGRESS: ".length);
    return rest.split(/\n|\s+at\s/)[0].slice(0, 220);
  }
  const uncaught = raw.lastIndexOf("Uncaught Error: ");
  const body = uncaught >= 0 ? raw.slice(uncaught + 16) : raw;
  return body.split(/\n|\s+at\s/)[0].slice(0, 220) || "Refresh failed.";
}


type ScopeTotals = {
  ready: boolean;
  newGoal?: number;
  clinics?: number;
  actual?: number;
  expected?: number;
  delta?: number;
  orders?: number;
  expectedOrders?: number;
  volume?: number;
  aovEffect?: number;
  bundleDelta?: number;
  nonBundleDelta?: number;
  patients?: number;
  expectedPatients?: number;
  aov?: number;
  baseAov?: number;
  cohorts?: Array<{ cohort: string; delta: number; clinics?: number; real?: number; ambition?: number }>;
  cohortCalibration?: number;
  baseline?: number;
  realChange?: number;
  ambition?: number;
};

const COHORT_LABEL: Record<string, string> = {
  churned: "Churned clinics",
  new: "New clinics (active)",
  retained_top20: "Active — top 20%",
  retained_rest: "Active — remaining 80%",
  reactivated: "Reactivated clinics",
};

/**
 * Re-express a period through one team lead's (or one sales rep's) clinics.
 * The clinic-level arithmetic is the same one the tree uses, so a filtered
 * lens still sums to the filtered total. The product-family lists are
 * pre-aggregated per lead and per rep (familyLeadSeries / familySalesSeries,
 * built from the same underlying rows in refresh.ts so the two reconcile) —
 * pass whichever one matches the current filter as `fams`.
 */
/** Lifecycle view of the cohort branch: retained top 20% + the rest are one stage, Active, cut by size.
 * The cohort rows themselves (and the narrative that reads them) stay as they are; only the tree groups them. */
/** The lenses split the existing-business goal; the new-business goal is one more line so each lens adds up to the shortfall against the whole goal. */
function withNewGoal(rows: Row[], newGoal?: number): Row[] {
  if (!newGoal) return rows;
  return [...rows, { label: "New business goal", sub: "slice of the target for this year's new clinics (group goal)", value: -newGoal, real: 0, ambition: newGoal, lens: "newgoal", key: "" }];
}

function groupActive(rows: Row[]): Row[] {
  const top = rows.find(r => r.key === "retained_top20");
  const rest = rows.find(r => r.key === "retained_rest");
  const fresh = rows.find(r => r.key === "new");
  if (!top || !rest) return rows;
  const clinicsSub = (r: Row, fallback: string) => (r.clinics !== undefined ? `${r.clinics.toLocaleString("en-US")} clinics` : fallback);
  // Active has three tiers (2026-10-18): New (this year's clinics still ordering), the largest 20%, everyone else.
  const parts = [fresh, top, rest].filter(Boolean) as Row[];
  const tiers: Row[] = [
    ...(fresh ? [{ ...fresh, label: "New", sub: clinicsSub(fresh, fresh.sub ?? "") }] : []),
    { ...top, label: "Largest 20%", sub: clinicsSub(top, top.sub ?? "") },
    { ...rest, label: "Everyone else", sub: clinicsSub(rest, rest.sub ?? "") },
  ];
  const n = parts.reduce((t, r) => t + (r.clinics ?? 0), 0);
  const allReal = parts.every(r => r.real !== undefined);
  const allAmb = parts.every(r => r.ambition !== undefined);
  const active: Row = {
    label: "Active clinics",
    sub: n ? `${n.toLocaleString("en-US")} clinics · still ordering` : "still ordering",
    value: parts.reduce((t, r) => t + r.value, 0),
    real: allReal ? parts.reduce((t, r) => t + (r.real ?? 0), 0) : undefined,
    ambition: allAmb ? parts.reduce((t, r) => t + (r.ambition ?? 0), 0) : undefined,
    lens: "cohort",
    key: "active",
    clinics: n || undefined,
    tiers,
  };
  return [...rows.filter(r => !parts.includes(r)), active].sort((a, b) => a.value - b.value);
}

type LeadFams = {
  ready: boolean;
  all: FamilyRow[];
  bundle: FamilyRow[];
  nonbundle: FamilyRow[];
} | null | undefined;

function scopePeriod(
  base: Period | undefined,
  scoped: ScopeTotals | null | undefined,
  geoRows: GeoRow[],
  fams?: LeadFams,
): Period | undefined {
  if (!base) return base;
  if (!scoped || !scoped.ready) return base;
  const int = (n: number) => Math.round(n).toLocaleString("en-US");
  const cohorts = [...(scoped.cohorts ?? [])].sort((a, b) => a.delta - b.delta);
  const geos = [...geoRows].sort((a, b) => a.delta - b.delta);
  const worst = geos.slice(0, 4);
  const rest = geos.slice(4);
  const restSum = rest.reduce((s, r) => s + r.delta, 0);
  return {
    ...base,
    actual: scoped.actual ?? 0,
    expected: scoped.expected ?? 0,
    newGoal: scoped.newGoal ?? 0,
    delta: scoped.delta ?? 0,
    orders: scoped.orders ?? 0,
    expectedOrders: scoped.expectedOrders ?? 0,
    aov: scoped.aov ?? 0,
    baseAov: scoped.baseAov ?? 0,
    patients: scoped.patients ?? 0,
    expectedPatients: scoped.expectedPatients ?? 0,
    families: fams?.ready ? fams.all : base.families,
    familiesBundle: fams?.ready ? fams.bundle : base.familiesBundle,
    familiesNonBundle: fams?.ready ? fams.nonbundle : base.familiesNonBundle,
    lensA: [
      {
        label: "Order volume",
        sub: `${int((scoped.orders ?? 0) - (scoped.expectedOrders ?? 0))} orders vs run rate`,
        value: scoped.volume ?? 0,
        lens: "volume",
        key: "",
      },
      {
        label: "Average order value",
        sub: `$${int(scoped.aov ?? 0)} vs $${int(scoped.baseAov ?? 0)} baseline`,
        value: scoped.aovEffect ?? 0,
        lens: "aov",
        key: "",
      },
      {
        label: "Patient traffic",
        sub: `${int(scoped.patients ?? 0)} patients vs ${int(scoped.expectedPatients ?? 0)} expected`,
        value: (scoped.patients ?? 0) - (scoped.expectedPatients ?? 0),
        unit: "patients" as const,
        base: scoped.expectedPatients ?? 0,
        lens: "traffic",
        key: "",
      },
    ],
    lensB: [
      {
        label: "Bundle orders",
        sub: `${int(scoped.clinics ?? 0)} clinics in scope`,
        value: scoped.bundleDelta ?? 0,
        lens: "bundle",
        key: "",
      },
      {
        label: "Non-bundle orders",
        sub: `${int(scoped.clinics ?? 0)} clinics in scope`,
        value: scoped.nonBundleDelta ?? 0,
        lens: "nonbundle",
        key: "",
      },
    ],
    lensC: cohorts.map(c => ({
      label: COHORT_LABEL[c.cohort] ?? c.cohort,
      sub: c.clinics ? `${int(c.clinics)} clinics` : "clinic cohort",
      value: c.delta,
      lens: "cohort",
      key: c.cohort,
      clinics: c.clinics,
      real: c.real,
      ambition: c.ambition,
    })),
    cohortCalibration: scoped.cohortCalibration,
    baseline: scoped.baseline,
    realChange: scoped.realChange,
    ambition: scoped.ambition,
    lensD: [
      ...worst.map(g => ({
        label: g.label,
        sub: `${int(g.clinics)} clinics`,
        value: g.delta,
        lens: "geo",
        key: g.key,
      })),
      ...(rest.length
        ? [
            {
              label: `All other geographies (${rest.length})`,
              sub: "combined",
              value: restSum,
              lens: "geo",
              key: `!${worst.map(g => g.key).join("/")}`,
            },
          ]
        : []),
    ],
    topStates: geos
      .slice(0, 6)
      .map(g => ({ state: g.label, value: g.delta })),
  };
}

export function RcaDashboardPage() {
  const data = useRcaQuery(api.bridge.bridge, { password: pw() });
  const refresh = useRcaAction(api.refresh.refreshNow);
  const setWindow = useMutation(api.config.setWindow);
  const setTarget = useMutation(api.config.setTarget);
  const clearRepWindowM = useMutation(api.config.clearRepWindow);
  const repWin = useQuery(api.config.repWindow, { password: pw() });
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [targetSaved, setTargetSaved] = useState(false);
  const [newGoalDraft, setNewGoalDraft] = useState<string | null>(null);
  const [scope, setScope] = useState<"month" | "week" | "day">("week");
  const [selected, setSelected] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [endDraft, setEndDraft] = useState<string | null>(null);
  const [autoEndDraft, setAutoEndDraft] = useState<boolean | null>(null);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
  const [bStartDraft, setBStartDraft] = useState<string | null>(null);
  const [bEndDraft, setBEndDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0); // bars shown in daily view; 0 = all
  const [pan, setPan] = useState(0); // index of the first visible bar
  const [drill, setDrill] = useState<{
    lens: string;
    key: string;
    label: string;
    focus?: string;
    /** For family drills: the bundle scope the family was opened from. */
    scope?: "all" | "bundle" | "nonbundle";
  } | null>(null);
  const [drillLimit, setDrillLimit] = useState(25);
  // Sales supervisor / team lead filter: scopes the tree, the map and every
  // clinic list to one leader's book.
  const [teamLead, setTeamLead] = useState<string>("");
  // Individual sales rep filter from the leaderboard above the wins panel.
  // Composes with the team-lead filter (both apply if both are set) and
  // re-scopes the tree, geography, projection and wins the same way
  // teamLead does; the product-mix family panel is pre-aggregated per team
  // lead only, so it does not re-scope to an individual rep.
  // Rep login (Shyam, 2026-09-25): the server pins every data call to this
  // rep's book regardless of what the client sends; the UI mirrors that by
  // starting on the rep and hiding the company-wide controls.
  const repLogin = useMemo(() => repSession(), []);
  const isRep = repLogin !== null;
  // Reps only get their own view: no company dashboard, no Business Feed.
  const [view, setView] = useState<"dashboard" | "feed" | "rep">(isRep ? "rep" : "dashboard");
  const [salesRep, setSalesRep] = useState<string>(repLogin?.rep ?? "");
  const [geoPick, setGeoPick] = useState<string | null>(null);
  // The map only appears once the geography branch is opened, and its tables
  // stay behind a "show as table" toggle so the page is not a wall of numbers.
  const [geoOpen, setGeoOpen] = useState(false);
  const [geoTable, setGeoTable] = useState(false);
  const [search, setSearch] = useState("");
  const [provSearch, setProvSearch] = useState("");
  const feedForSearch = useRcaQuery(
    api.feed.feed,
    isRep ? "skip" : { password: pw(), teamLead: teamLead || undefined },
  );
  // Which order universe the product-mix family list shows; opening either
  // product-mix row switches it, otherwise the chips decide.
  const [famScope, setFamScope] = useState<"bundle" | "nonbundle">("bundle");
  const famScopeShown: "bundle" | "nonbundle" =
    drill?.lens === "bundle"
      ? "bundle"
      : drill?.lens === "nonbundle"
        ? "nonbundle"
        : famScope;

  const periods: Period[] = useMemo(
    () => (data?.periods ?? []) as Period[],
    [data],
  );
  const periodIdSafe = periods.some(p => p.id === selected) ? selected : "all";
  const leads = useRcaQuery(api.geo.teamLeads, isRep ? "skip" : { password: pw() });
  // Product families for one lead are rebuilt from that lead's own day series.
  const leadFams = useRcaQuery(
    api.leadFamilies.leadFamilies,
    teamLead
      ? { password: pw(), periodId: periodIdSafe, teamLead }
      : "skip",
  );
  const leadFamsAll = useRcaQuery(
    api.leadFamilies.leadFamilies,
    teamLead && periodIdSafe !== "all"
      ? { password: pw(), periodId: "all", teamLead }
      : "skip",
  );
  // Same as leadFams/leadFamsAll above, but keyed by individual sales rep —
  // takes priority over the team-lead family lists when a rep is picked, so
  // the product-mix panel re-scopes to a rep the same way the rest of the
  // page does.
  const salesFams = useRcaQuery(
    api.leadFamilies.salesFamilies,
    salesRep
      ? { password: pw(), periodId: periodIdSafe, sales: salesRep }
      : "skip",
  );
  const salesFamsAll = useRcaQuery(
    api.leadFamilies.salesFamilies,
    salesRep && periodIdSafe !== "all"
      ? { password: pw(), periodId: "all", sales: salesRep }
      : "skip",
  );
  const geo = useRcaQuery(api.geo.geoSummary, {
    password: pw(),
    periodId: periodIdSafe,
    teamLead: teamLead || undefined,
    sales: salesRep || undefined,
  });
  const scopedActive = useRcaQuery(
    api.geo.scopeTotals,
    teamLead || salesRep
      ? {
          password: pw(),
          periodId: periodIdSafe,
          teamLead: teamLead || undefined,
          sales: salesRep || undefined,
        }
      : "skip",
  );
  // Positive/negative driver split per cohort, so lens C's tree branches can
  // each carry their own split inline instead of only after opening the
  // clinic list. Requested by Shyam 2026-09-06.
  const cohortDrivers = useRcaQuery(api.clinics.cohortDriverSplit, {
    password: pw(),
    periodId: periodIdSafe,
    teamLead: teamLead || undefined,
    sales: salesRep || undefined,
  });
  // Info icons next to each side of the inline cohort split: one opens just
  // the beating-baseline clinics ("risers"), the other just the
  // missing-baseline clinics ("losers") — two separate lists, not the
  // cohort's combined list (that's what clicking the row itself already
  // does). Requested by Shyam 2026-09-08.
  const openCohortDriverDrill = (
    e: React.MouseEvent | React.KeyboardEvent,
    key: string,
    label: string,
    focus: "risers" | "losers",
  ) => {
    e.stopPropagation();
    setDrillLimit(25);
    setSelected(active?.id ?? "all");
    setDrill({ lens: "cohort", key, label, focus });
    window.setTimeout(() => {
      document
        .querySelector(".rca-drill")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };
  const handleInfoIconKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).click();
    }
  };
  const scopedFull = useRcaQuery(
    api.geo.scopeTotals,
    teamLead || salesRep
      ? {
          password: pw(),
          periodId: "all",
          teamLead: teamLead || undefined,
          sales: salesRep || undefined,
        }
      : "skip",
  );
  const salesLeaderboard = useRcaQuery(api.geo.salesReps, {
    password: pw(),
    periodId: periodIdSafe,
    teamLead: teamLead || undefined,
  });
  // Same scope as the What's Working panel below — used only to fold a
  // "wins vs. gap" readout into the hero headline (Shyam 2026-09-08).
  const headlineWins = useRcaQuery(api.wins.winsSummary, {
    password: pw(),
    periodId: periodIdSafe,
    teamLead: teamLead || undefined,
    sales: salesRep || undefined,
  });
  const geoRows: GeoRow[] = useMemo(
    () => ((geo?.rows ?? []) as GeoRow[]),
    [geo],
  );
  const fullBase = periods.find(p => p.id === "all");
  const strip = periods.filter(p => p.kind === scope);
  // A period is only usable if every lens came back populated — mid-refresh the
  // supporting tables are cleared one at a time and the lenses can be empty.
  const complete = (p?: Period) =>
    !!p &&
    p.lensA.length >= 2 &&
    p.lensB.length >= 2 &&
    p.lensC.length > 0 &&
    p.lensD.length > 0;
  const activeBase = complete(periods.find(p => p.id === selected))
    ? periods.find(p => p.id === selected)!
    : fullBase;
  // With a team-lead filter on, every number in the tree comes from that
  // leader's clinics instead of the whole book.
  // A picked sales rep's family lists take priority over the team lead's;
  // both are "skip"-gated above so at most one pair is actually fetched.
  const famsFull = salesRep
    ? periodIdSafe === "all"
      ? salesFams
      : salesFamsAll
    : periodIdSafe === "all"
      ? leadFams
      : leadFamsAll;
  const famsActive = salesRep ? salesFams : leadFams;
  const full = scopePeriod(fullBase, scopedFull, geoRows, famsFull);
  const active = scopePeriod(activeBase, scopedActive, geoRows, famsActive);

  // If a refresh changes the period set (a new window, new week buckets), drop
  // any selection or drill that no longer exists rather than reading into it.
  const selectionMissing =
    selected !== "all" && !periods.some(p => p.id === selected);
  useEffect(() => {
    if (selectionMissing) {
      setSelected("all");
      setDrill(null);
    }
  }, [selectionMissing]);

  if (data === undefined) {
    return <div className="rca-loading">Loading revenue data…</div>;
  }
  if (data.ready && (!complete(full) || !complete(active))) {
    return (
      <div className="rca-loading">
        Refreshing data — reloading in a moment…
      </div>
    );
  }
  if (!data.ready || !full || !active) {
    return (
      <div className="rca-loading">
        <p>No data loaded yet.</p>
        <button
          type="button"
          className="rca-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refresh({ password: pw() });
              toast.success("Data loaded");
            } catch (e) {
              toast.error(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Loading from Power BI…" : "Load from Power BI"}
        </button>
      </div>
    );
  }

  const cfg = data.config!;
  const base = data.baseline!;
  const lastRefresh = data.lastRefresh;
  // A run is genuinely in flight only while its log row is open and young;
  // older open rows are dead runs that never closed their log.
  const refreshRunning =
    lastRefresh?.status === "running" &&
    Date.now() - lastRefresh.startedAt < 5 * 60 * 1000;

  const zoomable = scope === "day" && zoom > 0 && strip.length > zoom;
  const maxPan = zoomable ? Math.max(0, strip.length - zoom) : 0;
  const panAt = Math.min(pan, maxPan);
  const visible = zoomable ? strip.slice(panAt, panAt + zoom) : strip;
  const maxAbs = Math.max(...visible.map(p => Math.abs(p.delta)), 1);
  const lensMax = Math.max(
    ...LENS_META.flatMap(l => withNewGoal(active[l.key], active.newGoal).map(r => Math.abs(r.value))),
    1,
  );

  // The narrative follows the clicked day/week/month, not the full window.
  const narrativePeriod = selected === "all" ? full : active;
  const fullWorstCohort = narrativePeriod.lensC[0];
  // Fold the "what's working" outcome into the same headline instead of
  // leaving it shortfall-only: compare the $ from clinics beating baseline
  // against the $ dragging the book down to say whether wins are on track
  // to plug the gap or whether more of what's working is needed.
  // Requested by Shyam 2026-09-08.
  const positiveWins = headlineWins?.ready ? headlineWins.beatersRevenue : undefined;
  const positiveWinsCount = headlineWins?.ready ? headlineWins.beatersCount : undefined;
  const dragMagnitude = positiveWins !== undefined ? positiveWins - narrativePeriod.delta : undefined;
  const offsetShare =
    dragMagnitude !== undefined && dragMagnitude > 0 ? positiveWins! / dragMagnitude : undefined;
  const onTrackToPlug = offsetShare !== undefined && offsetShare >= 0.5;
  const winsClause =
    positiveWins === undefined
      ? ""
      : narrativePeriod.delta >= 0
        ? ` What's working is compounding it — ${INT(positiveWinsCount!)} clinics beating goal, worth ${MONEY_PLAIN(positiveWins!)}.`
        : offsetShare === undefined
          ? ""
          : onTrackToPlug
            ? ` What's working is already offsetting ${MONEY_PLAIN(positiveWins!)} (${Math.round(offsetShare * 100)}% of the drag) — on track to keep closing the gap.`
            : ` What's working is only offsetting ${MONEY_PLAIN(positiveWins!)} (${Math.round(offsetShare * 100)}% of the drag) — more wins are needed to plug the shortfall.`;
  // Special-case narrative for when the retained top-20% cohort is itself
  // the thing dragging the book down (their own decline outweighs
  // everyone else's gains, causing the shortfall). Threshold at 70%
  // recovered: >=70% reads as "closing in fast", <70% reads as "closing in
  // slower" with a harder call-out of the drag. Formula-driven off the same
  // positiveWins/offsetShare figures winsClause already computes above — no
  // hardcoded $ or % values. Requested by Shyam, 2026-09-24.
  const top20Dragging =
    fullWorstCohort.key === "retained_top20" && fullWorstCohort.value < 0;
  const strongPace = offsetShare !== undefined && offsetShare >= 0.7;
  const top20Headline =
    top20Dragging && positiveWins !== undefined && offsetShare !== undefined
      ? `We've gained ${strongPace ? "" : "only "}${MONEY_PLAIN(positiveWins)} so far (${Math.round(offsetShare * 100)}% of the gap) and ${strongPace ? "are closing in fast" : "closing in slower"}. The drag: our top 20% of customers are ${strongPace ? "underperforming enough to outweigh everyone else's gains" : "underperforming much higher than everyone else"}.`
      : undefined;

  const headline =
    top20Headline ??
    (narrativePeriod.delta >= 0
      ? "Revenue is running ahead of goal."
      : `${fullWorstCohort.label.replace("—", "").replace(/\s+/g, " ")} carry ${Math.abs(Math.round((fullWorstCohort.value / narrativePeriod.delta) * 100))}% of the shortfall.`) +
      winsClause;

  const volume = active.lensA[0].value;
  const aovEffect = active.lensA[1].value;
  const worstCohort = active.lensC[0];
  const worstStates = active.lensD[0];
  const trafficRow = active.lensA.find(r => r.unit === "patients");
  // Q1: family with the deepest ORDER gap, bundle and non-bundle universes
  // reported separately (revenue can't be split per family — one order can
  // carry several). "Unmapped" is the à-la-carte bucket, not a real family.
  const worstFamIn = (list: FamilyRow[]) =>
    [...list]
      .filter(f => f.family !== "Unmapped")
      .sort((a, b) => a.orderDelta - b.orderDelta)[0];
  const worstBundleFam = worstFamIn(active.familiesBundle);
  const worstNonBundleFam = worstFamIn(active.familiesNonBundle);
  const worstFamily =
    (worstBundleFam?.orderDelta ?? 0) <= (worstNonBundleFam?.orderDelta ?? 0)
      ? { ...worstBundleFam, scope: "bundle orders" }
      : { ...worstNonBundleFam, scope: "non-bundle orders" };
  const pct = (v: number) => {
    if (active.delta === 0) return "—";
    const share = Math.round((Math.abs(v) / Math.abs(active.delta)) * 100);
    const sameDirection = v < 0 === active.delta < 0;
    const noun = active.delta < 0 ? "gap" : "gain";
    return sameDirection ? `${share}% of ${noun}` : `${share}% offset`;
  };

  const savedSource = (cfg as { baselineSource?: string }).baselineSource ?? "best";
  const sourceNow = sourceDraft ?? savedSource;
  const bStartNow = bStartDraft ?? cfg.baselineStart;
  const bEndNow = bEndDraft ?? cfg.baselineEnd;
  const dirty =
    (startDraft !== null && startDraft !== cfg.currentStart) ||
    (endDraft !== null && endDraft !== cfg.currentEnd) ||
    (autoEndDraft !== null && autoEndDraft !== cfg.autoEnd) ||
    sourceNow !== savedSource ||
    (sourceNow === "custom" && (bStartNow !== cfg.baselineStart || bEndNow !== cfg.baselineEnd));

  // One shared window for everyone: Apply stores it and rebuilds the snapshot.
  const applyRepWindow = async () => {
    setBusy(true);
    try {
      await setWindow({
        password: pw(),
        currentStart: startDraft ?? cfg.currentStart,
        currentEnd: endDraft ?? cfg.currentEnd,
        autoEnd: false,
        lagDays: cfg.lagDays ?? 1,
        baselineMode: base.mode,
        baselineSource: sourceNow,
        ...(sourceNow === "custom" ? { baselineStart: bStartNow, baselineEnd: bEndNow } : {}),
      });
      setSelected("all");
      setStartDraft(null);
      setEndDraft(null);
      setSourceDraft(null);
      setBStartDraft(null);
      setBEndDraft(null);
      toast.success("Window saved. Recalculating for everyone…");
      const res = await refresh({ password: pw() });
      toast.success(`Recalculated — data through ${res.dataThrough}`);
    } catch (e) {
      toast.error(String(e).replace(/^.*Error: /, "").slice(0, 160));
    } finally {
      setBusy(false);
    }
  };
  const repDirty =
    (startDraft !== null && startDraft !== cfg.currentStart) ||
    (endDraft !== null && endDraft !== cfg.currentEnd);
  const repCalculating = repWin?.status === "running";

  const applyWindow = applyRepWindow;
  void autoEndDraft; void setAutoEndDraft;

  const doRefresh = async () => {
    setBusy(true);
    try {
      const res = await refresh({ password: pw() });
      toast.success(`Refreshed — data through ${res.dataThrough}`);
    } catch (e) {
      toast.error(refreshErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rca-root${busy || refreshRunning ? " rca-root-busy" : ""}`}
      aria-busy={busy || refreshRunning}
    >
      {settingsOpen ? (
        <>
          <div
            className="rca-drawer-scrim"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="rca-drawer">
            <div className="rca-drawer-head">
              <div className="rca-eyebrow">Settings</div>
              <button
                type="button"
                className="rca-tab"
                onClick={() => setSettingsOpen(false)}
              >
                close
              </button>
            </div>
            <div className="rca-drawer-body">
              <section className="rca-card rca-controls">
                <div className="rca-controls-row">
                  <label>
                    Baseline period
                    <select
                      value={sourceNow}
                      onChange={e => setSourceDraft(e.target.value)}
                    >
                      <option value="trailing">
                        Last 13 weeks before the window
                      </option>
                      <option value="best">
                        Best 13 weeks (91 days) of data before the window
                      </option>
                      <option value="custom">Custom dates</option>
                    </select>
                  </label>
                  {sourceNow === "custom" ? (
                    <>
                      <label>
                        From
                        <input
                          type="date"
                          min="2025-01-01"
                          value={bStartNow}
                          onChange={e => setBStartDraft(e.target.value)}
                        />
                      </label>
                      <label>
                        To
                        <input
                          type="date"
                          value={bEndNow}
                          onChange={e => setBEndDraft(e.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="rca-btn"
                    disabled={busy || !dirty}
                    onClick={applyWindow}
                  >
                    {busy ? "Recomputing…" : "Apply & recompute"}
                  </button>
                </div>
                <div className="rca-controls-row">
                  <label>
                    2026 revenue target ($)
                    <input
                      type="number"
                      step={1000000}
                      min={0}
                      value={
                        targetDraft ??
                        String(
                          (cfg as { annualTarget?: number }).annualTarget ??
                            130000000,
                        )
                      }
                      onChange={e => {
                        setTargetDraft(e.target.value);
                        setTargetSaved(false);
                      }}
                    />
                  </label>
                  <label>
                    New-business goal ($)
                    <input
                      type="number"
                      step={500000}
                      min={0}
                      value={
                        newGoalDraft ??
                        String(
                          (cfg as { newBusinessGoal?: number }).newBusinessGoal ??
                            Math.round((cfg as { newGoalDefault?: number | null }).newGoalDefault ?? 0.05 * ((cfg as { annualTarget?: number }).annualTarget ?? 130000000)),
                        )
                      }
                      onChange={e => {
                        setNewGoalDraft(e.target.value);
                        setTargetSaved(false);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="rca-btn"
                    disabled={targetDraft === null && newGoalDraft === null}
                    onClick={async () => {
                      const n = Number(targetDraft ?? (cfg as { annualTarget?: number }).annualTarget ?? 130000000);
                      if (!Number.isFinite(n) || n <= 0) return;
                      const g = newGoalDraft === null ? undefined : Number(newGoalDraft);
                      if (g !== undefined && (!Number.isFinite(g) || g < 0 || g > n)) return;
                      await setTarget({ password: pw(), annualTarget: n, ...(g === undefined ? {} : { newBusinessGoal: g }) });
                      setTargetDraft(null);
                      setNewGoalDraft(null);
                      setTargetSaved(true);
                    }}
                  >
                    Save target
                  </button>
                </div>
                <div className="rca-control-note">
                  The target drives the year-end projection card and the Goal:
                  it is spread over the year by baseline weekday weights, so
                  every goal (period, rep, clinic) adds up to it. The
                  new-business goal is the slice of it given to this year's new
                  clinics as a group (default: last year's new-clinic revenue,
                  phased by last year's monthly shape and split over reps by
                  their baseline share); existing clinics carry the rest. It applies
                  instantly — no Power BI refresh needed.
                  {targetSaved ? " Saved." : ""}
                </div>
                {(() => {
                  const base = (cfg as { yearBaseline?: number | null }).yearBaseline;
                  const t = Number(targetDraft ?? (cfg as { annualTarget?: number }).annualTarget ?? 130000000);
                  const ng = Number(newGoalDraft ?? (cfg as { newBusinessGoal?: number }).newBusinessGoal ?? (cfg as { newGoalDefault?: number | null }).newGoalDefault ?? 0.05 * t);
                  if (base && t - ng < base)
                    return (
                      <div className="rca-control-note" style={{ color: "var(--bad, #b42318)" }}>
                        With a new-business goal of {"$"}{(ng / 1e6).toFixed(1)}M, existing clinics carry {"$"}{((t - ng) / 1e6).toFixed(1)}M against
                        their {"$"}{(base / 1e6).toFixed(1)}M a year baseline: their goals sit under baseline, so their
                        ambition shows negative. The most the new-business goal can be is {"$"}{(Math.max(0, t - base) / 1e6).toFixed(1)}M.
                      </div>
                    );
                  return base && t < base ? (
                    <div className="rca-control-note" style={{ color: "var(--bad, #b42318)" }}>
                      Target is below the current run rate ({"$"}{(base / 1e6).toFixed(1)}M a year): goals sit
                      under baseline, so ambition shows negative.
                    </div>
                  ) : null;
                })()}
                <div className="rca-control-note">
                  Current:{" "}
                  <strong>
                    {cfg.currentStart} → {cfg.currentEnd}
                  </strong>{" "}
                  measured against <strong>{base.modeLabel}</strong> (
                  {base.start} → {base.end}
                  {base.bucket === "dow"
                    ? ", each day compared with the average of the same weekday"
                    : ", weekday and weekend days rated separately"}
                  ).{" "}
                  The baseline is the mean run rate of that period, by weekday.
                  The goal is the annual target spread over the year by those
                  weekday weights, so a higher baseline period lowers the
                  goal's stretch above it.{" "}
                  Changing any of these re-pulls Power BI and recomputes
                  every lens, which takes about 30 seconds. Clinic cohorts are
                  defined against the baseline you pick: "churned" means active
                  in the baseline window and silent since, "new" the reverse, so
                  the cohort split shifts when the baseline changes.
                </div>
              </section>
              <AccessLogCard />
              <RepAccountsCard />
            </div>
          </aside>
        </>
      ) : null}
      <header className="rca-topbar">
        <div className="rca-wordmark"><Logo tone="white" height={22} /></div>
        {isRep ? null : (
        <div className="rca-view-tabs">
          <button
            type="button"
            className={`rca-tab${view === "dashboard" ? " is-active" : ""}`}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`rca-tab${view === "rep" ? " is-active" : ""}`}
            onClick={() => setView("rep")}
          >
            Rep view
          </button>
          {isRep ? null : (
            <button
              type="button"
              className={`rca-tab${view === "feed" ? " is-active" : ""}`}
              onClick={() => setView("feed")}
            >
              Business Feed
            </button>
          )}
        </div>
        )}
          <span className="rca-eyebrow rca-dim rca-top-sub">
            Revenue root cause · {selected === "all"
              ? `${fmtDate(cfg.currentStart)} – ${fmtDate(cfg.currentEnd)}`
              : `${fmtDate(active.start)} – ${fmtDate(active.end)}`}
          </span>
        <div className="rca-topbar-right">
          {isRep ? (
            <>
              <span className="rca-rep-badge">
                Viewing <strong>{repLogin!.rep}</strong>'s book
              </span>
              <input
                className="rca-search-input"
                type="search"
                placeholder="Search clinic…"
                aria-label="Search clinic"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <input
                className="rca-search-input"
                type="search"
                placeholder="Search provider…"
                aria-label="Search provider"
                value={provSearch}
                onChange={e => setProvSearch(e.target.value)}
              />
              <button
                type="button"
                className="rca-btn rca-btn-ghost rca-top-push"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
          <input
            className="rca-search-input"
            type="search"
            placeholder="Search clinic…"
            aria-label="Search clinic"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="rca-lead-select"
            aria-label="Filter by sales supervisor"
            value={teamLead}
            onChange={e => {
              setTeamLead(e.target.value);
              setDrill(null);
            }}
          >
            <option value="">All team leads</option>
            {(leads ?? []).map(l => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="rca-lead-select"
            aria-label="Filter by sales rep"
            value={salesRep}
            onChange={e => {
              setSalesRep(e.target.value);
              setDrill(null);
            }}
          >
            <option value="">All reps</option>
            {[...(salesLeaderboard ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(r => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
          </select>
          <input
            className="rca-search-input"
            type="search"
            placeholder="Search provider…"
            aria-label="Search provider"
            value={provSearch}
            onChange={e => setProvSearch(e.target.value)}
          />
          <div className="rca-topwin">
            <input
              type="date"
              aria-label="Window starts"
              value={startDraft ?? cfg.currentStart}
              onChange={e => setStartDraft(e.target.value)}
            />
            <span className="rca-topwin-dash">→</span>
            <input
              type="date"
              aria-label="Window ends"
              value={endDraft ?? cfg.currentEnd}
              onChange={e => setEndDraft(e.target.value)}
            />
            <button
              type="button"
              className="rca-btn rca-btn-ghost"
              disabled={busy || !repDirty}
              onClick={applyWindow}
            >
              {busy ? "Applying…" : "Apply"}
            </button>
            {repWin && repWin.status !== "none" ? (
              <button
                type="button"
                className="rca-btn rca-btn-ghost"
                title="Go back to the team's default dates"
                onClick={() => {
                  setStartDraft(null);
                  setEndDraft(null);
                  void clearRepWindowM({ password: pw() });
                }}
              >
                Reset
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={`rca-btn rca-btn-ghost rca-top-push${settingsOpen ? " is-active" : ""}`}
            onClick={() => setSettingsOpen(v => !v)}
          >
            ⚙ Settings
          </button>
          <button
            type="button"
            className="rca-btn rca-btn-ghost"
            onClick={doRefresh}
            disabled={busy || refreshRunning}
          >
            {busy || refreshRunning ? "Refreshing…" : "Refresh data"}
          </button>
                    </>
          )}
        </div>
      </header>

      {(repCalculating || repWin?.status === "error") ? (
        <div className={`rca-rep-calc${repWin?.status === "error" ? " is-error" : ""}`}>
          {repWin?.status === "error"
            ? `Couldn't calculate ${repWin.reqStart} → ${repWin.reqEnd}. Try Apply again. (${(repWin.error ?? "").slice(0, 120)})`
            : `Calculating your view for ${repWin?.reqStart} → ${repWin?.reqEnd}… the numbers below are ${repWin?.hasData ? "your previous dates" : "the default dates"} until it finishes.`}
        </div>
      ) : null}
      <div className="rca-page">
        {view === "rep" ? (
          <RepView
            sales={salesRep}
            isRep={isRep}
            periodId={periodIdSafe}
            periodLabel={
              periodIdSafe === "all"
                ? `${fmtDate(cfg.currentStart)} – ${fmtDate(cfg.currentEnd)}`
                : `${fmtDate(active.start)} – ${fmtDate(active.end)}`
            }
            weeks={periods.filter(p => p.kind === "week")}
            months={periods.filter(p => p.kind === "month")}
            quarters={periods.filter(p => p.kind === "quarter")}
            days={periods.filter(p => p.kind === "day")}
            reps={(salesLeaderboard ?? []).map(r => r.name).sort()}
            onPickRep={setSalesRep}
            clinicTerm={search}
            provTerm={provSearch}
            onClearSearch={() => { setSearch(""); setProvSearch(""); }}
          />
        ) : view === "feed" ? (
          <InsightsView
            teamLead={teamLead || undefined}
            onDrill={(focus, label) => {
              setDrillLimit(25);
              setSelected("all");
              if (focus.startsWith("pair:")) {
                setDrill({ lens: "pair", key: focus.slice(5), label });
              } else {
                setDrill({ lens: "total", key: "", label, focus });
              }
              setView("dashboard");
              window.setTimeout(() => {
                document
                  .querySelector(".rca-drill")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 150);
            }}
          />
        ) : (
        <>
        <div className="rca-hero">
          <div className="rca-hero-copy">
            <h1>{selected === "all" ? headline : `${fmtDate(active.start)} – ${fmtDate(active.end)}: ${headline}`}</h1>
            <p>
              Baseline: {base.modeLabel.toLowerCase()} — {fmtDate(base.start)} –{" "}
              {fmtDate(base.end)} ({INT(base.ordersPerWeekday)} orders per
              weekday, {INT(base.ordersPerWeekend)} per weekend day, $
              {INT(base.aov)} AOV), applied per day type so partial and
              holiday-heavy weeks stay comparable. Each lens is a different cut
              of the same shortfall, not additive to the others.
            </p>
          </div>
          <div className="rca-hero-kpis">
            <div>
              <div className="rca-eyebrow">Expected</div>
              <div className="rca-kpi">{MONEY_PLAIN(narrativePeriod.expected)}</div>
            </div>
            <div>
              <div className="rca-eyebrow">Actual</div>
              <div className="rca-kpi">{MONEY_PLAIN(narrativePeriod.actual)}</div>
            </div>
            <div className="rca-kpi-divider">
              <div className="rca-eyebrow">Shortfall</div>
              <div
                className="rca-kpi rca-kpi-lg"
                style={{
                  color:
                    narrativePeriod.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                }}
              >
                {MONEY(narrativePeriod.delta)}
              </div>
            </div>
          </div>
        </div>

        {isRep ? null : (
        <AlertRail
          teamLead={teamLead || undefined}
          onFocus={(focus, label) => {
            setDrillLimit(25);
            setSelected("all");
            if (focus.startsWith("pair:")) {
              setDrill({ lens: "pair", key: focus.slice(5), label });
            } else {
              setDrill({ lens: "total", key: "", label, focus });
            }
            window.setTimeout(() => {
              document
                .querySelector(".rca-drill")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
        />

        )}

        <YearProjection teamLead={teamLead} sales={salesRep} />

        <ProviderSearchResults
          term={provSearch}
          onClose={() => setProvSearch("")}
        />

        <ClinicSearchResults
          term={search}
          feedItems={(feedForSearch?.items ?? []) as FeedItem[]}
          onOpenFocus={(focus, label) => {
            setDrillLimit(25);
            setSelected("all");
            setDrill({ lens: "total", key: "", label, focus });
            window.setTimeout(() => {
              document
                .querySelector(".rca-drill")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
          onOpenLens={(lens, key, label) => {
            setDrillLimit(25);
            setSelected("all");
            setDrill({ lens, key, label });
            window.setTimeout(() => {
              document
                .querySelector(".rca-drill")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
          onClose={() => setSearch("")}
        />

        <section className="rca-card rca-strip-card">
          <div className="rca-strip-head">
            <div>
              <div className="rca-eyebrow">Delta vs run rate</div>
              <div className="rca-sub">
                Click a bar to re-cut the tree below. Currently showing{" "}
                <strong>
                  {active.id === "all" ? "the full window" : active.label}
                </strong>
                .
              </div>
            </div>
            <div className="rca-tabs">
              {(["month", "week", "day"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`rca-tab${scope === s ? " is-active" : ""}`}
                  onClick={() => {
                    setScope(s);
                    setSelected("all");
                  }}
                >
                  {s === "month"
                    ? "Monthly"
                    : s === "week"
                      ? "Weekly"
                      : "Daily"}
                </button>
              ))}
              <button
                type="button"
                className={`rca-tab${selected === "all" ? " is-active" : ""}`}
                onClick={() => setSelected("all")}
              >
                Full window
              </button>
            </div>
          </div>

          {scope === "day" ? (
            <div className="rca-zoombar">
              <span className="rca-eyebrow rca-dim">Zoom</span>
              {[
                { n: 14, l: "14d" },
                { n: 30, l: "30d" },
                { n: 60, l: "60d" },
                { n: 90, l: "90d" },
                { n: 0, l: "all" },
              ].map(z => (
                <button
                  type="button"
                  key={z.l}
                  className={`rca-tab${zoom === z.n ? " is-active" : ""}`}
                  onClick={() => {
                    setZoom(z.n);
                    setPan(z.n ? Math.max(0, strip.length - z.n) : 0);
                  }}
                >
                  {z.l}
                </button>
              ))}
              {zoomable ? (
                <>
                  <button
                    type="button"
                    className="rca-tab"
                    disabled={panAt === 0}
                    onClick={() =>
                      setPan(Math.max(0, panAt - Math.ceil(zoom / 2)))
                    }
                  >
                    ←
                  </button>
                  <input
                    className="rca-range"
                    type="range"
                    min={0}
                    max={maxPan}
                    value={panAt}
                    onChange={e => setPan(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="rca-tab"
                    disabled={panAt >= maxPan}
                    onClick={() =>
                      setPan(Math.min(maxPan, panAt + Math.ceil(zoom / 2)))
                    }
                  >
                    →
                  </button>
                  <span className="rca-eyebrow rca-dim">
                    {fmtDate(visible[0].start)} –{" "}
                    {fmtDate(visible[visible.length - 1].end)}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="rca-strip">
            <div className="rca-zero" />
            {visible.map(p => {
              const h = (Math.abs(p.delta) / maxAbs) * 105;
              const neg = p.delta < 0;
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`rca-bar-slot${selected === p.id ? " is-selected" : ""}`}
                  onClick={() => setSelected(p.id)}
                  title={`${p.label}: ${MONEY(p.delta)}`}
                >
                  <span
                    className="rca-bar"
                    style={{
                      top: neg ? 110 : 110 - h,
                      height: h,
                      background: neg ? "var(--vw-error)" : "var(--vw-success)",
                    }}
                  />
                  <span
                    className="rca-bar-value"
                    style={{ top: neg ? 110 + h + 4 : 110 - h - 16 }}
                  >
                    {scope === "day" ? "" : MONEY(p.delta)}
                  </span>
                  <span className="rca-bar-label">{p.label}</span>
                  {p.holiday || p.partial ? (
                    <span className="rca-bar-flag">
                      {p.holiday ?? "partial"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <div className="rca-eyebrow rca-section-title">The four questions</div>
        <div className="rca-grid-4">
          <ReadoutCard
            n="Q1"
            q="Which product family contributes the biggest gap?"
            value={worstFamily.family ?? "—"}
            tone={(worstFamily.orderDelta ?? 0) < 0 ? "bad" : "good"}
            body={`${INT(Math.abs(worstFamily.orderDelta ?? 0))} orders short in ${worstFamily.scope}. Inside bundles the biggest drag is ${worstBundleFam ? `${worstBundleFam.family} (${INT(Math.abs(worstBundleFam.orderDelta))} orders)` : "none"}; outside bundles it is ${worstNonBundleFam ? `${worstNonBundleFam.family} (${INT(Math.abs(worstNonBundleFam.orderDelta))} orders)` : "none"}. Orders only — an order can carry several families.`}
          />
          <ReadoutCard
            n="Q2"
            q="Volume, price or patient traffic?"
            value={Math.abs(volume) > Math.abs(aovEffect) ? "Volume" : "Price"}
            body={`${INT(Math.abs(active.orders - active.expectedOrders))} orders ${active.orders < active.expectedOrders ? "never came in" : "above goal"}, worth ${MONEY(volume)}. AOV moved ${MONEY(aovEffect)} the other way ($${INT(active.aov)} vs $${INT(active.baseAov)})${trafficRow ? `, and ${INT(Math.abs(trafficRow.value))} ${trafficRow.value < 0 ? "fewer" : "more"} patients walked in` : ""}.`}
          />
          <ReadoutCard
            n="Q3"
            q="Which clinics?"
            value={worstCohort.label.replace("Active — ", "Active ")}
            tone={worstCohort.value < 0 ? "bad" : "good"}
            body={`${worstCohort.sub} at ${MONEY(worstCohort.value)}, ${pct(worstCohort.value)}. ${active.lensC[active.lensC.length - 1].label} runs ${MONEY(active.lensC[active.lensC.length - 1].value)}.`}
          />
          <ReadoutCard
            n="Q4"
            q="Where?"
            value={worstStates.label}
            tone={worstStates.value < 0 ? "bad" : "good"}
            body={`${worstStates.label} carry ${MONEY(worstStates.value)} (${pct(worstStates.value)}).${active.lensD[1] ? ` Every other state nets ${MONEY(active.lensD[1].value)}.` : ""}`}
          />
        </div>

        <SalesLeaderboard
          rows={salesLeaderboard ?? []}
          active={salesRep}
          locked={isRep}
          onPick={name => {
            if (isRep) return;
            setSalesRep(prev => (prev === name ? "" : name));
          }}
        />

        <WinsPanel
          periodId={periodIdSafe}
          teamLead={teamLead || undefined}
          sales={salesRep || undefined}
          onFocus={(focus, label) => {
            setDrillLimit(25);
            setSelected("all");
            setDrill({ lens: "total", key: "", label, focus });
            window.setTimeout(() => {
              document
                .querySelector(".rca-drill")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
        />

        <div className="rca-section-head">
          <div className="rca-eyebrow">Shortfall tree</div>
          <div className="rca-sub">
            {active.id === "all"
              ? `Full window · expected ${MONEY_PLAIN(active.expected)}, actual ${MONEY_PLAIN(active.actual)}`
              : `${active.label} (${fmtDate(active.start)} – ${fmtDate(active.end)}) · expected ${MONEY_PLAIN(active.expected)}, actual ${MONEY_PLAIN(active.actual)}`}
            {active.holiday ? ` · contains ${active.holiday}` : ""}
          </div>
        </div>

        <div className="rca-tree">
          {/* Expected / actual flank the root so the shortfall reads in context. */}
          <div className="rca-root-row">
            <div className="rca-root-side">
              <div className="rca-eyebrow rca-dim">Goal</div>
              <div className="rca-root-side-value">
                {MONEY_PLAIN(active.expected)}
              </div>
              <div className="rca-eyebrow rca-dim">
                {INT(active.expectedOrders)} orders · AOV ${INT(active.baseAov)}
              </div>
              {active.baseline !== undefined ? (
                <div className="rca-eyebrow rca-dim" title="Mean run rate over the baseline window; the goal is the Settings target spread over the year by baseline weekday weights">
                  Baseline {MONEY_PLAIN(active.baseline)}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="rca-root-node"
              onClick={() => {
                setDrillLimit(25);
                setDrill(
                  drill && drill.lens === "total"
                    ? null
                    : {
                        lens: "total",
                        key: "",
                        label:
                          active.id === "all"
                            ? "Total shortfall"
                            : active.label,
                      },
                );
              }}
            >
              <div className="rca-eyebrow rca-dim">
                {active.id === "all" ? "Total shortfall" : active.label}
              </div>
              <div
                className="rca-root-value"
                style={{
                  color:
                    active.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                }}
              >
                {MONEY(active.delta)}
              </div>
              <div className="rca-eyebrow rca-dim">
                {Math.abs((active.delta / active.expected) * 100).toFixed(1)}%{" "}
                {active.delta < 0 ? "below" : "above"} goal
              </div>
              {active.realChange !== undefined && active.ambition !== undefined ? (
                <div className="rca-root-split" title="Shortfall vs goal = real change (actual − baseline) minus ambition (goal − baseline)">
                  <span style={{ color: active.realChange < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>Real change {MONEY(active.realChange)}</span>
                  <span style={{ color: active.ambition > 0 ? "var(--vw-error)" : "var(--vw-success)" }}>Ambition {MONEY(-active.ambition)}</span>
                </div>
              ) : null}
              <div className="rca-eyebrow rca-blue">
                {drill && drill.lens === "total"
                  ? "hide clinics"
                  : "clinic detail ↓"}
              </div>
            </button>
            <div className="rca-root-side">
              <div className="rca-eyebrow rca-dim">Actual</div>
              <div className="rca-root-side-value">
                {MONEY_PLAIN(active.actual)}
              </div>
              <div className="rca-eyebrow rca-dim">
                {INT(active.orders)} orders · AOV ${INT(active.aov)}
              </div>
            </div>
          </div>
          <div className="rca-stem" />
          <div className="rca-crossbar" />
          <div className="rca-grid-4">
            {LENS_META.map(lens => (
              <div key={lens.key}>
                <div className="rca-stem" />
                <div className="rca-card rca-lens">
                  {lens.key === "lensD" ? (
                    <button
                      type="button"
                      className={`rca-lens-head rca-lens-head-btn${geoOpen ? " is-open" : ""}`}
                      onClick={() => {
                        const next = !geoOpen;
                        setGeoOpen(next);
                        if (next) {
                          window.setTimeout(() => {
                            document
                              .querySelector(".rca-geo-split")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }, 60);
                        }
                      }}
                    >
                      <span className="rca-lens-letter">{lens.letter}</span>
                      <div>
                        <div className="rca-lens-title">{lens.title}</div>
                        <div className="rca-lens-q">{lens.question}</div>
                        <div className="rca-lens-row-cta">
                          {geoOpen ? "hide map" : "map ↓"}
                        </div>
                      </div>
                    </button>
                  ) : (
                    <div className="rca-lens-head">
                      <span className="rca-lens-letter">{lens.letter}</span>
                      <div>
                        <div className="rca-lens-title">{lens.title}</div>
                        <div className="rca-lens-q">{lens.question}</div>
                      </div>
                    </div>
                  )}
                  {withNewGoal(lens.key === "lensC" ? groupActive(active.lensC) : active[lens.key], active.newGoal).map(row => {
                    // A patient-count row is not a slice of the revenue gap,
                    // so it is scaled against its own expected headcount.
                    const w =
                      row.unit === "patients"
                        ? Math.min(
                            50,
                            (Math.abs(row.value) / (row.base || 1)) * 100 * 4,
                          )
                        : (Math.abs(row.value) / lensMax) * 50;
                    const neg = row.value < 0;
                    return (
                      <Fragment key={row.label}>
                      <button
                        type="button"
                        className={`rca-lens-row${
                          drill &&
                          drill.lens === row.lens &&
                          drill.key === row.key
                            ? " is-open"
                            : ""
                        }`}
                        onClick={() => {
                          if (row.lens === "newgoal") return;
                          setDrillLimit(25);
                          setDrill(
                            drill &&
                              drill.lens === row.lens &&
                              drill.key === row.key
                              ? null
                              : {
                                  lens: row.lens,
                                  key: row.key,
                                  label: row.label,
                                },
                          );
                        }}
                      >
                        <div className="rca-lens-row-top">
                          <span>{row.label}</span>
                          <span
                            className="rca-mono"
                            style={{
                              color: neg
                                ? "var(--vw-error)"
                                : "var(--vw-success)",
                            }}
                          >
                            {row.unit === "patients"
                              ? PATIENTS_FMT(row.value)
                              : MONEY(row.value)}
                          </span>
                        </div>
                        {row.real !== undefined && row.ambition !== undefined ? (
                          <div className="rca-lens-real">
                            <span style={{ color: row.real < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>real {MONEY(row.real)}</span>
                            <span style={{ color: row.ambition > 0 ? "var(--vw-error)" : "var(--vw-success)" }}>ambition {MONEY(-row.ambition)}</span>
                          </div>
                        ) : null}
                        <div className="rca-lens-row-sub">
                          <span>{row.sub}</span>
                          <span>
                            {row.unit === "patients"
                              ? row.base
                                ? `${(row.value / row.base) * 100 >= 0 ? "+" : ""}${Math.round((row.value / row.base) * 100)}% vs goal`
                                : ""
                              : pct(row.value)}
                          </span>
                        </div>
                        <div className="rca-track">
                          <span className="rca-track-mid" />
                          <span
                            className="rca-track-fill"
                            style={{
                              left: neg ? `${50 - w}%` : "50%",
                              width: `${w}%`,
                              background: neg
                                ? "var(--vw-error)"
                                : "var(--vw-success)",
                            }}
                          />
                        </div>
                        {row.lens === "cohort" &&
                        cohortDrivers?.ready &&
                        cohortDrivers.cohorts[row.key] &&
                        cohortDrivers.cohorts[row.key].posCount > 0 &&
                        cohortDrivers.cohorts[row.key].negCount > 0 ? (
                          <div className="rca-lens-split">
                            <span className="rca-lens-split-pos">
                              +{MONEY_PLAIN(
                                cohortDrivers.cohorts[row.key].posSum,
                              )} ·{" "}
                              {INT(cohortDrivers.cohorts[row.key].posCount)}{" "}
                              beating
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              className="rca-info-icon"
                              title="See the clinics beating goal in this cohort"
                              onClick={e =>
                                openCohortDriverDrill(
                                  e,
                                  row.key,
                                  `${row.label} · beating goal`,
                                  "risers",
                                )
                              }
                              onKeyDown={e =>
                                handleInfoIconKeyDown(e)
                              }
                            >
                              i
                            </span>
                            <span>vs</span>
                            <span className="rca-lens-split-neg">
                              {MONEY(cohortDrivers.cohorts[row.key].negSum)} ·{" "}
                              {INT(cohortDrivers.cohorts[row.key].negCount)}{" "}
                              missing
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              className="rca-info-icon"
                              title="See the clinics missing goal in this cohort"
                              onClick={e =>
                                openCohortDriverDrill(
                                  e,
                                  row.key,
                                  `${row.label} · missing goal`,
                                  "losers",
                                )
                              }
                              onKeyDown={e =>
                                handleInfoIconKeyDown(e)
                              }
                            >
                              i
                            </span>
                          </div>
                        ) : null}
                        <span className="rca-lens-row-cta">
                          {drill &&
                          drill.lens === row.lens &&
                          drill.key === row.key
                            ? "hide clinics"
                            : "clinics ↓"}
                        </span>
                      </button>
                      {row.tiers ? (
                        <div className="rca-lens-tiers">
                          {row.tiers.map(t => (
                            <button
                              type="button"
                              key={t.key}
                              className={`rca-lens-tier${drill && drill.lens === t.lens && drill.key === t.key ? " is-open" : ""}`}
                              onClick={() => {
                                setDrillLimit(25);
                                setDrill(
                                  drill && drill.lens === t.lens && drill.key === t.key
                                    ? null
                                    : { lens: t.lens, key: t.key, label: `Active · ${t.label}` },
                                );
                              }}
                            >
                              <span>{t.label}</span>
                              <span className="rca-mono" style={{ color: t.value < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>{MONEY(t.value)}</span>
                              <span className="rca-lens-row-sub-inline">{t.sub}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      </Fragment>
                    );
                  })}
                  {lens.key === "lensC" && active.cohortCalibration && Math.abs(active.cohortCalibration - 1) > 0.002 ? (
                    <div className="rca-lens-note">
                      Cohort rows are calibrated to the headline baseline (expected ×{active.cohortCalibration.toFixed(3)}) so they add up to the period total. Clinic lists use each clinic's own baseline.
                    </div>
                  ) : null}
                  {lens.key === "lensA" || lens.key === "lensB" ? (
                    <FamilyLevel
                      rows={
                        lens.key === "lensA"
                          ? active.families
                          : famScopeShown === "nonbundle"
                            ? active.familiesNonBundle
                            : active.familiesBundle
                      }
                      scopeNote={lens.key === "lensA" ? null : famScopeShown}
                      onScope={lens.key === "lensB" ? setFamScope : undefined}
                      by={lens.key === "lensA" ? "orders" : "revenue"}
                      openFamily={drill?.lens === "family" ? drill.key : null}
                      onPick={family => {
                        setDrillLimit(25);
                        setDrill(
                          drill &&
                            drill.lens === "family" &&
                            drill.key === family
                            ? null
                            : {
                                lens: "family",
                                key: family,
                                label: family,
                                scope:
                                  lens.key === "lensA"
                                    ? ("all" as const)
                                    : famScopeShown,
                              },
                        );
                      }}
                    />
                  ) : null}
                  {lens.key === "lensC" ? (
                    <NewLogoLevel
                      periodId={periodIdSafe}
                      teamLead={teamLead}
                      sales={salesRep}
                      openKey={
                        drill?.lens === "cohort" && drill.focus?.startsWith("newgrp:")
                          ? drill.focus.slice(7)
                          : null
                      }
                      onPick={(key, label) => {
                        setDrillLimit(25);
                        setDrill(
                          drill &&
                            drill.lens === "cohort" &&
                            drill.focus === `newgrp:${key}`
                            ? null
                            : {
                                lens: "cohort",
                                key: "new",
                                label,
                                focus: `newgrp:${key}`,
                              },
                        );
                        setTimeout(() => {
                          document
                            .querySelector(".rca-drill")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 60);
                      }}
                    />
                  ) : null}
                  {lens.key === "lensD" ? (
                    <div className="rca-lens-note">
                      {active.topStates
                        .slice(0, 6)
                        .map(s => `${s.state} ${MONEY(s.value)}`)
                        .join(" · ")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {geoOpen ? (
          <>
            <section className="rca-geo-split">
              <div className="rca-card rca-geo-side">
                <div className="rca-eyebrow rca-section-title" style={{ marginTop: 0 }}>Geography of the gap</div>
                <div className="rca-geo-side-total">
                  {MONEY(geoRows.reduce((t, r) => t + r.delta, 0))}
                </div>
                <div className="rca-sub">
                  {INT(geoRows.length)} states and countries ·{" "}
                  {INT(geoRows.reduce((t, r) => t + r.clinics, 0))} clinics.
                  Clinics are grouped by their dominant geography.
                </div>
                <div className="rca-geo-side-list">
                  {[...geoRows]
                    .sort((a, b) => a.delta - b.delta)
                    .slice(0, 12)
                    .map(r => {
                      const w =
                        (Math.abs(r.delta) /
                          Math.max(
                            1,
                            ...geoRows.map(g => Math.abs(g.delta)),
                          )) *
                        100;
                      return (
                        <button
                          type="button"
                          key={r.key}
                          className={`rca-geo-side-row${r.key === geoPick ? " is-open" : ""}`}
                          onClick={() => {
                            const next = r.key === geoPick ? null : r.key;
                            setGeoPick(next);
                            setDrillLimit(25);
                            setDrill(
                              next
                                ? { lens: "geo", key: next, label: r.label }
                                : null,
                            );
                          }}
                        >
                          <div className="rca-lens-row-top">
                            <span>{r.label}</span>
                            <span
                              className="rca-mono"
                              style={{
                                color:
                                  r.delta < 0
                                    ? "var(--vw-error)"
                                    : "var(--vw-success)",
                              }}
                            >
                              {MONEY(r.delta)}
                            </span>
                          </div>
                          <div className="rca-lens-row-sub">
                            <span>{INT(r.clinics)} clinics</span>
                            <span>{MONEY_PLAIN(r.actual)} actual</span>
                          </div>
                          <div className="rca-track">
                            <span className="rca-track-mid" />
                            <span
                              className="rca-track-fill"
                              style={{
                                left: r.delta < 0 ? `${50 - w / 2}%` : "50%",
                                width: `${w / 2}%`,
                                background:
                                  r.delta < 0
                                    ? "var(--vw-error)"
                                    : "var(--vw-success)",
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
              <GeoMap
                rows={geoRows}
                selected={geoPick}
                onSelect={key => {
                  setGeoPick(key);
                  setDrillLimit(25);
                  setDrill(
                    key
                      ? {
                          lens: "geo",
                          key,
                          label: geoRows.find(g => g.key === key)?.label ?? key,
                        }
                      : null,
                  );
                }}
              />
            </section>
            <div className="rca-geo-tablebar">
              <button
                type="button"
                className={`rca-tab${geoTable ? " is-active" : ""}`}
                onClick={() => setGeoTable(!geoTable)}
              >
                {geoTable ? "Hide table" : "Show as table"}
              </button>
            </div>
            {geoTable ? (
              <section className="rca-card rca-geo-tables-card">
                <GeoRsmTable
                  rows={geoRows}
                  selected={geoPick}
                  onPickGeo={key => {
                    const next = key === geoPick ? null : key;
                    setGeoPick(next);
                    setDrillLimit(25);
                    setDrill(
                      next
                        ? {
                            lens: "geo",
                            key: next,
                            label:
                              geoRows.find(g => g.key === next)?.label ?? next,
                          }
                        : null,
                    );
                  }}
                />
              </section>
            ) : null}
          </>
        ) : null}

        {drill && drill.lens === "pair" ? (
          <SwitchPanel
            periodId={active.id}
            periodLabel={active.label}
            pair={drill.key}
            limit={drillLimit}
            onLimit={setDrillLimit}
            onClose={() => setDrill(null)}
          />
        ) : drill && drill.lens === "family" ? (
          <FamilyPanel
            periodId={active.id}
            periodLabel={active.label}
            family={drill.key}
            scope={drill.scope ?? "all"}
            limit={drillLimit}
            onLimit={setDrillLimit}
            onClose={() => setDrill(null)}
          />
        ) : drill ? (
          <ClinicPanel
            periodId={active.id}
            periodLabel={active.label}
            lens={drill.lens}
            lensKey={drill.key}
            label={drill.label}
            focus={drill.focus}
            teamLead={teamLead || undefined}
            sales={salesRep || undefined}
            limit={drillLimit}
            onLimit={setDrillLimit}
            onClose={() => setDrill(null)}
          />
        ) : null}

        <div className="rca-grid-1">
          <section className="rca-card rca-prose">
            <div className="rca-eyebrow">Read</div>
            <p>
              {active.orders < active.expectedOrders
                ? `We lost ${INT(active.expectedOrders - active.orders)} orders worth ${MONEY(volume)} and clawed back ${MONEY(aovEffect)} through a higher average order value.`
                : `Order volume ran ${INT(active.orders - active.expectedOrders)} above the run rate, worth ${MONEY(volume)}, with AOV contributing ${MONEY(aovEffect)}.`}{" "}
              {worstCohort.label} is the largest single driver at{" "}
              {MONEY(worstCohort.value)} ({pct(worstCohort.value)}), and{" "}
              {worstStates.label} carry {MONEY(worstStates.value)}.
            </p>
            <p className="rca-dim2">
              Bundle orders contribute {MONEY(active.lensB[0].value)} and
              non-bundle {MONEY(active.lensB[1].value)} —{" "}
              {Math.abs(active.lensB[0].value) > Math.abs(active.lensB[1].value)
                ? "the damage skews to bundles"
                : "the damage skews to single tests"}
              . Every lens reconciles to the same {MONEY(active.delta)}.
            </p>
          </section>
        </div>

        {full.expectedPatients > 0 &&
        full.patients < full.expectedPatients &&
        full.lensA[1].value > 0 ? (
          <div className="rca-masknote">
            <strong>AOV is masking a patient-traffic decline.</strong> Patient
            traffic is running{" "}
            {INT(full.expectedPatients - full.patients)} patients (
            {Math.round(
              ((full.expectedPatients - full.patients) /
                full.expectedPatients) *
                100,
            )}
            %) below the baseline, but AOV at ${INT(full.aov)} vs $
            {INT(full.baseAov)} adds {MONEY(full.lensA[1].value)} that offsets
            a {MONEY(full.lensA[0].value)} order-volume drag — so revenue looks
            steadier than the patient base actually is. Volume and AOV move in
            opposite directions here, which means the headline revenue number
            self-stabilizes and under-reports traffic loss: watch patients per
            weekday, not revenue. Open the patient-traffic row in the volume
            branch for the clinics responsible.
          </div>
        ) : null}
        </>
        )}
      </div>
    </div>
  );
}



type ProviderHit = {
  customerId: string;
  name: string;
  type: string;
  clinic: string;
  clinicName: string;
  state: string;
  sales: string;
  revenue: number;
  orders: number;
  patients: number;
  aov: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  lastOrder: string;
  hubspot: string;
  health: string[];
};

/**
 * Provider search: the customer-level twin of the clinic search box. Finds
 * providers by name across the window and shows each one against its clinic's
 * own baseline run rate, with the clinic it orders under and its HubSpot record.
 */
function ProviderSearchResults({
  term,
  onClose,
}: {
  term: string;
  onClose: () => void;
}) {
  const run = useRcaAction(api.families.providerSearch);
  const [rows, setRows] = useState<ProviderHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const q = term.trim();

  useEffect(() => {
    if (q.length < 2) {
      setRows(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      run({ password: pw(), term: q })
        .then(r => {
          if (live) setRows(r.rows as ProviderHit[]);
        })
        .catch(e => {
          if (live) setError(String(e).slice(0, 160));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, run]);

  if (q.length < 2) return null;
  return (
    <section className="rca-card rca-search-card">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">Provider search</div>
          <div className="rca-drill-title">"{term}"</div>
          <div className="rca-sub">
            {error
              ? error
              : loading || rows === null
                ? "Searching providers…"
                : rows.length === 0
                  ? "No provider in this window matches that name."
                  : `${rows.length} provider${rows.length > 1 ? "s" : ""} — measured over the current window against each provider's clinic baseline run rate.`}
          </div>
        </div>
        <div className="rca-drill-actions">
          <button type="button" className="rca-tab" onClick={onClose}>
            clear
          </button>
        </div>
      </div>
      {rows && rows.length > 0 ? (
        <div className="rca-table-wrap">
          <table className="rca-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Clinic</th>
                <th>State</th>
                <th>Owner</th>
                <th className="rca-num" title="Baseline plus the stretch: the Settings target spread over the year by baseline weekday weights">Goal</th>
                <th className="rca-num">Actual</th>
                <th className="rca-num">Orders</th>
                <th className="rca-num">AOV</th>
                <th className="rca-num">Δ</th>
                <th>Last order</th>
                <th>HubSpot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.customerId}-${r.clinic}`}>
                  <td>
                    {r.name}
                    <div className="rca-dim2 rca-tiny">
                      #{r.customerId} · {r.type}
                    </div>
                  </td>
                  <td>
                    {r.clinicName}
                    <Health flags={r.health} />
                  </td>
                  <td>{r.state}</td>
                  <td>{r.sales}</td>
                  <td className="rca-num">{MONEY_PLAIN(r.expected)}</td>
                  <td className="rca-num">{MONEY_PLAIN(r.revenue)}</td>
                  <td className="rca-num">
                    {INT(r.orders)}{" "}
                    <span className="rca-dim2">
                      vs {INT(r.expectedOrders)}
                    </span>
                  </td>
                  <td className="rca-num">${INT(r.aov)}</td>
                  <td
                    className="rca-num rca-strong"
                    style={{
                      color:
                        r.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                    }}
                  >
                    {MONEY(r.delta)}
                  </td>
                  <td className="rca-mono">{r.lastOrder}</td>
                  <td>
                    {r.hubspot ? (
                      <a
                        className="rca-link"
                        href={r.hubspot}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open
                      </a>
                    ) : (
                      <span className="rca-dim2">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Year-end projection: where the current run rate lands the year against the
 * target, and what still has to be added on each remaining trading day —
 * broken down the same way the shortfall tree is.
 */
/** New-client funnel under the clinic-cohort branch, with explicit drop-off
 * at each step through order 4. */
function NewLogoLevel({
  periodId,
  teamLead,
  sales,
  openKey,
  onPick,
}: {
  periodId: string;
  teamLead: string;
  sales: string;
  openKey: string | null;
  onPick: (key: string, label: string) => void;
}) {
  const data = useRcaQuery(api.clinics.newClinicGroups, {
    password: pw(),
    periodId,
    teamLead: teamLead || undefined,
    sales: sales || undefined,
  });
  if (!data?.ready) return null;
  const signed = (n: number) =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${INT(Math.abs(Math.round(n)))}`;
  const top = data.groups[0];
  const rate = (n: number, d: number) =>
    d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
  const previousStage = (key: string) => {
    const match = key.match(/^f([2-9])(?:drop)?$/);
    return match
      ? data.groups.find(g => g.key === `f${Number(match[1]) - 1}`)
      : undefined;
  };
  const dropCopy = (key: string) => {
    const match = key.match(/^f([2-9])drop$/);
    return match ? `no order ${match[1]} in this window` : "";
  };
  return (
    <div className="rca-fam rca-new-clinic-funnel">
      <div className="rca-fam-head">
        <span className="rca-eyebrow rca-dim">New clients · funnel</span>
        <span className="rca-eyebrow rca-dim2">
          {INT(data.clinics ?? 0)} new clinics
        </span>
      </div>
      {data.groups.map(g => (
        (() => {
          const drop = g.key.endsWith("drop");
          const from = previousStage(g.key);
          return (
        <button
          type="button"
          key={g.key}
          className={`rca-fam-row${openKey === g.key ? " is-open" : ""}`}
          onClick={() => onPick(g.key, `New clients · ${g.label}`)}
        >
          <div className="rca-fam-row-top">
            <span>{g.label}</span>
            <span
              className="rca-mono"
              style={{
                color:
                  drop
                    ? "var(--vw-error)"
                    : g.clinicDelta < 0
                      ? "var(--vw-error)"
                      : "var(--vw-success)",
              }}
            >
              {INT(g.clinics)} clinics
            </span>
          </div>
          <div className="rca-fam-row-sub">
            <span>
              {g.key === "f1"
                ? `${MONEY_PLAIN(g.revenue)} · ${INT(g.orders)} orders`
                : /^f[2-4]$/.test(g.key) || drop
                  ? `${rate(g.clinics, from?.clinics ?? 0)} of ${from?.label ?? "prior stage"}`
                  : g.key === "active"
                    ? `${rate(g.clinics, top?.clinics ?? 0)} of order 1 · baseline ${rate(
                        g.baseClinics,
                        top?.baseClinics ?? 0,
                      )}`
                    : `${rate(g.clinics, top?.clinics ?? 0)} of order 1 · baseline ${rate(
                        g.baseClinics,
                        top?.baseClinics ?? 0,
                      )}`}
            </span>
            <span>
              {drop
                ? `${dropCopy(g.key)} · ${
                    g.baselineAvailable
                      ? `${signed(g.clinicDelta)} vs baseline`
                      : "baseline unavailable"
                  }`
                : g.baselineAvailable
                  ? `${signed(g.clinicDelta)} vs baseline`
                  : "baseline unavailable"}
            </span>
          </div>
        </button>
          );
        })()
      ))}
      <div className="rca-fam-note">
        Order 1–4 counts are cumulative. Each “Did not place” row shows clinics
        that reached the previous order but not the next one during this
        selected window; click a row to inspect those clinics.
      </div>
    </div>
  );
}

/**
 * "What's working" companion to the shortfall tree — same weight as the
 * four questions above it, so a shortfall-heavy period doesn't read as
 * all-bad-news. Requested by Shyam 2026-09-04 for sales-team morale.
 */
/**
 * Sales-rep leaderboard sitting above "what's working": ranked by how far
 * each rep is above/below their own baseline. Clicking a rep re-scopes the
 * whole page (tree, geography, projection, wins) to that rep's book — the
 * same filtering the team-lead dropdown already does, one grain down. The
 * product-mix family panel is pre-aggregated per team lead only and does
 * not re-scope to an individual rep.
 */
function SalesLeaderboard({
  rows,
  active,
  onPick,
  locked = false,
}: {
  /** Rep login: only their own row is shown and it cannot be cleared. */
  locked?: boolean;
  rows: Array<{
    name: string;
    actual: number;
    expected: number;
    delta: number;
    orders: number;
    clinics: number;
  }>;
  active: string;
  onPick: (name: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, 10);

  return (
    <section className="rca-card rca-leaderboard">
      <div className="rca-leaderboard-head">
        <div>
          <div className="rca-eyebrow rca-section-title">Sales leaderboard</div>
          <div className="rca-sub">
            {locked
              ? `Your book vs. its own goal — ${active}.`
              : `Ranked by revenue vs. own goal. Click a rep to filter the page to their book${active ? ` — showing ${active}` : ""}.`}
          </div>
        </div>
        {active && !locked ? (
          <button
            type="button"
            className="rca-tab is-active"
            onClick={() => onPick(active)}
          >
            clear · {active} ✕
          </button>
        ) : null}
      </div>
      <div className="rca-leaderboard-list">
        {shown.map((r, i) => (
          <button
            type="button"
            key={r.name}
            className={`rca-leaderboard-row${active === r.name ? " is-active" : ""}`}
            onClick={() => onPick(r.name)}
          >
            <span className="rca-leaderboard-rank">{i + 1}</span>
            <span className="rca-leaderboard-name">{r.name}</span>
            <span className="rca-leaderboard-clinics">
              {INT(r.clinics)} clinics
            </span>
            <span
              className="rca-leaderboard-delta"
              style={{
                color: r.delta >= 0 ? "var(--vw-success)" : "var(--vw-error)",
              }}
            >
              {MONEY(r.delta)}
            </span>
          </button>
        ))}
      </div>
      {rows.length > 10 ? (
        <button
          type="button"
          className="rca-tab"
          style={{ marginTop: 10 }}
          onClick={() => setShowAll(s => !s)}
        >
          {showAll ? "show top 10" : `show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}

function WinsCardCta({ count }: { count: number }) {
  if (!count) return null;
  return <span className="rca-feed-cta">show these clinics ↓</span>;
}

function WinsPanel({
  periodId,
  teamLead,
  sales,
  onFocus,
}: {
  periodId: string;
  teamLead?: string;
  sales?: string;
  onFocus: (focus: string, label: string) => void;
}) {
  const data = useRcaQuery(api.wins.winsSummary, {
    password: pw(),
    periodId,
    teamLead,
    sales,
  });

  const openIds = (ids: string[], label: string) => {
    if (!ids.length) return;
    onFocus(`ids:${ids.join(",")}`, label);
  };

  return (
    <>
      <div className="rca-eyebrow rca-section-title">What's working</div>
      {!data || !data.ready ? (
        <div className="rca-card rca-win-card" style={{ marginTop: 14, padding: 20 }}>
          <div className="rca-sub">Loading…</div>
        </div>
      ) : (
        <div className="rca-wins-grid">
          <button
            type="button"
            className="rca-card rca-win-card rca-win-card-btn"
            onClick={() => openIds(data.beatersIds, "Beating goal")}
          >
            <div className="rca-eyebrow rca-blue">Beating goal</div>
            <div className="rca-readout-value" style={{ color: "var(--vw-success)" }}>
              {INT(data.beatersCount)} clinics
            </div>
            <div className="rca-readout-body">
              {Math.round(data.beatersShare * 100)}% of the {INT(data.totalCount)} clinics with activity in
              this window are at or above their own goal, worth {MONEY(data.beatersRevenue)}{" "}
              combined.
            </div>
            <WinsCardCta count={data.beatersIds.length} />
          </button>

          <button
            type="button"
            className="rca-card rca-win-card rca-win-card-btn"
            onClick={() => openIds(data.momentumIds, "Momentum")}
          >
            <div className="rca-eyebrow rca-blue">Momentum</div>
            <div className="rca-readout-value" style={{ color: "var(--vw-success)" }}>
              {INT(data.momentumIds.length)} clinics
            </div>
            <div className="rca-readout-body">Orders and revenue both above goal.</div>
            {data.momentum.length ? (
              <ul className="rca-win-list">
                {data.momentum.slice(0, 6).map(r => (
                  <li key={r.clinic}>
                    <span>
                      {r.name} <span className="rca-dim">({r.state})</span>
                    </span>
                    <span className="rca-mono">
                      {MONEY(r.delta)} · +{INT(r.orderDelta)} ord
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <WinsCardCta count={data.momentumIds.length} />
          </button>

          <button
            type="button"
            className="rca-card rca-win-card rca-win-card-btn"
            onClick={() => openIds(data.newLogoIds, "New-logo wins")}
          >
            <div className="rca-eyebrow rca-blue">New-logo wins</div>
            <div className="rca-readout-value" style={{ color: "var(--vw-success)" }}>
              {INT(data.newLogoCount)} clinics
            </div>
            <div className="rca-readout-body">
              New first-ever-order clinics in this window, worth {MONEY(data.newLogoRevenue)}.
            </div>
            {data.newLogos.length ? (
              <ul className="rca-win-list">
                {data.newLogos.slice(0, 6).map(r => (
                  <li key={r.clinic}>
                    <span>
                      {r.name} <span className="rca-dim">({r.state})</span>
                    </span>
                    <span className="rca-mono">{MONEY(r.actual)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <WinsCardCta count={data.newLogoIds.length} />
          </button>

          <button
            type="button"
            className="rca-card rca-win-card rca-win-card-btn"
            disabled={!data.comebackAvailable}
            onClick={() => openIds(data.comebackIds, "Comeback")}
          >
            <div className="rca-eyebrow rca-blue">Comeback</div>
            <div className="rca-readout-value" style={{ color: "var(--vw-success)" }}>
              {data.comebackAvailable ? `${INT(data.comebackIds.length)} clinics` : "—"}
            </div>
            <div className="rca-readout-body">
              {data.comebackAvailable
                ? "Below goal last week, at or above it this week."
                : "Comeback tracking needs a week-scoped period — pick a week above to see it."}
            </div>
            {data.comeback.length ? (
              <ul className="rca-win-list">
                {data.comeback.slice(0, 6).map(r => (
                  <li key={r.clinic}>
                    <span>
                      {r.name} <span className="rca-dim">({r.state})</span>
                    </span>
                    <span className="rca-mono">swing {MONEY(r.swing)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <WinsCardCta count={data.comebackIds.length} />
          </button>

          <button
            type="button"
            className="rca-card rca-win-card rca-win-card-btn"
            onClick={() => openIds(data.bundleGainerIds, "Bundle-adoption gainers")}
          >
            <div className="rca-eyebrow rca-blue">Bundle-adoption gainers</div>
            <div className="rca-readout-value" style={{ color: "var(--vw-success)" }}>
              {INT(data.bundleGainerIds.length)} clinics
            </div>
            <div className="rca-readout-body">Bundle revenue above goal this window.</div>
            {data.bundleGainers.length ? (
              <ul className="rca-win-list">
                {data.bundleGainers.slice(0, 6).map(r => (
                  <li key={r.clinic}>
                    <span>
                      {r.name} <span className="rca-dim">({r.state})</span>
                    </span>
                    <span className="rca-mono">
                      {MONEY(r.bundleDelta)} · {Math.round(r.baseBundleShare * 100)}%→
                      {Math.round(r.bundleShare * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <WinsCardCta count={data.bundleGainerIds.length} />
          </button>
        </div>
      )}
    </>
  );
}

function ReadoutCard({
  n,
  q,
  value,
  body,
  tone,
}: {
  n: string;
  q: string;
  value: string;
  body: string;
  tone?: "bad" | "good";
}) {
  return (
    <div className="rca-card rca-readout">
      <div className="rca-eyebrow rca-blue">{n}</div>
      <div className="rca-readout-q">{q}</div>
      <div
        className="rca-readout-value"
        style={{
          color:
            tone === "bad"
              ? "var(--vw-error)"
              : tone === "good"
                ? "var(--vw-success)"
                : "var(--text-primary)",
        }}
      >
        {value}
      </div>
      <div className="rca-readout-body">{body}</div>
    </div>
  );
}

function YearProjection({
  teamLead,
  sales,
}: {
  teamLead: string;
  sales?: string;
}) {
  const proj = useRcaQuery(api.projection.summary, {
    password: pw(),
    teamLead: teamLead || undefined,
    sales: sales || undefined,
  });
  if (!proj || !proj.ready) return null;
  const behind = proj.gap > 0;
  const monthName = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

  return (
    <section className="rca-card rca-strip-card rca-proj">
      <div className="rca-strip-head">
        <div>
          <div className="rca-eyebrow rca-section-title" style={{ marginTop: 0 }}>Year-end projection</div>
          <div className="rca-proj-title">
            At the current run rate 2026 closes at{" "}
            <strong>{MONEY_PLAIN(proj.projected.close)}</strong> against a{" "}
            {MONEY_PLAIN(proj.target)} target{teamLead || sales ? " (this book's pro-rata share)" : ""} —{" "}
            <strong
              style={{
                color: behind ? "var(--vw-error)" : "var(--vw-success)",
              }}
            >
              {behind ? MONEY_PLAIN(proj.gap) + " short" : MONEY_PLAIN(-proj.gap) + " ahead"}
            </strong>
          </div>
          <div className="rca-sub">
            {MONEY_PLAIN(proj.ytd.revenue)} booked through{" "}
            {fmtDate(proj.ytd.end)} ({INT(proj.ytd.orders)} orders) ·{" "}
            {MONEY_PLAIN(proj.projected.remaining)} projected over the{" "}
            {proj.pace.remainingDays} days left ({proj.pace.workdays} trading
            weekdays, {proj.pace.weekendDays} weekend days,{" "}
            {proj.pace.holidays.length} holiday weekdays priced at last year's
            actual level).
          </div>
        </div>
        <div className="rca-proj-kpis">
          <div>
            <div className="rca-eyebrow">Still needed</div>
            <div className="rca-kpi">{MONEY_PLAIN(proj.neededRemaining)}</div>
            <div className="rca-tiny">
              {INT(proj.pace.ordersNeeded)} orders at{" "}
              {MONEY_PLAIN(proj.projected.aov)} AOV
            </div>
          </div>
          <div className="rca-kpi-divider">
            <div className="rca-eyebrow">Per trading weekday</div>
            <div className="rca-kpi">
              {MONEY_PLAIN(proj.pace.workdayNeeded)}
            </div>
            <div className="rca-tiny">
              vs {MONEY_PLAIN(proj.pace.workdayProjected)} projected · weekend{" "}
              {MONEY_PLAIN(proj.pace.weekendNeeded)} vs{" "}
              {MONEY_PLAIN(proj.pace.weekendProjected)}
            </div>
          </div>
        </div>
      </div>

      <div className="rca-proj-months">
        {proj.months.map(m => (
          <div className="rca-proj-month" key={m.month}>
            <div className="rca-eyebrow">{monthName(m.month)}</div>
            <div className="rca-proj-month-need">
              {MONEY_PLAIN(m.needed)}
            </div>
            <div className="rca-tiny">
              run rate {MONEY_PLAIN(m.projected)} · {MONEY(m.uplift)} to find
            </div>
          </div>
        ))}
      </div>

      {proj.plan.count > 0 ? (
        <div className="rca-lens-note">
          <strong>
            {INT(proj.plan.count)} clinic target
            {proj.plan.count === 1 ? "" : "s"}
          </strong>{" "}
          included: targets of {MONEY_PLAIN(proj.plan.weeklyRevenueUplift)} per week above
          those clinics' current run rate ({INT(proj.plan.weeklyOrderUplift)}{" "}
          extra orders/wk), worth {MONEY_PLAIN(proj.plan.addedRevenue)} over the{" "}
          {proj.plan.remainingWeeks.toFixed(1)} weeks left — without them the
          year closes at {MONEY_PLAIN(proj.projected.closeBase)}. Set targets per
          clinic in any clinic list below.
        </div>
      ) : (
        <div className="rca-lens-note">
          Run rate = revenue per weekday over the trailing 13 weeks, scaled per
          calendar day by last year's seasonal pattern (holidays and the Nov–Dec
          slowdown come from actual trading history, not a fixed calendar). Set
          target orders/week and revenue/week on individual clinics in any
          clinic list and this projection picks them up.
        </div>
      )}
    </section>
  );
}

const COHORT_SHORT: Record<string, string> = {
  churned: "Churned",
  new: "New",
  retained_top20: "Top 20%",
  retained_rest: "Mid-tail",
  reactivated: "Reactivated",
};

const METRIC_TITLE: Record<string, string> = {
  total: "total shortfall",
  volume: "the order-volume loss",
  aov: "the AOV / price effect",
  bundle: "the bundle-order delta",
  nonbundle: "the non-bundle delta",
  cohort: "this cohort",
  state: "these states",
  traffic: "the patient-traffic shortfall",
};

/** Signed patient count, for the traffic lens where the metric is not money. */
const PATIENTS_FMT = (n: number) =>
  `${n < 0 ? "−" : "+"}${Math.round(Math.abs(n)).toLocaleString("en-US")} patients`;

/**
 * Admin-only view of who unlocked the dashboard. Emails are self-reported at
 * the gate (everyone shares one password), so this is attribution, not auth.
 */
/**
 * Settings → Rep logins (Shyam, 2026-09-25). Behind the admin password:
 * create/update/delete the per-rep email+password accounts that lock the
 * dashboard to one salesperson's book. Passwords are set here only — they
 * never travel through Slack or code.
 */
function RepAccountsCard() {
  const [adminPw, setAdminPw] = useState("");
  const [open, setOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [repDraft, setRepDraft] = useState("");
  const [pwDraft, setPwDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const accounts = useQuery(
    api.repAuth.list,
    open && adminPw ? { adminPassword: adminPw } : "skip",
  );
  const names = useRcaQuery(
    api.repAuth.repNames,
    open && adminPw ? { adminPassword: adminPw } : "skip",
  );
  const upsert = useMutation(api.repAuth.upsert);
  const remove = useMutation(api.repAuth.remove);
  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const save = async () => {
    setSaving(true);
    try {
      const res = await upsert({
        adminPassword: adminPw,
        email: emailDraft,
        rep: repDraft,
        password: pwDraft || undefined,
      });
      if (res === null) toast.error("Admin password not accepted.");
      else if (!res.ok) toast.error(res.error ?? "Could not save.");
      else {
        toast.success(`Login saved for ${repDraft}`);
        setEmailDraft("");
        setRepDraft("");
        setPwDraft("");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rca-card rca-controls">
      <div className="rca-eyebrow">Rep logins</div>
      <div className="rca-sub" style={{ marginBottom: 10 }}>
        A rep signs in with their work email and the password you set here;
        the whole dashboard then shows only their book. Leave the password
        blank when editing to keep the current one.
      </div>
      <div className="rca-controls-row">
        <label className="rca-field">
          <span>Admin password</span>
          <input
            type="password"
            value={adminPw}
            placeholder="admin password"
            onChange={e => {
              setAdminPw(e.target.value);
              setOpen(false);
            }}
          />
        </label>
        <button
          type="button"
          className="rca-btn"
          disabled={!adminPw}
          onClick={() => setOpen(true)}
        >
          Open
        </button>
      </div>
      {open && accounts === null ? (
        <div className="rca-gate-error">Admin password not accepted.</div>
      ) : null}
      {open && accounts ? (
        <>
          <div className="rca-rep-accounts">
            {accounts.length === 0 ? (
              <div className="rca-sub">No rep logins yet.</div>
            ) : (
              accounts.map(a => (
                <div key={a.email} className="rca-rep-account">
                  <div>
                    <strong>{a.rep}</strong>
                    <div className="rca-sub">
                      {a.email} · last sign-in{" "}
                      {a.lastLogin ? when(a.lastLogin) : "never"}
                    </div>
                  </div>
                  <div className="rca-rep-account-actions">
                    <button
                      type="button"
                      className="rca-tab"
                      onClick={() => {
                        setEmailDraft(a.email);
                        setRepDraft(a.rep);
                        setPwDraft("");
                      }}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      className="rca-tab"
                      onClick={async () => {
                        if (!window.confirm(`Remove login for ${a.rep}?`)) return;
                        await remove({ adminPassword: adminPw, email: a.email });
                        toast.success(`Removed ${a.email}`);
                      }}
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="rca-controls-row" style={{ marginTop: 12 }}>
            <label className="rca-field">
              <span>Work email</span>
              <input
                type="email"
                value={emailDraft}
                placeholder="rep@vibrant-wellness.com"
                onChange={e => setEmailDraft(e.target.value)}
              />
            </label>
            <label className="rca-field">
              <span>Salesperson</span>
              <select value={repDraft} onChange={e => setRepDraft(e.target.value)}>
                <option value="">— pick —</option>
                {(names ?? []).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="rca-field">
              <span>Password</span>
              <input
                type="password"
                value={pwDraft}
                placeholder="min 8 characters"
                autoComplete="new-password"
                onChange={e => setPwDraft(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rca-btn"
              disabled={saving || !emailDraft || !repDraft}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save login"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function AccessLogCard() {
  const [adminPw, setAdminPw] = useState("");
  const [open, setOpen] = useState(false);
  const data = useQuery(
    api.access.log,
    open && adminPw ? { adminPassword: adminPw, limit: 50 } : "skip",
  );
  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <section className="rca-card rca-controls">
      <div className="rca-eyebrow">Access log</div>
      <div className="rca-controls-row">
        <label className="rca-field">
          <span>Admin password</span>
          <input
            type="password"
            value={adminPw}
            placeholder="admin password"
            onChange={e => {
              setAdminPw(e.target.value);
              setOpen(false);
            }}
          />
        </label>
        <button
          type="button"
          className="rca-btn"
          disabled={!adminPw}
          onClick={() => setOpen(true)}
        >
          Show log
        </button>
      </div>
      {open && data === undefined ? (
        <div className="rca-control-note">Loading…</div>
      ) : null}
      {open && data === null ? (
        <div className="rca-control-note">That admin password is not right.</div>
      ) : null}
      {open && data ? (
        <>
          <div className="rca-control-note">
            {INT(data.total)} unlocks logged · {INT(data.people.length)} people.
          </div>
          <div className="rca-log">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="rca-num">Unlocks</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map(p => (
                  <tr key={p.email}>
                    <td>{p.email}</td>
                    <td className="rca-num">{INT(p.count)}</td>
                    <td>{when(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rca-control-note">Most recent unlocks</div>
          <div className="rca-log">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Person</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={`${r.email}-${r.at}-${i}`}>
                    <td>{when(r.at)}</td>
                    <td>{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <div className="rca-control-note">
        Only @vibrant-wellness.com and @vibrant-america.com emails can unlock.
        The email is typed by the user alongside the shared password, so treat
        this as an attribution trail rather than verified identity.
      </div>
    </section>
  );
}

function ClinicPanel({
  periodId,
  periodLabel,
  lens,
  lensKey,
  label,
  focus,
  teamLead,
  sales,
  limit,
  onLimit,
  onClose,
}: {
  periodId: string;
  periodLabel: string;
  lens: string;
  lensKey: string;
  label: string;
  focus?: string;
  teamLead?: string;
  sales?: string;
  limit: number;
  onLimit: (n: number) => void;
  onClose: () => void;
}) {
  const data = useRcaQuery(api.clinics.clinicDrill, {
    password: pw(),
    periodId,
    lens,
    key: lensKey,
    limit,
    focus,
    teamLead,
    sales,
  });
  const isStops = !!focus?.startsWith("famstops");
  const [stopFam, setStopFam] = useState("");
  const [stopMonth, setStopMonth] = useState("");
  const stopRows = useMemo(() => {
    const all = (data?.rows ?? []) as (DrillClinic & StopFields)[];
    if (!isStops) return all;
    return all.filter(r =>
      (r.stops ?? []).some(
        s => (!stopFam || s.family === stopFam) && (!stopMonth || s.month === stopMonth),
      ),
    );
  }, [data, isStops, stopFam, stopMonth]);
  const stopMonths = useMemo(
    () =>
      [...new Set(((data?.rows ?? []) as StopFields[]).flatMap(r => (r.stops ?? []).map(s => s.month)))].sort(),
    [data],
  );
  const stopCount = (fam: string, ym: string) =>
    ((data?.rows ?? []) as StopFields[]).filter(r =>
      (r.stops ?? []).some(s => (!fam || s.family === fam) && (!ym || s.month === ym)),
    ).length;
  const filters = useClinicFilters(stopRows);
  const plan = useRcaQuery(api.plan.list, { password: pw() });
  const current = useMemo(() => {
    const m = new Map<string, { revWeek: number; ordWeek: number }>();
    for (const c of plan?.current ?? []) m.set(c.clinic, c);
    return m;
  }, [plan]);
  const targets = useMemo(() => {
    const m = new Map<string, { rev: number; ord: number }>();
    for (const p of plan?.plans ?? [])
      m.set(p.clinic, { rev: p.targetRevenueWeek, ord: p.targetOrdersWeek });
    return m;
  }, [plan]);
  const dropOffOrder = focus?.match(/^newgrp:f([2-9])drop$/)?.[1];

  const csv = () => {
    if (!data?.rows) return;
    const head = [
      "rank",
      "clinic_id",
      "clinic",
      "state",
      "country",
      "owner",
      "team_lead",
      "cohort",
      "expected_revenue",
      "actual_revenue",
      "delta",
      "orders",
      "expected_orders",
      "patients",
      "expected_patients",
      "volume_effect",
      "aov_effect",
      "aov",
      "baseline_aov",
      "bundle_delta",
      "attributed_metric",
      ...(isStops ? ["stopped_families", "stopped_in", "last_order", "days_since", "prior_90d_orders"] : []),
    ];
    const lines = [head.join(",")];
    (isStops ? (filters.rows as unknown as typeof data.rows) : data.rows).forEach((r, i) => {
      lines.push(
        [
          i + 1,
          r.clinic,
          `"${r.name.replace(/"/g, "'")}"`,
          r.state,
          r.country,
          `"${r.sales.replace(/"/g, "'")}"`,
          `"${r.teamLead.replace(/"/g, "'")}"`,
          r.cohort,
          Math.round(r.expected),
          Math.round(r.actual),
          Math.round(r.delta),
          r.orders,
          Math.round(r.expectedOrders),
          Math.round(r.patients),
          Math.round(r.expectedPatients),
          Math.round(r.volume),
          Math.round(r.aovEffect),
          Math.round(r.aov),
          Math.round(r.baseAov),
          Math.round(r.bundleDelta),
          Math.round(r.metric),
          ...(isStops
            ? (() => {
                const x = r as unknown as StopFields;
                return [x.stopFamilies ?? "", x.stopMonth ?? "", x.stopLastOrder ?? "", x.stopDays ?? "", x.stopPrior ?? ""];
              })()
            : []),
        ].join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isStops
      ? `clinics_gz_tt_stopped.csv`
      : `clinics_${lens}_${periodId.replace(":", "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rca-card rca-drill">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">Clinics behind this number</div>
          <div className="rca-drill-title">
            {label} · {periodLabel}
          </div>
          <div className="rca-sub">
            {data?.ready
              ? isStops
                ? `${INT(filters.rows.length)} clinics stopped ${stopFam || "Gut Zoomer or Total Tox"}${stopMonth ? ` in ${monLabel(stopMonth)}` : " since May"} and still haven't reordered: ≥3 orders of the family in the 90 days before, none in the last 30 days as of month end, and none since. Each clinic is listed under the month it first stopped; the RCA columns are for ${periodLabel}.`
                : dropOffOrder
                ? `${INT(data.count)} new clinics reached order ${Number(dropOffOrder) - 1} but did not reach order ${dropOffOrder} within the analysis window.`
                : `${INT(data.count)} clinics carry ${METRIC_TITLE[lens] ?? "this node"}, netting ${lens === "traffic" ? PATIENTS_FMT(data.total) : MONEY(data.total)}. Ranked by contribution; the listed ${INT(Math.min(limit, data.rows.length))} account for ${lens === "traffic" ? PATIENTS_FMT(data.rows.reduce((s, r) => s + r.metric, 0)) : MONEY(data.rows.reduce((s, r) => s + r.metric, 0))}.`
              : "Loading clinic detail…"}
          </div>
          {data?.ready &&
          lens !== "traffic" &&
          !isStops &&
          data.posCount > 0 &&
          data.negCount > 0 ? (
            <div className="rca-drill-split">
              <span className="rca-drill-split-pos">
                +{MONEY_PLAIN(data.posSum)} across {INT(data.posCount)}{" "}
                {data.posCount === 1 ? "clinic" : "clinics"} beating goal
              </span>
              <span className="rca-drill-split-sep">offset by</span>
              <span className="rca-drill-split-neg">
                {MONEY(data.negSum)} across {INT(data.negCount)}{" "}
                {data.negCount === 1 ? "clinic" : "clinics"} missing it
              </span>
              <span className="rca-drill-split-sep">
                nets to {MONEY(data.total)}.
              </span>
            </div>
          ) : null}
        </div>
        <div className="rca-drill-actions">
          {(isStops ? [] : [25, 50, 100, 250]).map(n => (
            <button
              type="button"
              key={n}
              className={`rca-tab${limit === n ? " is-active" : ""}`}
              onClick={() => onLimit(n)}
            >
              top {n}
            </button>
          ))}
          <button type="button" className="rca-btn" onClick={csv}>
            CSV
          </button>
          <button type="button" className="rca-tab" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      {data?.ready && isStops ? (
        <div className="rca-filters rca-stop-chips">
          <span className="rca-filter-label">Family</span>
          {["", "Gut Zoomer", "Total Tox"].map(f => (
            <button
              type="button"
              key={f || "both"}
              className={`rca-tab${stopFam === f ? " is-active" : ""}`}
              onClick={() => setStopFam(f)}
            >
              {f || "Both"} ({INT(stopCount(f, stopMonth))})
            </button>
          ))}
          <span className="rca-filter-label">Stopped in</span>
          {["", ...stopMonths].map(m => (
            <button
              type="button"
              key={m || "all"}
              className={`rca-tab${stopMonth === m ? " is-active" : ""}`}
              onClick={() => setStopMonth(m)}
            >
              {m ? monLabel(m) : "All"} ({INT(stopCount(stopFam, m))})
            </button>
          ))}
        </div>
      ) : null}

      {data?.ready ? filters.bar : null}

      {data?.ready ? (
        <div className="rca-table-wrap">
          <table className="rca-table">
            <thead>
              <tr>
                <th>#</th>
                {filters.th("Clinic", "name", true)}
                {filters.th("State", "state", true)}
                {filters.th("Owner", "sales", true)}
                {filters.th("Cohort", "cohort", true)}
                {isStops ? (
                  <>
                    {filters.th("Stopped", "stopFamilies", true)}
                    {filters.th("Stopped in", "stopMonthNum")}
                    {filters.th("Last order", "stopLastNum")}
                    {filters.th("Days since", "stopDays")}
                    {filters.th("Prior 90d orders", "stopPrior")}
                  </>
                ) : null}
                {filters.th("Goal", "expected")}
                {filters.th("Actual", "actual")}
                {filters.th("Orders", "orders")}
                {filters.th("Order Δ", "orderDelta")}
                {filters.th("AOV", "aov")}
                {filters.th("AOV Δ", "aovDelta")}
                {filters.th("Bundle %", "bundleShare")}
                {filters.th("Bundle Δ", "bundleDelta")}
                {filters.th("Contribution", "metric")}
                <th className="rca-num">Orders/wk · target</th>
                <th className="rca-num">Revenue/wk · target</th>
              </tr>
            </thead>
            <tbody>
              {filters.groups
                ? filters.groups.flatMap(g => [
                    <ClinicGroupHeader
                      key={`g-${g.key}`}
                      label={g.key}
                      groupBy={filters.groupBy as "state" | "owner"}
                      count={g.count}
                      total={g.total}
                      colSpan={isStops ? 21 : 16}
                      isPatients={lens === "traffic"}
                    />,
                    ...g.rows.map(r => (
                      <ClinicPanelRow
                        key={r.clinic}
                        rank={filters.rankOf.get(r.clinic) ?? 0}
                        row={r}
                        periodId={periodId}
                        current={current.get(r.clinic)}
                        target={targets.get(r.clinic)}
                        lens={lens}
                        showStops={isStops}
                        scope={
                          lens === "bundle"
                            ? "bundle"
                            : lens === "nonbundle"
                              ? "nonbundle"
                              : "all"
                        }
                      />
                    )),
                  ])
                : filters.rows.map((r, i) => (
                    <ClinicPanelRow
                      key={r.clinic}
                      rank={i + 1}
                      row={r}
                      periodId={periodId}
                      current={current.get(r.clinic)}
                      target={targets.get(r.clinic)}
                      lens={lens}
                      showStops={isStops}
                      scope={
                        lens === "bundle"
                          ? "bundle"
                          : lens === "nonbundle"
                            ? "nonbundle"
                            : "all"
                      }
                    />
                  ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rca-lens-note">
        The last two columns are the clinic's current weekly rate over the
        analysis window and an editable target. Saved targets are carried over
        the remaining weeks of the year and folded into the year-end projection
        at the top of the page. Each clinic is measured against its own goal
        day-type run rate, so
        the clinic rows of a node add back to that node. The geography lens is
        the exception: clinics are grouped by their dominant state, while the
        tree allocates each order to its own state.
      </div>
    </section>
  );
}

/**
 * Level 2 of the tree: which product families are behind the volume and
 * product-mix branches. Ranked and shown by order shortfall only: an order can
 * carry several families, so a per-family revenue split is pro-rata and not a
 * real family-level number.
 */
export function FamilyLevel({
  rows,
  by,
  scopeNote,
  onScope,
  openFamily,
  onPick,
}: {
  rows: FamilyRow[];
  by: "orders" | "revenue";
  scopeNote?: "bundle" | "nonbundle" | null;
  onScope?: (s: "bundle" | "nonbundle") => void;
  openFamily: string | null;
  onPick: (family: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.orderDelta - b.orderDelta);
  const shown = all ? sorted : sorted.slice(0, 6);
  // Positive contributors: the families offsetting the drags, ranked the same
  // way as the drags so the two lists read against each other.
  const gains = [...rows]
    .filter(r => r.orderDelta > 0)
    .sort((a, b) => b.orderDelta - a.orderDelta);
  const worst = Math.max(...sorted.map(r => Math.abs(r.orderDelta)), 1);
  return (
    <div className="rca-fam">
      <div className="rca-fam-head">
        <span className="rca-eyebrow rca-dim">
          {by === "orders"
            ? "Families · order gap"
            : scopeNote === "nonbundle"
              ? "Families in non-bundle orders"
              : "Families in bundle orders"}
        </span>
        {onScope ? (
          <span className="rca-fam-scope">
            <button
              type="button"
              className={`rca-chip${scopeNote !== "nonbundle" ? " is-on" : ""}`}
              onClick={() => onScope("bundle")}
            >
              bundle
            </button>
            <button
              type="button"
              className={`rca-chip${scopeNote === "nonbundle" ? " is-on" : ""}`}
              onClick={() => onScope("nonbundle")}
            >
              non-bundle
            </button>
          </span>
        ) : null}
        <button
          type="button"
          className="rca-linkish"
          onClick={() => setAll(!all)}
        >
          {all ? "show fewer" : `all ${sorted.length}`}
        </button>
      </div>
      {shown.map(f => famRow(f))}
      {gains.length > 0 && !all ? (
        <div className="rca-fam-gains">
          <div className="rca-fam-head">
            <span className="rca-eyebrow rca-dim">Offsetting gains</span>
            <span className="rca-mono rca-dim2 rca-fam-sub">
              +{INT(gains.reduce((s2, f) => s2 + f.orderDelta, 0))} ord
            </span>
          </div>
          {gains.slice(0, 4).map(f => famRow(f))}
        </div>
      ) : null}
    </div>
  );

  function famRow(f: FamilyRow) {
    // Orders only: revenue cannot be split cleanly per family.
    const primary = f.orderDelta;
    const w = (Math.abs(primary) / worst) * 100;
    const neg = primary < 0;
    return (
      <button
        type="button"
        key={f.family}
        className={`rca-fam-row${openFamily === f.family ? " is-open" : ""}`}
        onClick={() => onPick(f.family)}
        title={`${f.family}: ${INT(f.orderDelta)} orders vs expected`}
      >
        <span className="rca-fam-name">{f.family}</span>
        <span className="rca-fam-nums">
          <span
            className="rca-mono"
            style={{
              color: neg ? "var(--vw-error)" : "var(--vw-success)",
            }}
          >
            {f.orderDelta >= 0 ? "+" : ""}
            {INT(f.orderDelta)} ord
          </span>
        </span>
        <span className="rca-fam-track">
          <span
            className="rca-fam-fill"
            style={{
              width: `${w}%`,
              background: neg ? "var(--vw-error)" : "var(--vw-success)",
            }}
          />
        </span>
      </button>
    );
  }
}

/** Clinics behind one product family — queried live, then cached server-side. */
export function FamilyPanel({
  sales,
  periodId,
  periodLabel,
  family,
  scope,
  limit,
  onLimit,
  onClose,
}: {
  sales?: string;
  periodId: string;
  periodLabel: string;
  family: string;
  /** Which order universe the family was opened from. */
  scope: "all" | "bundle" | "nonbundle";
  limit: number;
  onLimit: (n: number) => void;
  onClose: () => void;
}) {
  const run = useRcaAction(api.families.familyClinicsAction);
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    data?: {
      rows: FamilyClinic[];
      total: number;
      orderTotal: number;
      count: number;
      note?: string;
    };
  }>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    run({ password: pw(), periodId, family, limit, scope, ...(sales ? { sales } : {}) })
      .then(data => {
        if (live) setState({ loading: false, data });
      })
      .catch(e => {
        if (live) setState({ loading: false, error: String(e).slice(0, 200) });
      });
    return () => {
      live = false;
    };
  }, [run, periodId, family, limit, scope, sales]);

  const data = state.data;
  const filters = useClinicFilters(data?.rows ?? []);
  return (
    <section className="rca-card rca-drill">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">
            Clinics behind this product family
            {scope === "bundle"
              ? " · bundle orders only"
              : scope === "nonbundle"
                ? " · non-bundle orders only"
                : ""}
          </div>
          <div className="rca-drill-title">
            {family} · {periodLabel}
          </div>
          <div className="rca-sub">
            {state.loading
              ? "Querying Power BI for this family…"
              : state.error
                ? state.error
                : data?.note
                  ? data.note
                  : `${INT(data?.count ?? 0)} clinics ordered this family, ${INT(data?.orderTotal ?? 0)} orders vs expected. Orders only — an order can carry several families, so revenue cannot be split per family. Expand a clinic for the customers inside it.`}
          </div>
        </div>
        <div className="rca-drill-actions">
          {[25, 50, 100].map(n => (
            <button
              type="button"
              key={n}
              className={`rca-tab${limit === n ? " is-active" : ""}`}
              onClick={() => onLimit(n)}
            >
              top {n}
            </button>
          ))}
          <button type="button" className="rca-tab" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      {family === "Unmapped" ? <UnmappedTests periodId={periodId} /> : null}

      {data && data.rows.length > 0 ? filters.bar : null}

      {data && data.rows.length > 0 ? (
        <div className="rca-table-wrap">
          <table className="rca-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Clinic</th>
                <th>State</th>
                <th>Owner</th>
                <th>Cohort</th>
                {filters.th("Goal", "expected")}
                {filters.th("Actual", "revenue")}
                {filters.th("Orders", "orders")}
                {filters.th("Order Δ", "orderDelta")}
                {filters.th("AOV", "aov")}
                {filters.th("Bundle %", "bundleShare")}
                {filters.th("Revenue Δ", "delta")}
              </tr>
            </thead>
            <tbody>
              {filters.groups
                ? filters.groups.flatMap(g => [
                    <ClinicGroupHeader
                      key={`g-${g.key}`}
                      label={g.key}
                      groupBy={filters.groupBy as "state" | "owner"}
                      count={g.count}
                      total={g.total}
                      colSpan={12}
                    />,
                    ...g.rows.map(r => (
                      <ClinicRowWithCustomers
                        key={r.clinic}
                        rank={filters.rankOf.get(r.clinic) ?? 0}
                        row={r}
                        periodId={periodId}
                        family={family}
                        scope={scope}
                      />
                    )),
                  ])
                : filters.rows.map((r, i) => (
                    <ClinicRowWithCustomers
                      key={r.clinic}
                      rank={i + 1}
                      row={r}
                      periodId={periodId}
                      family={family}
                      scope={scope}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rca-lens-note">
        A clinic's expected revenue for a family is its share of that family in
        the baseline window, scaled to the days in view, so the rows add back to
        the family node. Opened from the bundle or non-bundle branch, the list
        counts only that clinic's bundle (or non-bundle) orders of the family. Click a clinic to load the customers inside it.
      </div>
    </section>
  );
}

type UnmappedTestRow = {
  test: string;
  orders: number;
  expectedOrders: number;
  orderDelta: number;
  revenue: number;
  expected: number;
  delta: number;
};

/**
 * What is actually inside "Unmapped" — the individual tests on orders the BI
 * model has no product family for. Rows overlap (one order carries many
 * tests), so they are shown as a demand signal, not an additive breakdown.
 */
function UnmappedTests({ periodId }: { periodId: string }) {
  // Company-wide test list: not available to rep logins.
  if (repSession()) return null;
  return <UnmappedTestsInner periodId={periodId} />;
}

function UnmappedTestsInner({ periodId }: { periodId: string }) {
  const run = useRcaAction(api.families.unmappedTestsAction);
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    rows?: UnmappedTestRow[];
    note?: string;
  }>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    run({ password: pw(), periodId, limit: 25 })
      .then(r => {
        if (live) setState({ loading: false, rows: r.rows, note: r.note });
      })
      .catch(e => {
        if (live) setState({ loading: false, error: String(e).slice(0, 200) });
      });
    return () => {
      live = false;
    };
  }, [run, periodId]);

  return (
    <div className="rca-unmapped">
      <div className="rca-fam-head">
        <span className="rca-eyebrow rca-dim">
          Inside “Unmapped” · top tests by order gap
        </span>
        <button
          type="button"
          className="rca-linkish"
          onClick={() => setOpen(!open)}
        >
          {open ? "hide" : "show"}
        </button>
      </div>
      {open ? (
        state.loading ? (
          <div className="rca-sub">Querying the test-level table…</div>
        ) : state.error ? (
          <div className="rca-sub">{state.error}</div>
        ) : (
          <>
            <div className="rca-table-wrap">
              <table className="rca-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Test</th>
                    <th className="rca-num">Orders</th>
                    <th className="rca-num" title="Baseline plus the stretch: the Settings target spread over the year by baseline weekday weights">Goal</th>
                    <th className="rca-num">Order Δ</th>
                    <th className="rca-num">Revenue on those orders</th>
                    <th className="rca-num">Revenue Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.rows ?? []).map((r, i) => (
                    <tr key={r.test}>
                      <td className="rca-dim2">{i + 1}</td>
                      <td>{r.test}</td>
                      <td className="rca-num rca-mono">{INT(r.orders)}</td>
                      <td className="rca-num rca-mono rca-dim2">
                        {INT(r.expectedOrders)}
                      </td>
                      <td
                        className="rca-num rca-mono"
                        style={{
                          color:
                            r.orderDelta < 0
                              ? "var(--vw-error)"
                              : "var(--vw-success)",
                        }}
                      >
                        {r.orderDelta >= 0 ? "+" : ""}
                        {INT(r.orderDelta)}
                      </td>
                      <td className="rca-num rca-mono rca-dim2">
                        {MONEY_PLAIN(r.revenue)}
                      </td>
                      <td
                        className="rca-num rca-mono"
                        style={{
                          color:
                            r.delta < 0
                              ? "var(--vw-error)"
                              : "var(--vw-success)",
                        }}
                      >
                        {MONEY(r.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rca-lens-note">{state.note}</div>
          </>
        )
      ) : null}
    </div>
  );
}

type FamilyClinic = {
  clinic: string;
  health?: string[];
  pstatus?: string[];
  name: string;
  state: string;
  sales: string;
  cohort: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  aov: number;
  /** Absent on the test-switch list, which is scoped to a test pair. */
  bundleShare?: number;
};

type CustomerRow = {
  customerId: string;
  name: string;
  type: string;
  revenue: number;
  orders: number;
  patients: number;
  aov: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  lastOrder: string;
  hubspot?: string;
};

/** One clinic row that expands into the customers ordering inside it. */
function ClinicRowWithCustomers({
  rank,
  row,
  periodId,
  family,
  scope,
  extra,
}: {
  rank: number;
  row: FamilyClinic;
  periodId: string;
  family?: string;
  /** Order universe of the list this row belongs to. */
  scope?: "all" | "bundle" | "nonbundle";
  /** Optional context line under the clinic name (e.g. substitution detail). */
  extra?: React.ReactNode;
}) {
  const run = useRcaAction(api.families.customersAction);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      run({ password: pw(), clinic: row.clinic, periodId, family, scope })
        .then(r => setRows(r.rows))
        .catch(e => setError(String(e).slice(0, 160)));
    }
  };

  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <td className="rca-dim2">{rank}</td>
        <td>
          <button type="button" className="rca-expand" onClick={toggle}>
            <span className="rca-chevron">{open ? "▾" : "▸"}</span>
            {row.name}
          </button>
          <Health flags={row.health} />
          {extra ? <div className="rca-dim2 rca-tiny">{extra}</div> : null}
        </td>
        <td>{row.state}</td>
        <td>{row.sales}</td>
        <td>{COHORT_SHORT[row.cohort] ?? row.cohort}</td>
        <td className="rca-num">{MONEY_PLAIN(row.expected)}</td>
        <td className="rca-num">{MONEY_PLAIN(row.revenue)}</td>
        <td className="rca-num">
          {INT(row.orders)}{" "}
          <span className="rca-dim2">vs {INT(row.expectedOrders)}</span>
        </td>
        <DeltaCell value={row.orders - row.expectedOrders} kind="orders" />
        <td className="rca-num">${INT(row.aov)}</td>
        {row.bundleShare === undefined ? null : (
          <td className="rca-num">{PCT_SHARE(row.bundleShare)}</td>
        )}
        <td
          className="rca-num rca-strong"
          style={{
            color: row.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
          }}
        >
          {MONEY(row.delta)}
        </td>
      </tr>
      {open ? (
        <tr className="rca-subrow">
          <td colSpan={12}>
            <ClinicPortfolio
              clinic={row.clinic}
              periodId={periodId}
              scope={scope}
            />
            <ClinicFootprintNote clinic={row.clinic} />
            <CustomerTable rows={rows} error={error} showDelta={!!family} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

type StopFields = {
  stops?: { family: string; month: string; lastOrder: string; priorOrders: number }[];
  stopFamilies?: string;
  stopMonth?: string;
  stopMonthNum?: number;
  stopLastOrder?: string;
  stopLastNum?: number;
  stopDays?: number;
  stopPrior?: number;
};

const monLabel = (ym: string) =>
  new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

/** GZ / Total Tox stop columns; one line per stopped family. */
function StopCells({ row }: { row: DrillClinic & StopFields }) {
  const ss = row.stops ?? [];
  const short = (f: string) => (f === "Gut Zoomer" ? "Gut Zoomer" : "Total Tox");
  const lines = (pick: (s: (typeof ss)[number]) => string | number) =>
    ss.map((s, i) => <div key={i}>{pick(s)}</div>);
  return (
    <>
      <td className="rca-stop-cell">{lines(s => short(s.family))}</td>
      <td className="rca-num rca-stop-cell">{lines(s => monLabel(s.month))}</td>
      <td className="rca-num rca-stop-cell">{lines(s => s.lastOrder)}</td>
      <td className="rca-num">{INT(row.stopDays ?? 0)}</td>
      <td className="rca-num rca-stop-cell">{lines(s => INT(s.priorOrders))}</td>
    </>
  );
}

type DrillClinic = {
  clinic: string;
  health?: string[];
  pstatus?: string[];
  name: string;
  state: string;
  sales: string;
  cohort: string;
  expected: number;
  actual: number;
  orders: number;
  expectedOrders: number;
  aov: number;
  baseAov: number;
  bundleDelta: number;
  bundleShare: number;
  baseBundleShare: number;
  patients: number;
  expectedPatients: number;
  patientDelta: number;
  metric: number;
};

/** A row of the main clinic table, expandable into its customers. */
/** A signed numeric cell: red when below the clinic's own baseline. */
function DeltaCell({ value, kind }: { value: number; kind: "orders" | "money" }) {
  const v = Math.round(value);
  return (
    <td
      className="rca-num"
      style={{ color: v < 0 ? "var(--vw-error)" : v > 0 ? "var(--vw-success)" : "inherit" }}
    >
      {v === 0 ? "—" : `${v > 0 ? "+" : "−"}${kind === "money" ? "$" : ""}${INT(Math.abs(v))}`}
    </td>
  );
}

function ClinicPanelRow({
  rank,
  row,
  periodId,
  current,
  target,
  scope,
  lens,
  showStops,
}: {
  rank: number;
  row: DrillClinic;
  /** Extra GZ / Total Tox stop columns (famstops focus). */
  showStops?: boolean;
  periodId: string;
  /** The clinic's current weekly rate across the window. */
  current?: { revWeek: number; ordWeek: number };
  /** Saved weekly target, if a plan exists for this clinic. */
  target?: { rev: number; ord: number };
  /** Order universe of the tree node this list was opened from. */
  scope?: "all" | "bundle" | "nonbundle";
  /** Lens of the list; the traffic lens formats the metric as patients. */
  lens?: string;
}) {
  const run = useRcaAction(api.families.customersAction);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      run({ password: pw(), clinic: row.clinic, periodId, scope })
        .then(r => setRows(r.rows))
        .catch(e => setError(String(e).slice(0, 160)));
    }
  };

  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <td className="rca-dim2">{rank}</td>
        <td>
          <button type="button" className="rca-expand" onClick={toggle}>
            <span className="rca-chevron">{open ? "▾" : "▸"}</span>
            {row.name}
          </button>
          <Health flags={row.health} />
        </td>
        <td>{row.state}</td>
        <td>{row.sales}</td>
        <td>{COHORT_SHORT[row.cohort] ?? row.cohort}</td>
        {showStops ? <StopCells row={row as DrillClinic & StopFields} /> : null}
        <td className="rca-num">{MONEY_PLAIN(row.expected)}</td>
        <td className="rca-num">{MONEY_PLAIN(row.actual)}</td>
        <td className="rca-num">
          {INT(row.orders)}{" "}
          <span className="rca-dim2">vs {INT(row.expectedOrders)}</span>
        </td>
        <DeltaCell value={row.orders - row.expectedOrders} kind="orders" />
        <td className="rca-num">
          ${INT(row.aov)}{" "}
          <span className="rca-dim2">vs ${INT(row.baseAov)}</span>
        </td>
        <DeltaCell
          value={row.baseAov > 0 ? row.aov - row.baseAov : 0}
          kind="money"
        />
        <td className="rca-num">
          {PCT_SHARE(row.bundleShare)}{" "}
          <span className="rca-dim2">vs {PCT_SHARE(row.baseBundleShare)}</span>
        </td>
        <td
          className="rca-num"
          style={{
            color:
              row.bundleDelta < 0 ? "var(--vw-error)" : "var(--vw-success)",
          }}
        >
          {MONEY(row.bundleDelta)}
        </td>
        <td
          className="rca-num rca-strong"
          style={{
            color: row.metric < 0 ? "var(--vw-error)" : "var(--vw-success)",
          }}
        >
          {lens === "traffic" ? PATIENTS_FMT(row.metric) : MONEY(row.metric)}
        </td>
        <PlanCells clinic={row.clinic} name={row.name} current={current} target={target} />
      </tr>
      {open ? (
        <tr className="rca-subrow">
          <td colSpan={showStops ? 22 : 17}>
            <ClinicPortfolio
              clinic={row.clinic}
              periodId={periodId}
              scope={scope}
            />
            <ClinicFootprintNote clinic={row.clinic} />
            <CustomerTable rows={rows} error={error} />
          </td>
        </tr>
      ) : null}
    </>
  );
}


/**
 * The two editable plan cells on a clinic row: current orders/week and
 * revenue/week with a target beside each. Saving writes the target straight to
 * the plan table, which the year-end projection reads on its next render.
 */
function PlanCells({
  clinic,
  name,
  current,
  target,
}: {
  clinic: string;
  name: string;
  current?: { revWeek: number; ordWeek: number };
  target?: { rev: number; ord: number };
}) {
  const save = useMutation(api.plan.setPlan);
  const [ord, setOrd] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const ordVal = ord ?? (target?.ord ? String(Math.round(target.ord)) : "");
  const revVal = rev ?? (target?.rev ? String(Math.round(target.rev)) : "");

  const commit = async () => {
    const o = Number(ordVal) || 0;
    const r = Number(revVal) || 0;
    if (o === (target?.ord ?? 0) && r === (target?.rev ?? 0)) return;
    await save({
      password: pw(),
      clinic,
      name,
      targetOrdersWeek: o,
      targetRevenueWeek: r,
    });
    setOrd(null);
    setRev(null);
    setSaved(true);
  };

  return (
    <>
      <td className="rca-num rca-plan">
        <span className="rca-plan-now">{(current?.ordWeek ?? 0).toFixed(1)}</span>
        <input
          className="rca-plan-input"
          type="number"
          min={0}
          step={1}
          placeholder="target"
          aria-label={`Target orders per week for ${name}`}
          value={ordVal}
          onChange={e => {
            setOrd(e.target.value);
            setSaved(false);
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
      <td className="rca-num rca-plan">
        <span className="rca-plan-now">
          {MONEY_PLAIN(current?.revWeek ?? 0)}
        </span>
        <input
          className="rca-plan-input"
          type="number"
          min={0}
          step={500}
          placeholder="target"
          aria-label={`Target revenue per week for ${name}`}
          value={revVal}
          onChange={e => {
            setRev(e.target.value);
            setSaved(false);
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        {saved ? <span className="rca-plan-ok">saved</span> : null}
      </td>
    </>
  );
}

function CustomerTable({
  rows,
  error,
  showDelta = true,
}: {
  rows: CustomerRow[] | null;
  error: string | null;
  /** Hidden when the list is not scoped to one family: the customer delta
   * would then be the clinic's all-product delta, not this node's. */
  showDelta?: boolean;
}) {
  if (error) return <div className="rca-sub">{error}</div>;
  if (rows === null) return <div className="rca-sub">Loading customers…</div>;
  if (rows.length === 0) {
    return <div className="rca-sub">No customer detail for this period.</div>;
  }
  return (
    <table className="rca-table rca-table-sub">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Type</th>
          <th className="rca-num" title="Baseline plus the stretch: the Settings target spread over the year by baseline weekday weights">Goal</th>
          <th className="rca-num">Actual</th>
          <th className="rca-num">Orders</th>
          <th className="rca-num">Patients</th>
          <th className="rca-num">AOV</th>
          <th className="rca-num">Last order</th>
          {showDelta ? <th className="rca-num">Revenue Δ</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map(c => (
          <tr key={c.customerId}>
            <td>
              {c.hubspot ? (
                <a
                  className="rca-link"
                  href={c.hubspot}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in HubSpot"
                >
                  {c.name} ↗
                </a>
              ) : (
                c.name
              )}
            </td>
            <td>{c.type}</td>
            <td className="rca-num">{MONEY_PLAIN(c.expected)}</td>
            <td className="rca-num">{MONEY_PLAIN(c.revenue)}</td>
            <td className="rca-num">
              {INT(c.orders)}{" "}
              <span className="rca-dim2">vs {INT(c.expectedOrders)}</span>
            </td>
            <td className="rca-num">{INT(c.patients)}</td>
            <td className="rca-num">${INT(c.aov)}</td>
            <td className="rca-num rca-dim2">{c.lastOrder}</td>
            {showDelta ? (
              <td
                className="rca-num rca-strong"
                style={{
                  color: c.delta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                }}
              >
                {MONEY(c.delta)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Clinic-list filters: health note (clinic_dimension[Note]) and portfolio
 * status (NEW / STOPPED / DECLINING from the Portfolio Changes table).
 * Filtering is applied client-side to the rows already fetched, so the
 * ranking and the node total stay untouched.
 */
function useClinicFilters<
  T extends {
    health?: string[];
    pstatus?: string[];
    name?: string;
    clinic?: string;
    state?: string;
    sales?: string;
  },
>(rows: T[]) {
  const [health, setHealth] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  // Any numeric column can drive the order of the list; the default (null)
  // keeps the server's contribution ranking.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Optional roll-up of the same filtered/sorted rows into State or Owner
  // groups, without changing the underlying ranking.
  const [groupBy, setGroupBy] = useState<"" | "state" | "owner">("");

  const count = (pick: (r: T) => string[] | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      for (const v of pick(r) ?? []) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const healthOptions = count(r => r.health);
  const statusOptions = count(r => r.pstatus);

  const q = term.trim().toLowerCase();
  const filtered = rows.filter(
    r =>
      (!health || (r.health ?? []).includes(health)) &&
      (!status || (r.pstatus ?? []).includes(status)) &&
      (!q || (r.name ?? "").toLowerCase().includes(q)),
  );

  const bar =
    rows.length === 0 ? null : (
      <div className="rca-filters">
        <span className="rca-filter-label">Filter</span>
        <input
          className="rca-search-input rca-filter-search"
          placeholder="Find clinic in this list…"
          value={term}
          onChange={e => setTerm(e.target.value)}
        />
        <select
          className="rca-select"
          value={health ?? ""}
          onChange={e => setHealth(e.target.value || null)}
        >
          <option value="">Health · any</option>
          {healthOptions.map(([v, n]) => (
            <option key={v} value={v}>
              {v} ({n})
            </option>
          ))}
        </select>
        <select
          className="rca-select"
          value={status ?? ""}
          onChange={e => setStatus(e.target.value || null)}
          title="Portfolio status: recent 28 days vs. prior 90-day baseline"
        >
          <option value="">Portfolio status · any</option>
          {statusOptions.map(([v, n]) => (
            <option key={v} value={v}>
              {v} ({n})
            </option>
          ))}
        </select>
        <select
          className="rca-select"
          value={groupBy}
          onChange={e => setGroupBy(e.target.value as "" | "state" | "owner")}
        >
          <option value="">Group by · none</option>
          <option value="state">Group by state</option>
          <option value="owner">Group by owner</option>
        </select>
        {health || status || q ? (
          <>
            <button
              type="button"
              className="rca-tab"
              onClick={() => {
                setHealth(null);
                setStatus(null);
                setTerm("");
              }}
            >
              clear
            </button>
            <span className="rca-filter-note">
              {INT(filtered.length)} of {INT(rows.length)} listed clinics ·{" "}
              {MONEY(
                filtered.reduce(
                  (acc, r) =>
                    acc +
                    ((r as { metric?: number; delta?: number }).metric ??
                      (r as { delta?: number }).delta ??
                      0),
                  0,
                ),
              )}
            </span>
          </>
        ) : null}
      </div>
    );

  const valOf = (r: T, key: string): number | string => {
    const o = r as unknown as Record<string, unknown>;
    const v = o[key];
    if (typeof v === "string") return v.toLowerCase();
    return numOf(r, key);
  };
  const numOf = (r: T, key: string): number => {
    const o = r as unknown as Record<string, number>;
    if (key === "orderDelta") return (o.orders ?? 0) - (o.expectedOrders ?? 0);
    if (key === "aovDelta") return (o.aov ?? 0) - (o.baseAov ?? 0);
    return o[key] ?? 0;
  };
  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const x = valOf(a, sort.key);
        const y = valOf(b, sort.key);
        const c =
          typeof x === "string" || typeof y === "string"
            ? String(x).localeCompare(String(y))
            : x - y;
        return c * sort.dir;
      })
    : filtered;

  // Rank stays tied to the overall sorted list (contribution order, or the
  // active column sort) even when the rows are visually clustered by group.
  const rankOf = new Map<string, number>();
  sorted.forEach((r, i) => rankOf.set((r.clinic ?? r.name ?? String(i)) as string, i + 1));

  const metricOf = (r: T) =>
    (r as unknown as { metric?: number; delta?: number }).metric ??
    (r as unknown as { delta?: number }).delta ??
    0;

  const groups =
    groupBy === ""
      ? null
      : (() => {
          const m = new Map<string, T[]>();
          for (const r of sorted) {
            const key =
              (groupBy === "state" ? r.state : r.sales) || "Unassigned";
            const arr = m.get(key);
            if (arr) arr.push(r);
            else m.set(key, [r]);
          }
          return [...m.entries()]
            .map(([key, groupRows]) => ({
              key,
              rows: groupRows,
              count: groupRows.length,
              total: groupRows.reduce((s, r) => s + metricOf(r), 0),
            }))
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
        })();

  /** Sortable numeric header cell. Click cycles ascending → descending. */
  const th = (label: string, key: string, text = false) => (
    <th
      key={key}
      className={`${text ? "" : "rca-num "}rca-th-sort${sort?.key === key ? " is-sorted" : ""}`}
      onClick={() =>
        setSort(
          sort && sort.key === key
            ? sort.dir === 1
              ? { key, dir: -1 }
              : null
            : { key, dir: 1 },
        )
      }
    >
      {label}
      <span className="rca-th-arrow">
        {sort?.key === key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );

  return { rows: sorted, groups, groupBy, rankOf, bar, th };
}

/** Sub-header row shown above each state/owner cluster when grouping is on. */
function ClinicGroupHeader({
  label,
  groupBy,
  count,
  total,
  colSpan,
  isPatients,
}: {
  label: string;
  groupBy: "state" | "owner";
  count: number;
  total: number;
  colSpan: number;
  isPatients?: boolean;
}) {
  return (
    <tr className="rca-group-row">
      <td colSpan={colSpan}>
        <span className="rca-eyebrow rca-dim">
          {groupBy === "state" ? "State" : "Owner"}
        </span>{" "}
        <strong>{label}</strong> · {INT(count)} clinic{count === 1 ? "" : "s"}{" "}
        · {isPatients ? PATIENTS_FMT(total) : MONEY(total)}
      </td>
    </tr>
  );
}

/** Clinic health flags, maintained in the dataset's clinic_dimension note. */
function Health({ flags }: { flags?: string[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <span className="rca-health">
      {flags.map(f => (
        <span key={f} className="rca-chip" title={f}>
          {f}
        </span>
      ))}
    </span>
  );
}

type PortfolioRow = {
  family: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
  status: string;
  baselineAvg: number;
  recentOrders: number;
};

/** The families a single clinic actually orders, with its portfolio status. */
/** OSINT digital-footprint note shown when a clinic has a researched finding. */
function ClinicFootprintNote({ clinic }: { clinic: string }) {
  const note = CLINIC_FOOTPRINTS[clinic];
  if (!note) return null;
  return (
    <div className="rca-masknote">
      <div className="rca-eyebrow rca-dim" style={{ marginBottom: 6 }}>
        Digital footprint (OSINT, {note.confidence === "solid" ? "verified" : "tentative"})
      </div>
      <div>{note.finding}</div>
      <div style={{ marginTop: 4 }}>
        <strong>Likely cause:</strong> {note.cause}
      </div>
    </div>
  );
}

function ClinicPortfolio({
  clinic,
  periodId,
  scope,
}: {
  clinic: string;
  periodId: string;
  /** Order universe of the list this clinic sits in. */
  scope?: "all" | "bundle" | "nonbundle";
}) {
  const run = useRcaAction(api.families.portfolioAction);
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    run({ password: pw(), clinic, periodId, scope })
      .then(r => {
        if (live) setRows(r.rows);
      })
      .catch(e => {
        if (live) setError(String(e).slice(0, 160));
      });
    return () => {
      live = false;
    };
  }, [run, clinic, periodId, scope]);

  if (error) return <div className="rca-sub">{error}</div>;
  if (rows === null) {
    return <div className="rca-sub">Loading this clinic's portfolio…</div>;
  }
  if (rows.length === 0) {
    return <div className="rca-sub">No product families in this window.</div>;
  }
  return (
    <div className="rca-portfolio">
      <div className="rca-eyebrow rca-dim">
        Product families ordered by this clinic
        {scope === "bundle"
          ? " · bundle orders only"
          : scope === "nonbundle"
            ? " · non-bundle orders only"
            : ""}
      </div>
      <div className="rca-sub rca-dim2 rca-tiny">
        Orders only — an order can carry several families, so revenue cannot be
        attributed to one family without pro-rating it.
      </div>
      <div className="rca-sub rca-dim2 rca-tiny">
        Portfolio status compares the last 28 days of orders against the prior 90-day baseline — independent of the window selected above.
      </div>
      <table className="rca-table rca-table-sub">
        <thead>
          <tr>
            <th>Family</th>
            <th className="rca-num">Orders</th>
            <th className="rca-num">Order Δ</th>
            <th title="Recent 28 days vs. prior 90-day baseline">Portfolio status ⓘ</th>
            <th className="rca-num" title="Prior 90-day baseline daily average → recent 28-day total">28d recent vs 90d baseline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.family}>
              <td>{r.family}</td>
              <td className="rca-num">
                {INT(r.orders)}{" "}
                <span className="rca-dim2">vs {INT(r.expectedOrders)}</span>
              </td>
              <td
                className="rca-num rca-strong"
                style={{
                  color:
                    r.orderDelta < 0 ? "var(--vw-error)" : "var(--vw-success)",
                }}
              >
                {r.orderDelta >= 0 ? "+" : ""}
                {INT(r.orderDelta)}
              </td>
              <td>
                {r.status ? (
                  <span className={`rca-status is-${r.status.toLowerCase()}`}>
                    {r.status}
                  </span>
                ) : (
                  <span className="rca-dim2">—</span>
                )}
              </td>
              <td className="rca-num rca-dim2">
                {r.status
                  ? `${r.baselineAvg.toFixed(1)} → ${INT(r.recentOrders)}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SwitchClinic = FamilyClinic & {
  downStatus: string;
  upStatus: string;
  downOrders: number;
  downExpectedOrders: number;
  downOrderDelta: number;
  downDelta: number;
  upOrders: number;
  upExpectedOrders: number;
  upOrderDelta: number;
  upDelta: number;
  netDelta: number;
  netOrderDelta: number;
  klass: string;
};

const switchTabs = (
  down: string,
  up: string,
): Array<{ id: string; label: string; hint: string }> => [
  {
    id: "stayed",
    label: "Not moved over",
    hint: `dropped ${down} and ordered none of the ${up} replacement`,
  },
  {
    id: "lost",
    label: "Down on both",
    hint: `${down} down and ${up} also below its own goal`,
  },
  {
    id: "partial",
    label: "Partly moved",
    hint: `${up} picked up some, but under 60% of the ${down} orders lost`,
  },
  {
    id: "switched",
    label: "Moved over",
    hint: `${up} picked up 60%+ of the ${down} orders lost`,
  },
  {
    id: "gained",
    label: `${down} orders are flat or up`,
    hint: `${down} held at or above its own goal — no decline to explain; these clinics offset the drop elsewhere`,
  },
  {
    id: "uponly",
    label: `${up} only`,
    hint: `never ordered ${down} in either window — only ${up} activity, so the substitution question does not apply`,
  },
];

/**
 * Clinic list behind a substitution pair: who dropped the declining test and
 * whether the replacement picked it up, joined to Portfolio Changes status.
 */
function SwitchPanel({
  periodId,
  periodLabel,
  pair,
  limit,
  onLimit,
  onClose,
}: {
  periodId: string;
  periodLabel: string;
  pair: string;
  limit: number;
  onLimit: (n: number) => void;
  onClose: () => void;
}) {
  const [down, up] = pair.split(">");
  const run = useRcaAction(api.families.switchClinicsAction);
  const [tab, setTab] = useState("stayed");
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    data?: {
      rows: SwitchClinic[];
      counts: Record<string, number>;
      groupDelta: Record<string, number>;
      totals: {
        downDelta: number;
        upDelta: number;
        downOrderDelta: number;
        upOrderDelta: number;
      };
      count: number;
    };
  }>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    run({ password: pw(), periodId, down, up, limit })
      .then(data => {
        if (live) setState({ loading: false, data });
      })
      .catch(e => {
        if (live) setState({ loading: false, error: String(e).slice(0, 200) });
      });
    return () => {
      live = false;
    };
  }, [run, periodId, down, up, limit]);

  const data = state.data;
  const rows = (data?.rows ?? []).filter(r => r.klass === tab);
  const filters = useClinicFilters(rows);
  const tabs = switchTabs(down, up);
  const active = tabs.find(t => t.id === tab);
  const stayedLoss = data?.groupDelta?.stayed ?? 0;

  return (
    <section className="rca-card rca-drill">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">
            Who moved from {down} to {up}?
          </div>
          <div className="rca-drill-title">
            {down} → {up} · {periodLabel}
          </div>
          <div className="rca-sub">
            {state.loading
              ? "Querying Power BI for both families…"
              : state.error
                ? state.error
                : `${INT(data?.counts.stayed ?? 0)} clinics dropped ${down} orders and bought no ${up} at all (${MONEY(stayedLoss)}), ${INT(data?.counts.switched ?? 0)} moved over and ${INT(data?.counts.partial ?? 0)} moved partly. Overall ${down} ${MONEY(data?.totals.downDelta ?? 0)} vs ${up} ${MONEY(data?.totals.upDelta ?? 0)}.`}
          </div>
        </div>
        <div className="rca-drill-actions">
          {[25, 60, 150].map(n => (
            <button
              type="button"
              key={n}
              className={`rca-tab${limit === n ? " is-active" : ""}`}
              onClick={() => onLimit(n)}
            >
              top {n}
            </button>
          ))}
          <button type="button" className="rca-tab" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      <div className="rca-fam-scope">
        {tabs.map(t => (
          <button
            type="button"
            key={t.id}
            className={`rca-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            {t.label} ({INT(data?.counts[t.id] ?? 0)})
          </button>
        ))}
      </div>
      <div className="rca-sub rca-dim2">
        {active?.hint}
        {data && rows.length < (data.counts[tab] ?? 0)
          ? ` · showing the top ${INT(rows.length)} of ${INT(data.counts[tab] ?? 0)} by net revenue impact — use Top 60 / Top 150 for more`
          : ""}
      </div>

      {rows.length > 0 ? filters.bar : null}

      {rows.length > 0 ? (
        <div className="rca-table-wrap">
          <table className="rca-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Clinic</th>
                <th>State</th>
                <th>Owner</th>
                <th>Cohort</th>
                {filters.th("Goal", "expected")}
                {filters.th("Actual", "revenue")}
                {filters.th("Orders", "orders")}
                {filters.th("Order Δ", "orderDelta")}
                {filters.th("AOV", "aov")}
                {filters.th("Revenue Δ", "delta")}
              </tr>
            </thead>
            <tbody>
              {filters.groups
                ? filters.groups.flatMap(g => [
                    <ClinicGroupHeader
                      key={`g-${g.key}`}
                      label={g.key}
                      groupBy={filters.groupBy as "state" | "owner"}
                      count={g.count}
                      total={g.total}
                      colSpan={11}
                    />,
                    ...g.rows.map(r => (
                      <ClinicRowWithCustomers
                        key={r.clinic}
                        rank={filters.rankOf.get(r.clinic) ?? 0}
                        row={r}
                        periodId={periodId}
                        extra={pairLine(r as SwitchClinic, down, up)}
                      />
                    )),
                  ])
                : filters.rows.map((r, i) => (
                    <ClinicRowWithCustomers
                      key={r.clinic}
                      rank={i + 1}
                      row={r}
                      periodId={periodId}
                      extra={pairLine(r as SwitchClinic, down, up)}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      ) : state.loading ? null : (
        <div className="rca-sub">No clinics in this group.</div>
      )}
    </section>
  );
}

/** One-line substitution detail shown under the clinic name in the pair list. */
function pairLine(r: SwitchClinic, down: string, up: string) {
  const status = [
    r.downStatus ? `${down}: ${r.downStatus}` : "",
    r.upStatus ? `${up}: ${r.upStatus}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${INT(n)}`;
  return `${down} ${INT(r.downOrders)} ord (${sign(r.downOrderDelta)}, ${MONEY(r.downDelta)}) · ${up} ${INT(r.upOrders)} ord (${sign(r.upOrderDelta)}, ${MONEY(r.upDelta)})${status ? ` · ${status}` : ""}`;
}
