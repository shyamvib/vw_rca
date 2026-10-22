/**
 * Sales Rep View — "1b Thermometer rail" layout (Shyam, 2026-09-28).
 * Left rail: this week vs plan thermometer + leaderboard rank.
 * Tabs: Today (call list, new-clinic funnel, say thanks), This week (four
 * lenses, effort, leaderboard, weekly targets), Scorecard (6×4 KPI matrix from
 * "Sales perf KPIs v2" + KPI library). Numbers come from convex/repView.ts.
 */
const SHOW_SANKEY = true;
import { Logo } from "@/components/Logo";
import { ScorecardGuide, guideIdFor, guideNav, openGuide } from "./ScorecardGuide";
import { useMutation, useQuery } from "convex/react";
import { useRcaQuery, useRcaAction } from "@/lib/rca";
import React, { Fragment, useEffect, useMemo, useState, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CLINIC_FOOTPRINTS } from "./clinicFootprints";
import { pw } from "./gatePw";
import { insightHeadline } from "@/lib/insightHeadline";
import "./repview.css";
import { AlertRail, FamilyLevel, FamilyPanel, SwitchPanel } from "./RcaDashboardPage";
import { FeedTable, ViewToggle, useFeedView, type FeedRow } from "./FeedViews";
import { RaiseQuestionDialog } from "./RaiseQuestion";

type Tab = "today" | "plan" | "feed" | "week" | "month" | "quarter" | "custom" | "scorecard";
type Tone = "good" | "watch" | "bad" | "act" | "na";

const K = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(a)}`;
};
const SK = (n: number) => (n > 0 ? `+${K(n)}` : K(n));
// Compact tick-label formatter for the gauge (Shyam, 2026-09-29) — gauge
// ticks always land on "nice" round steps, so drop the decimal K() forces
// (avoids "$900.0K" overflowing the narrow rail; "$900K" fits).
const KT = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${+(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${+(a / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(a)}`;
};
const P = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? "—" : `${(n * 100).toFixed(d)}%`;
const SP = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const fmtD = (d?: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const COHORT: Record<string, string> = {
  churned: "Churned",
  new: "Active · new",
  retained_top20: "Active · top 20%",
  retained_rest: "Active · rest",
  reactivated: "Reactivated",
};

export type RepViewPeriod = { id: string; kind: string; label: string; start: string; end: string };

export function RepView(props: {
  sales: string;
  isRep: boolean;
  /** A rep-view-only login that may open any rep: shows a way back to the rep list. */
  canSwitchRep?: boolean;
  /** A VP of sales: the lead's own name, which names the "All reps (my team)" scope. */
  teamName?: string;
  periodId: string;
  periodLabel: string;
  weeks: RepViewPeriod[];
  months: RepViewPeriod[];
  quarters: RepViewPeriod[];
  days: RepViewPeriod[];
  reps: string[];
  onPickRep: (name: string) => void;
  clinicTerm?: string;
  provTerm?: string;
  onClearSearch?: () => void;
}) {
  const { sales, isRep, periodId, periodLabel, weeks, months, quarters, days } = props;
  const [tab, setTab] = useState<Tab>("today");
  const [askOpen, setAskOpen] = useState(false);
  const [searchSel, setSearchSel] = useState<SearchSel | null>(null);
  useEffect(() => setSearchSel(null), [props.clinicTerm, props.provTerm, sales]);
  const [recent, setRecent] = useState<SearchSel[]>(() => { try { return JSON.parse(localStorage.getItem("rv-recent-search") || "[]"); } catch { return []; } });
  const saveRecent = (l: SearchSel[]) => { setRecent(l); try { localStorage.setItem("rv-recent-search", JSON.stringify(l)); } catch { /* ignore */ } };
  const openSel = (x: SearchSel | null) => {
    setSearchSel(x);
    if (x) saveRecent([x, ...recent.filter(r => searchKey(r) !== searchKey(x))].slice(0, 10));
  };
  const [health, setHealth] = useState("");
  const [pstatus, setPstatus] = useState("");
  const [stuckWin, setStuckWin] = useState<{ min: number; max: number }>({ min: 14, max: 21 });
  const [clinicSel, setClinicSel] = useState<string | null>(null);
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const thisQuarter = quarters[quarters.length - 1];
  const lastQuarter = quarters[quarters.length - 2];
  const today = days[days.length - 1];
  // Rail leaderboard follows whichever window tab is open (2026-09-28 round 3):
  // "Leaderboard · this week/month/custom window", with a same-shape prior
  // window for the rank-change line only where one exists (week, month).
  const lbWin =
    tab === "month"
      ? { id: thisMonth?.id, prevId: lastMonth?.id, label: "this month" }
      : tab === "quarter"
        ? { id: thisQuarter?.id, prevId: lastQuarter?.id, label: "this quarter" }
        : tab === "custom"
          ? { id: periodId, prevId: undefined, label: "custom window" }
          : { id: thisWeek?.id, prevId: lastWeek?.id, label: "this week" };
  // Thermometer follows the same active-tab window (Shyam, 2026-09-28 round
  // 5) — was hardcoded to "this week" regardless of the open tab. Exception
  // (Shyam, 2026-09-28 later): "today" tab still shows "this week" on the
  // thermometer instead of a single day's pace.
  const thermoWin =
    tab === "month"
        ? { id: thisMonth?.id, prevId: lastMonth?.id, label: "This month" }
        : tab === "quarter"
          ? { id: thisQuarter?.id, prevId: lastQuarter?.id, label: "This quarter" }
          : tab === "custom"
            ? { id: periodId, prevId: undefined, label: "Custom window" }
            : { id: thisWeek?.id, prevId: lastWeek?.id, label: "This week" };
  // The scorecard lives in each window tab now; "See in scorecard" jumps to This week and highlights the cell.
  const openScorecard = (focus: string | null = null) => {
    setScFocus(focus);
    setTab("week");
  };
  // "Explain this metric" on the scorecard opens the guide tab at that metric.
  guideNav.go = () => { setSearchSel(null); setScFocus(null); setTab("scorecard"); };
  // Prior same-shape window for the scorecard's WoW/MoM/QoQ chips (Shyam, 2026-10-13).
  const prevFor = (pid: string | undefined) => {
    for (const list of [days, weeks, months, quarters] as Array<Array<{ id: string; label: string }>>) {
      const i = list.findIndex(x => x.id === pid);
      if (i > 0) return list[i - 1];
    }
    return undefined;
  };
  const bookQ = useRcaQuery(
    api.repView.book,
    sales ? { password: pw(), periodId, sales } : "skip",
  );
  const todayBookQ = useRcaQuery(
    api.repView.book,
    sales && today
      ? {
          password: pw(),
          periodId: today.id,
          sales,
          health: health || undefined,
          pstatus: pstatus || undefined,
          stuckMin: stuckWin.min,
          stuckMax: stuckWin.max,
        }
      : "skip",
  );
  const weekBookQ = useRcaQuery(
    api.repView.book,
    sales && thisWeek ? { password: pw(), periodId: thisWeek.id, sales } : "skip",
  );
  const monthBookQ = useRcaQuery(
    api.repView.book,
    sales && thisMonth ? { password: pw(), periodId: thisMonth.id, sales } : "skip",
  );
  const quarterBookQ = useRcaQuery(
    api.repView.book,
    sales && thisQuarter ? { password: pw(), periodId: thisQuarter.id, sales } : "skip",
  );
  const paceQ = useRcaQuery(
    api.repView.pace,
    sales && thermoWin.id ? { password: pw(), periodId: thermoWin.id, sales } : "skip",
  );
  const lastPaceQ = useRcaQuery(
    api.repView.pace,
    sales && thermoWin.prevId ? { password: pw(), periodId: thermoWin.prevId, sales } : "skip",
  );
  const boardLbQ = useRcaQuery(
    api.geo.salesReps,
    lbWin.id ? { password: pw(), periodId: lbWin.id } : "skip",
  );
  const boardLbPrevQ = useRcaQuery(
    api.geo.salesReps,
    lbWin.prevId ? { password: pw(), periodId: lbWin.prevId } : "skip",
  );
  const wins = useRcaQuery(
    api.wins.winsSummary,
    sales ? { password: pw(), periodId, sales } : "skip",
  );
  const winsToday = useRcaQuery(
    api.wins.winsSummary,
    sales && today ? { password: pw(), periodId: today.id, sales } : "skip",
  );
  const winsWeek = useRcaQuery(
    api.wins.winsSummary,
    sales && thisWeek ? { password: pw(), periodId: thisWeek.id, sales } : "skip",
  );
  const winsMonth = useRcaQuery(
    api.wins.winsSummary,
    sales && thisMonth ? { password: pw(), periodId: thisMonth.id, sales } : "skip",
  );
  const winsQuarter = useRcaQuery(
    api.wins.winsSummary,
    sales && thisQuarter ? { password: pw(), periodId: thisQuarter.id, sales } : "skip",
  );
  const weekFams = useRcaQuery(
    api.leadFamilies.salesFamilies,
    sales && thisWeek ? { password: pw(), periodId: thisWeek.id, sales } : "skip",
  );
  const [scFocus, setScFocus] = useState<string | null>(null);
  const [planned, setPlanned] = useState<Record<string, boolean>>({});
  const planKey = `rv-opp-plan:${sales}:${thisWeek?.id ?? ""}`;
  useEffect(() => { try { setPlanned(JSON.parse(localStorage.getItem(planKey) || "{}")); } catch { setPlanned({}); } }, [planKey]);
  const togglePlanned = (id: string) => {
    const n = { ...planned, [id]: !planned[id] };
    setPlanned(n);
    try { localStorage.setItem(planKey, JSON.stringify(n)); } catch { /* ignore */ }
  };
  const [plan, setPlan] = useState<PlanState>(() => {
    try { return { sellHours: 28, weighted: true, pins: {}, ...JSON.parse(localStorage.getItem("rv-week-plan") || "{}") }; } catch { return { sellHours: 28, weighted: true, pins: {} }; }
  });
  const savePlan = (p: PlanState) => { setPlan(p); try { localStorage.setItem("rv-week-plan", JSON.stringify(p)); } catch { /* ignore */ } };
  const planRows = usePlanRows(weekBookQ?.ready ? weekBookQ : null, weekFams, plan, sales, thisWeek?.id ?? "");
  // Bug fix (Shyam, 2026-09-28 round 5): this used to always query "Today"'s
  // periodId no matter which tab a clinic card was clicked from. A clinic
  // with $0 actual+expected specifically today (weekend baseline, etc.) but
  // real activity in This week/This month never resolved — `clinicDetail`
  // came back {ready:false}, which the caller below quietly mapped to
  // `null`, so the drawer showed "Loading…" forever instead of an error.
  const activeLabel =
    tab === "today" ? "Today's agenda" : tab === "week" ? "This week" : tab === "month" ? "This month" : tab === "quarter" ? "This quarter" : `Custom · ${periodLabel}`;
  const activePeriodId =
    tab === "today"
      ? (today?.id ?? periodId)
      : tab === "week"
        ? (thisWeek?.id ?? periodId)
        : tab === "month"
          ? (thisMonth?.id ?? periodId)
          : tab === "quarter"
            ? (thisQuarter?.id ?? periodId)
            : periodId;
  const clinicDetailQ = useRcaQuery(
    api.repView.clinicDetail,
    sales && clinicSel ? { password: pw(), periodId: activePeriodId, sales, clinic: clinicSel } : "skip",
  );

  // Leaderboard scope toggle (Shyam, 2026-09-30): "My team" = reps under the
  // same team lead, re-ranked among themselves; "All reps" = company-wide.
  const [lbScope, setLbScope] = useState<"team" | "all">("team");
  // "team:<lead>" = a VP of sales looking at the lead plus every rep under them as one combined book.
  const teamLeadName = sales.startsWith("team:") ? sales.slice(5) : null;
  const who = teamLeadName ? `${teamLeadName}'s team` : `${sales}'s`;
  const teamRows = teamLeadName ? (boardLbQ ?? []).filter(r => r.teamLead === teamLeadName) : [];
  const teamMe = teamLeadName && teamRows.length
    ? (() => { const a = teamRows.reduce((t, r) => t + r.actual, 0), e = teamRows.reduce((t, r) => t + r.expected, 0); return { pct: e ? (a - e) / e : 0, reps: teamRows.length }; })()
    : null;
  const myLead = teamLeadName ?? (boardLbQ ?? []).find(r => r.name === sales)?.teamLead;
  const scopeLead = lbScope === "team" && myLead && myLead !== "—" ? myLead : null;
  const board = useMemo(() => rankBoard(boardLbQ ?? [], scopeLead), [boardLbQ, scopeLead]);
  const boardPrev = useMemo(() => rankBoard(boardLbPrevQ ?? [], scopeLead), [boardLbPrevQ, scopeLead]);
  const boardLb = board;
  const boardLbPrev = boardPrev;
  const me = board.find(r => r.name === sales);
  const mePrev = boardPrev.find(r => r.name === sales);

  if (!sales) {
    return (
      <div className="rv-pick">
        <h2>Sales rep view</h2>
        <p>Pick a rep to open their day, week and scorecard{props.teamName ? ", or open your whole team as one book" : ""}.</p>
        {props.teamName ? (
          <div className="rv-pick-team">
            <button type="button" onClick={() => props.onPickRep(`team:${props.teamName}`)}>All reps · my team ({props.teamName} and every rep under them)</button>
          </div>
        ) : null}
        <div className="rv-pick-list">
          {props.reps.map(r => (
            <button key={r} type="button" onClick={() => props.onPickRep(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const b = bookQ?.ready ? bookQ : null;
  const tb = todayBookQ?.ready ? todayBookQ : null;
  const wb = weekBookQ?.ready ? weekBookQ : null;
  const mb = monthBookQ?.ready ? monthBookQ : null;
  const qb = quarterBookQ?.ready ? quarterBookQ : null;
  const kpiSrc = {
    week: wb?.effortWin?.week ? { e: wb.effortWin.week, periodId: thisWeek?.id ?? periodId } : null,
    month: mb?.effortWin?.month ? { e: mb.effortWin.month, periodId: thisMonth?.id ?? periodId } : null,
    quarter: qb?.effortWin?.quarter ? { e: qb.effortWin.quarter, periodId: thisQuarter?.id ?? periodId } : null,
  };
  const pace = paceQ?.ready ? paceQ : null;
  const lastPace = lastPaceQ?.ready ? lastPaceQ : null;
  // Plan win for Great Job (Shyam, 2026-09-30): current window if it has
  // enough data and is heading over plan, else the prior window if it beat it.
  const prevWord = thermoWin.label.replace("This ", "Last ");
  const planBeat =
    pace && !paceTooEarly(pace) && pace.plan > 0 && pace.heading > pace.plan
      ? { label: `${thermoWin.label}: on pace to beat goal`, amount: pace.heading - pace.plan, pct: pace.heading / pace.plan }
      : lastPace && lastPace.plan > 0 && lastPace.heading > lastPace.plan
        ? { label: `${prevWord} beat goal`, amount: lastPace.heading - lastPace.plan, pct: lastPace.heading / lastPace.plan }
        : null;
  const activeBook =
    tab === "today" ? tb : tab === "week" ? wb : tab === "month" ? mb : tab === "quarter" ? qb : b;
  const clinicDetail = clinicDetailQ ?? null;

  return (
    <div className="rv-shell">
      <aside className="rv-rail">
        <div className="rv-brand"><Logo tone="white" height={18} /></div>
        <div className="rv-rep">{teamLeadName ? `${teamLeadName}'s team` : sales}</div>
        {props.canSwitchRep ? (
          <div className="rv-switch">
            <button type="button" className="rv-explain" onClick={() => props.onPickRep("")}>Switch rep</button>
            {props.teamName && !teamLeadName ? <button type="button" className="rv-explain" onClick={() => props.onPickRep(`team:${props.teamName}`)}>All reps (my team)</button> : null}
          </div>
        ) : null}
        <div className="rv-rep-sub">
          {activeBook ? `${activeBook.clinics} clinics` : "…"} · data to {fmtD((activeBook ?? b)?.cutoff)}
        </div>
        <nav className="rv-nav">
          {(["today", "plan", "feed", "week", "month", "quarter", "custom", "scorecard"] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              className={tab === t ? "is-on" : ""}
              onClick={() => { setTab(t); setSearchSel(null); setScFocus(null); }}
            >
              {t === "today"
                ? "Today's agenda"
                : t === "plan"
                  ? "My week plan"
                : t === "feed"
                  ? "Business feed"
                : t === "week"
                  ? "This week"
                  : t === "month"
                    ? "This month"
                    : t === "quarter"
                      ? "This quarter"
                      : t === "custom"
                        ? `Custom · ${periodLabel}`
                        : "Scorecard guide"}
            </button>
          ))}
        </nav>
        <button type="button" className="rv-ask" onClick={() => setAskOpen(true)}>Raise a question</button>
        <Thermo pace={pace} lastPace={lastPace} winLabel={thermoWin.label} />
        <div className="rv-rail-sec">
          <div className="rv-eyebrow">Leaderboard · {lbWin.label}<Info k="lb" /></div>
          <div className="rv-lb-toggle">
            <button type="button" className={lbScope === "team" ? "is-on" : ""} onClick={() => setLbScope("team")}>
              My team{myLead && myLead !== "—" ? ` (${myLead.split(" ")[0]})` : ""}
            </button>
            <button type="button" className={lbScope === "all" ? "is-on" : ""} onClick={() => setLbScope("all")}>All reps</button>
          </div>
          {teamMe ? (
            <p>
              <b>{SP(teamMe.pct)}</b> vs goal this period for the {teamMe.reps} reps in {teamLeadName}'s team, combined. The board below ranks them.
            </p>
          ) : me && !isRep ? (
            <>
              <div className="rv-rank">
                {me.rank}
                <span>/{board.length}</span>
                {mePrev ? (
                  <em className={mePrev.rank >= me.rank ? "up" : "down"}>
                    {mePrev.rank === me.rank
                      ? "same place"
                      : mePrev.rank > me.rank
                        ? `up ${mePrev.rank - me.rank}`
                        : `down ${me.rank - mePrev.rank}`}
                  </em>
                ) : null}
              </div>
              <p>
                {SP(me.pct)} vs your goal
                {mePrev ? `, from ${SP(mePrev.pct)} last period` : ""}.
                {me.rank > 1
                  ? ` ${((board[me.rank - 2].pct - me.pct) * 100).toFixed(1)} pts behind ${board[me.rank - 2].name}.`
                  : " Leading the team."}
              </p>
            </>
          ) : me ? (
            <p>
              <b>{SP(me.pct)}</b> vs your goal this period
              {mePrev ? `, from ${SP(mePrev.pct)} last period` : ""}.
            </p>
          ) : (
            <p className="rv-dim">No activity yet this period.</p>
          )}
        </div>
        <RailLeaderboard
          label={`${lbWin.label} · ${scopeLead ? "my team" : "all reps"}`}
          board={boardLb}
          boardPrev={boardLbPrev}
          sales={sales}
          isRep={isRep}
        />
        <RecentSearches items={recent} selKey={searchKey(searchSel)} onOpen={openSel} onClear={() => saveRecent([])} />
      </aside>
      <main className="rv-main">
        <TourGuide tab={tab} setTab={setTab} />
        {!searchSel && tab !== "scorecard" && !((props.clinicTerm ?? "").trim().length >= 2 || (props.provTerm ?? "").trim().length >= 2) ? <TabGuide tab={tab} /> : null}
        {searchSel ? (
          <SearchDetailPage sel={searchSel} periodId={activePeriodId} winLabel={activeLabel} sales={sales} onBack={() => setSearchSel(null)} />
        ) : ((props.clinicTerm ?? "").trim().length >= 2 || (props.provTerm ?? "").trim().length >= 2) ? (
          <div className="rv-main-search">
            <RailSearch
              clinicTerm={props.clinicTerm ?? ""}
              provTerm={props.provTerm ?? ""}
              sales={sales}
              onClear={() => { setSearchSel(null); props.onClearSearch?.(); }}
              selKey={searchKey(searchSel)}
              onOpen={openSel}
            />
          </div>
        ) : tab === "today" ? (
          !tb ? (
            <div className="rv-loading">Loading {who} day…</div>
          ) : (
            <>
            {wb ? <NextBestAction rows={planRows} onPlan={() => setTab("plan")} /> : null}
            <TodayTab
              agenda={wb ? (
                <OppAgenda
                  b={wb}
                  st={pillarStatus(wb, weekFams)}
                  planned={planned}
                  onToggle={togglePlanned}
                  onOpenClinic={setClinicSel}
                  sales={sales}
                  periodId={thisWeek?.id ?? ""}
                  onScorecard={cell => openScorecard(cell)}
                />
              ) : null}
              b={tb}
              sales={sales}
              listPeriod={periodId}
              wins={winsToday}
              health={health}
              onHealth={setHealth}
              pstatus={pstatus}
              onPstatus={setPstatus}
              stuckWin={stuckWin}
              onStuckWin={setStuckWin}
              isRep={isRep}
              onOpenClinic={setClinicSel}
              onScorecard={() => openScorecard()}
            />
            <TouchKpis sales={sales} w="week" src={kpiSrc} />
            </>
          )
        ) : tab === "plan" ? (
          !wb ? (
            <div className="rv-loading">Loading {who} week…</div>
          ) : (
            <WeekPlan b={wb} fams={weekFams} plan={plan} onPlan={savePlan} sales={sales} periodId={thisWeek?.id ?? ""} />
          )
        ) : tab === "feed" ? (
          !wb ? (
            <div className="rv-loading">Loading {who} week…</div>
          ) : (
            <SignalsFeed sales={sales} periodId={thisWeek?.id ?? ""} weekLabel={thisWeek?.label ?? ""} clinics={wb.clinics} />
          )
        ) : tab === "week" ? (
          !wb ? (
            <div className="rv-loading">Loading {who} week…</div>
          ) : (
            <>
            <WindowTab
              b={wb}
              sales={sales}
              periodId={thisWeek.id}
              wins={winsWeek}
              periodLabel={`This week · ${thisWeek?.label ?? ""}`}
              showFunnel={false}
              planBeat={planBeat}
              prev={prevFor(thisWeek.id)}
              scFocus={scFocus}
            />
            <TouchKpis sales={sales} w="week" src={kpiSrc} />
            </>
          )
        ) : tab === "month" ? (
          !mb ? (
            <div className="rv-loading">Loading {who} month…</div>
          ) : (
            <>
            <WindowTab
              b={mb}
              sales={sales}
              periodId={thisMonth.id}
              wins={winsMonth}
              periodLabel={`This month · ${thisMonth?.label ?? ""}`}
              showFunnel
              planBeat={planBeat}
              prev={prevFor(thisMonth.id)}
            />
            <TouchKpis sales={sales} w="month" src={kpiSrc} />
            </>
          )
        ) : tab === "quarter" ? (
          !qb ? (
            <div className="rv-loading">Loading {who} quarter…</div>
          ) : (
            <>
            <WindowTab
              b={qb}
              sales={sales}
              periodId={thisQuarter.id}
              wins={winsQuarter}
              periodLabel={`This quarter · ${thisQuarter?.label ?? ""}`}
              showFunnel
              planBeat={planBeat}
              prev={prevFor(thisQuarter.id)}
            />
            <TouchKpis sales={sales} w="quarter" src={kpiSrc} />
            </>
          )
        ) : tab === "custom" ? (
          !b ? (
            <div className="rv-loading">Loading {who} book…</div>
          ) : (
            <WindowTab
              b={b}
              sales={sales}
              periodId={periodId}
              wins={wins}
              periodLabel={`Custom · ${periodLabel}`}
              showFunnel={b.days >= 28}
              planBeat={planBeat}
              prev={prevFor(periodId)}
            />
          )
        ) : (
          <ScorecardGuide onOpen={t => { setScFocus(null); setTab(t); }} />
        )}
      </main>
      {askOpen ? (
        <RaiseQuestionDialog
          onClose={() => setAskOpen(false)}
          sales={sales}
          withCards={tab === "feed"}
          context={`Rep view · ${{ today: "Today's agenda", plan: "My week plan", feed: "Business feed", week: "This week", month: "This month", quarter: "This quarter", custom: "Custom dates", scorecard: "Scorecard guide" }[tab]}`}
        />
      ) : null}
      {clinicSel ? (
        <ClinicDrawer
          name={clinicSel}
          detail={clinicDetail}
          onClose={() => setClinicSel(null)}
          periodId={activePeriodId}
        />
      ) : null}
    </div>
  );
}

type BoardRow = { name: string; pct: number; delta: number; rank: number; teamLead?: string };
function rankBoard(
  rows: Array<{ name: string; actual: number; expected: number; delta: number; teamLead?: string }>,
  lead?: string | null,
): BoardRow[] {
  // Team leads are excluded from both boards (Shyam, 2026-09-30).
  const leadNames = new Set(rows.map(r => r.teamLead).filter((x): x is string => !!x && x !== "—"));
  return rows
    .filter(r => r.expected > 0 && !leadNames.has(r.name) && (!lead || r.teamLead === lead))
    .map(r => ({ name: r.name, pct: r.actual / r.expected - 1, delta: r.delta, rank: 0, teamLead: r.teamLead }))
    .sort((a, b) => b.pct - a.pct)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Full leaderboard in the rail, below the compact rank widget — its title
 * and rows follow whichever window tab is open (2026-09-28 round 3), so it
 * reads "Leaderboard · this month" / "· custom window" and not just "week". */
function RailLeaderboard({
  label,
  board,
  boardPrev,
  sales,
  isRep,
}: {
  label: string;
  board: BoardRow[];
  boardPrev: BoardRow[];
  sales: string;
  isRep: boolean;
}) {
  void isRep;
  const rows = board;
  const prevByName = new Map(boardPrev.map(r => [r.name, r]));
  if (!rows.length) {
    return (
      <div className="rv-rail-sec">
        <div className="rv-eyebrow">Leaderboard · {label}<Info k="lb" /></div>
        <p className="rv-dim">No activity yet.</p>
      </div>
    );
  }
  return (
    <div className="rv-rail-sec rv-rail-lb-wrap">
      <div className="rv-eyebrow">Leaderboard · {label}<Info k="lb" /></div>
      <div className="rv-rail-lb">
        {rows.map(r => {
          const prev = prevByName.get(r.name);
          return (
            <div className={`rv-rail-lb-row${r.name === sales ? " me" : ""}`} key={r.name}>
              <span className="rv-mono">{r.rank}</span>
              <span className="rv-rail-lb-name">
                {r.name}
                {r.name === sales ? " (you)" : ""}
              </span>
              <em className={r.pct < 0 ? "bad" : "good"}>{SP(r.pct)}</em>
              {prev ? (
                <i className={prev.rank >= r.rank ? "up" : prev.rank === r.rank ? "" : "down"}>
                  {prev.rank === r.rank ? "→" : prev.rank > r.rank ? "↑" : "↓"}
                </i>
              ) : (
                <i />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Pace = {
  soFar: number;
  elapsedDays: number;
  heading: number;
  /** Full-period goal over goal so far (weekday-shaped): the one projection factor for every dial. */
  ratio?: number;
  /** Goal for the whole window for the New Business dial (the rep's share of the new-business goal). */
  newPlan?: number;
  existingPlan?: number;
  /** Each part of the heading is projected with its own factor (existing: weekday shape; new business: last year's monthly shape). */
  existingHeading?: number;
  newHeading?: number;
  plan: number;
  needPerDay: number;
  remainingDays: number;
  firstDay: string | null;
  lastDay: string | null;
};
// Gauge geometry (Shyam, 2026-09-29) — replaces the vertical thermometer with
// a semicircular dial: two needles (solid = so far, dotted = heading to) and
// the plan value anchored at the dial's right end, per Shyam's spec. The
// scale is zoomed to just below the lowest of the three values so the gap
// between the needles and the plan end reads clearly, with tick labels at a
// "nice" round step (not 0-to-plan, which bunched the needles together when
// pace is close to 100%).
const CX = 111;
const CY = 112;
const RADIUS = 74;
const polar = (angleDeg: number, r: number) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
};
// Round a raw step down to a "nice" 1/2/2.5/5 * 10^n increment so tick labels
// land on clean numbers regardless of magnitude (works for $500 Today windows
// through $500K quarter windows alike).
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function gaugeScale(plan: number, soFar: number, heading: number) {
  const lowest = Math.min(plan, soFar, heading);
  const highest = Math.max(plan, soFar, heading);
  // Minimum visible spread so the dial never collapses to a sliver when the
  // three values are nearly identical (e.g. a "Today" window).
  const spreadFloor = Math.max(highest * 0.08, 1);
  const spread = Math.max(highest - lowest, spreadFloor);
  const rawMin = lowest - spread * 0.3;
  const step = niceStep(spread / 4);
  const vmin = Math.max(0, Math.floor(rawMin / step) * step);
  // Plan sits at the dial's end only while the rep is at/behind pace; when
  // heading/so-far run past plan, extend the end so the overrun still fits
  // on the dial instead of clipping off the edge.
  const vmax = Math.max(plan, highest * 1.02);
  const ticks: number[] = [];
  for (let v = vmin; v < vmax - step * 0.4; v += step) ticks.push(v);
  return { vmin, vmax, step, ticks };
}

/** Early-window guard (Shyam, 2026-09-30): with <2 days of data or $0 booked
 * so far, a pace projection is meaningless ($0 heading), so don't show one. */
function paceTooEarly(p: Pace) {
  return p.elapsedDays < 2 || p.soFar <= 0;
}

function Thermo({ pace, lastPace, winLabel }: { pace: Pace | null; lastPace: Pace | null; winLabel: string }) {
  const [mStyle, setMStyle] = useMeterStyle();
  if (!pace) return <div className="rv-rail-sec rv-dim">Loading {winLabel}…</div>;
  if (paceTooEarly(pace))
    return (
      <div className="rv-rail-sec">
        <div className="rv-eyebrow">{winLabel} vs goal<Info k="gauge" /></div>
        <p className="rv-thermo-headline">Waiting on {winLabel.toLowerCase()}'s data.</p>
        <p className="rv-dim rv-small">
          Only {pace.elapsedDays} day(s) in so far (data to {fmtD(pace.lastDay)}), too early to project.
          {lastPace && lastPace.plan ? ` Last window finished at ${P(lastPace.heading / lastPace.plan, 1)} of goal.` : ""}
        </p>
        <div className="rv-thermo-row">
          <i className="sw plan" />
          <span>Goal</span>
          <b>{K(pace.plan)}</b>
        </div>
      </div>
    );
  const { vmin, vmax, ticks } = gaugeScale(pace.plan, pace.soFar, pace.heading);
  const range = vmax - vmin || 1;
  const angleFor = (v: number) => 180 - ((v - vmin) / range) * 180;
  const needleLen = RADIUS - 6;
  const short = pace.plan - pace.heading;
  const planAngle = angleFor(pace.plan);
  const planPt = polar(planAngle, RADIUS);
  const soFarTip = polar(angleFor(pace.soFar), needleLen);
  const headingTip = polar(angleFor(pace.heading), needleLen);
  const trackStart = polar(180, RADIUS);
  const trackEnd = polar(0, RADIUS);
  return (
    <div className="rv-rail-sec">
      <div className="rv-eyebrow rv-eyebrow-row">{winLabel} vs goal<Info k="gauge" /><MeterToggle v={mStyle} set={setMStyle} /></div>
      {mStyle === "bar" ? (
        <div style={{ margin: "10px 0 6px" }}><MiniMeter soFar={pace.soFar} heading={pace.heading} plan={pace.plan} style="bar" big /></div>
      ) : (<>
      <div className="rv-gauge-cap">
        Scale zoomed to {KT(vmin)}–{KT(vmax)} so the gap to goal reads clearly.
      </div>
      <svg className="rv-gauge" viewBox="0 0 224 132" width="224" height="132">
        <path
          d={`M ${trackStart.x.toFixed(1)} ${trackStart.y.toFixed(1)} A ${RADIUS} ${RADIUS} 0 0 1 ${trackEnd.x.toFixed(1)} ${trackEnd.y.toFixed(1)}`}
          className="rv-gauge-track"
        />
        {ticks.map((t) => {
          const a = angleFor(t);
          const inner = polar(a, RADIUS - 6);
          const outer = polar(a, RADIUS + 4);
          const lbl = polar(a, RADIUS + 12);
          return (
            <g key={t}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="rv-gauge-tick" />
              <text x={lbl.x} y={lbl.y} className="rv-gauge-ticklabel" textAnchor="middle">
                {KT(t)}
              </text>
            </g>
          );
        })}
        <circle cx={planPt.x} cy={planPt.y} r={6} className="rv-gauge-plandot" />
        <line
          x1={CX}
          y1={CY}
          x2={headingTip.x}
          y2={headingTip.y}
          className="rv-gauge-needle rv-gauge-needle-heading"
        />
        <line x1={CX} y1={CY} x2={soFarTip.x} y2={soFarTip.y} className="rv-gauge-needle rv-gauge-needle-sofar" />
        <circle cx={CX} cy={CY} r={5} className="rv-gauge-hub" />
      </svg>
      </>)}
      {lastPace && lastPace.plan ? (
        <p className="rv-dim rv-small" style={{ marginTop: 0 }}>
          Prior window finished at {P(lastPace.heading / lastPace.plan, 1)}.
        </p>
      ) : null}
      {/* Fixed legend instead of value-tracking labels — those overlapped
       * whenever plan/heading/so-far sat close together (Shyam, 2026-09-28
       * round 3). Numbers made larger so they "pop" as requested. */}
      <div className="rv-thermo-legend">
        <div className="rv-thermo-row">
          <i className="sw plan" />
          <span>Goal</span>
          <b>{K(pace.plan)}</b>
        </div>
        <div className="rv-thermo-row">
          <i className="sw heading" />
          <span>Heading to</span>
          <b>{K(pace.heading)}</b>
        </div>
        <div className="rv-thermo-row">
          <i className="sw sofar" />
          <span>So far</span>
          <b>{K(pace.soFar)}</b>
        </div>
      </div>
      <div className="rv-pct">{P(pace.plan ? pace.heading / pace.plan : 0, 1)}</div>
      <p className="rv-thermo-headline">
        {short > 0 ? (
          <>
            Heading <b className="bad">{K(short)}</b> short of {K(pace.plan)}.
          </>
        ) : (
          <>
            Heading <b className="good">{K(-short)}</b> over {K(pace.plan)}.
          </>
        )}
      </p>
      <p>
        {K(pace.soFar)} booked {fmtD(pace.firstDay)}–{fmtD(pace.lastDay)}
        {pace.remainingDays > 0 ? (
          <>
            ; <b>{K(pace.needPerDay)}</b>/day needed for the {pace.remainingDays} day(s) left.
          </>
        ) : (
          "."
        )}
      </p>
      <p className="rv-dim rv-small">
        Goal = the yearly target spread over the year by baseline weekday weights, projected over the whole window.
      </p>
    </div>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: shape comes from convex/repView.ts
type Book = any;
// biome-ignore lint/suspicious/noExplicitAny: wins payload
type Wins = any;

function TodayTab({
  b,
  wins,
  health,
  onHealth,
  pstatus,
  onPstatus,
  stuckWin,
  onStuckWin,
  onOpenClinic,
  onScorecard,
  isRep,
  agenda,
  sales,
  listPeriod,
}: {
  sales: string;
  listPeriod: string;
  agenda?: React.ReactNode;
  isRep: boolean;
  b: Book;
  wins: Wins;
  health: string;
  onHealth: (h: string) => void;
  pstatus: string;
  onPstatus: (p: string) => void;
  stuckWin: { min: number; max: number };
  onStuckWin: (w: { min: number; max: number }) => void;
  onOpenClinic: (clinic: string) => void;
  onScorecard: () => void;
}) {
  const first = b.callFirst[0];
  const f = b.funnel;
  const [fl, setFl] = useState<{ label: string; ids: string[] } | null>(null);
  const flQ = useRcaQuery(api.repView.rowsByFocus, fl && fl.ids.length ? { password: pw(), periodId: listPeriod, sales, focus: `ids:${fl.ids.join(",")}` } : "skip");
  void wins;
  // Getting-to-order-4 window: only clinics stuckMin–stuckMax days since
  // their last order are "about to fall off", ranked order 4 → order 1
  // (Shyam, 2026-09-28; window widened + made adjustable in round 3).
  const ORDER_LABEL: Record<number, string> = { 3: "order 4", 2: "order 3", 1: "order 2" };
  const STUCK_PRESETS: Array<{ min: number; max: number }> = [
    { min: 10, max: 14 },
    { min: 14, max: 21 },
    { min: 21, max: 30 },
    { min: 30, max: 45 },
  ];
  return (
    <>
      <div className="rv-sec-head" style={{ marginTop: 0 }}>
        <div className="rv-eyebrow">Today's agenda<Info k="headline" /></div>
        <button type="button" className="rv-sc-btn" onClick={onScorecard}>
          Scorecard for this week ↓
        </button>
      </div>
      <h1 className="rv-h1">
        {b.overdueCount
          ? `${b.overdueCount} clinic${b.overdueCount === 1 ? " is" : "s are"} past their usual reorder.${first ? ` Start with ${first.name}.` : ""}`
          : "Every regular clinic is ordering on its usual rhythm."}
      </h1>
      {agenda}
      <div className="rv-sec-head">
        <h2>Call first<Info k="call" /></h2>
        <span>{b.callFirst.length} shown · biggest goal first, then longest overdue · 5+ days since last order, not churned</span>
      </div>
      <HowCalc>
        <p>Who is on it: existing clinics (not new, with a baseline) that last ordered at least 5 days ago and have not churned by their own threshold: 45 days, or three times their usual gap between orders for a slow buyer.</p>
        <p>Order: the clinic's goal for the window, biggest first, then the longest overdue. The plan's "Overdue reorder calls" uses the dollars each clinic is short of that goal instead. The chips narrow the list by health note or portfolio status.</p>
      </HowCalc>
      <div className="rv-chips">
        <button type="button" className={health === "" ? "is-on" : ""} onClick={() => onHealth("")}>
          All notes
        </button>
        {(b.healthTags ?? []).map((h: string) => (
          <button key={h} type="button" className={health === h ? "is-on" : ""} onClick={() => onHealth(h)}>
            {h} ({(b.healthCounts ?? []).find((x: [string, number]) => x[0] === h)?.[1] ?? 0} clinics)
          </button>
        ))}
      </div>
      {(b.pstatusTags ?? []).length ? (
        <div className="rv-chips">
          <button type="button" className={pstatus === "" ? "is-on" : ""} onClick={() => onPstatus("")}>
            All portfolio status
          </button>
          {(b.pstatusTags ?? []).map((p: string) => (
            <button key={p} type="button" className={pstatus === p ? "is-on" : ""} onClick={() => onPstatus(p)}>
              {p} ({(b.pstatusCounts ?? []).find((x: [string, number]) => x[0] === p)?.[1] ?? 0} clinics)
            </button>
          ))}
        </div>
      ) : null}
      <div className="rv-cards">
        {b.callFirst.map((c: Book, i: number) => (
          <button type="button" className="rv-card rv-card-click" key={c.clinic} onClick={() => onOpenClinic(c.clinic)}>
            <div className="rv-card-top">
              <span className="rv-tag">{c.tag}</span>
              <span className="rv-dim">#{i + 1}</span>
            </div>
            <div className="rv-card-name">{c.name}</div>
            <div className="rv-card-sub">
              {c.state} · usually every {c.every ?? "—"}d
            </div>
            <div className="rv-card-nums">
              <div>
                <b className="bad">{c.daysSinceLast}d</b>
                <span>since last order</span>
              </div>
              <div>
                <b className={c.daysSinceTouch !== null && c.daysSinceTouch > 14 ? "bad" : ""}>
                  {c.daysSinceTouch === null ? "—" : `${c.daysSinceTouch}d`}
                </b>
                <span>{c.daysSinceTouch === null ? "no touch on record" : "since last touch"}</span>
              </div>
            </div>
            <div className="rv-card-foot">
              <span className={c.delta < 0 ? "bad" : "good"}>{SK(c.delta)}</span> vs goal this period ·{" "}
              {K(c.expected)} expected
            </div>
          </button>
        ))}
        {b.callFirst.length === 0 ? (
          <p className="rv-dim">
            No overdue regulars{health ? ` tagged "${health}"` : ""}
            {pstatus ? ` in "${pstatus}"` : ""}.
          </p>
        ) : null}
      </div>

      <div className="rv-panel">
        <div className="rv-sec-head">
          <h2>New clinics: getting to order 4<Info k="newc" /></h2>
          <span>{f.o1} new clinics in your book</span>
        </div>
        <HowCalc>
          <p>New clinics are those whose first order was this calendar year. Each box counts new clinics that reached that order number; a clinic with three orders is counted in orders 1, 2 and 3.</p>
          <p>"About to fall off" lists clinics whose gap since their last order sits inside the days-between-orders filter (14 to 21 days by default), highest order number first: they are due for the next order but have not placed it.</p>
        </HowCalc>
        <div className="rv-funnel">
          {[
            [f.o1, "Placed order 1"],
            [f.o2, "Placed order 2"],
            [f.o3, "Placed order 3"],
            [f.o4, "Placed order 4"],
          ].map(([n, l], i) => {
            const ids: string[][] = f.ids ?? [[], [], [], []];
            const reached = ids[i] ?? [];
            return (
              <div key={l as string} className={`rv-step s${i} rv-step-click`} role="button" tabIndex={0}
                onClick={() => setFl({ label: `${l} · ${reached.length} clinics`, ids: reached })}
                onKeyDown={e => e.key === "Enter" && setFl({ label: `${l} · ${reached.length} clinics`, ids: reached })}>
                <b>{n}</b>
                <span>{l}</span>
                {i > 0 && f.o1 ? <em>{P((n as number) / f.o1)} of order 1</em> : null}

              </div>
            );
          })}
        </div>
        {fl ? (
          <div id="nc-fl">
            <FocusTable label={fl.label} rows={flQ?.ready ? flQ.rows : null} onClose={() => setFl(null)} periodId={listPeriod} sales={sales} />
          </div>
        ) : null}
        <div className="rv-sec-head">
          <div className="rv-dim rv-small">
            Due for their next order in the next {stuckWin.min}–{stuckWin.max} days, order 4 first:
          </div>
          <div className="rv-chips rv-chips-tight">
            {STUCK_PRESETS.map(w => (
              <button
                type="button"
                key={`${w.min}-${w.max}`}
                className={stuckWin.min === w.min && stuckWin.max === w.max ? "is-on" : ""}
                onClick={() => onStuckWin(w)}
              >
                {w.min}–{w.max}d
              </button>
            ))}
          </div>
        </div>
        {b.stuck.map((s: Book) => (
          <button type="button" className="rv-row rv-row-click" key={s.clinic} onClick={() => onOpenClinic(s.clinic)}>
            <b>{s.name}</b>
            <span className="rv-mono">next up: {ORDER_LABEL[s.reached] ?? `order ${s.reached + 1}`}</span>
            <span>
              Last order {s.daysSinceLast ?? "—"}d ago · first order {s.daysSinceFirst ?? "—"}d ago
            </span>
            <span className={s.daysSinceTouch === null || s.daysSinceTouch > 14 ? "bad" : ""}>
              {s.daysSinceTouch === null ? "no touch on record" : `touch ${s.daysSinceTouch}d ago`}
            </span>
          </button>
        ))}
        {b.stuck.length === 0 ? (
          <p className="rv-dim">No new clinics due in the next {stuckWin.min}–{stuckWin.max} days.</p>
        ) : null}
      </div>

      {/* Business feed replaces "Say thanks" (Shyam 2026-09-30). The feed is
          company-wide, so rep logins don't get it until a rep-scoped version exists. */}
      {isRep ? null : <AlertRail onFocus={() => undefined} />}
    </>
  );

}

function Bar({ v, max }: { v: number; max: number }) {
  const w = max ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  return (
    <div className="rv-bar">
      <i className={v < 0 ? "neg" : "pos"} style={v < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
    </div>
  );
}

/** The full Scorecard (dials, matrix, KPI cards, clinic lists) for one window, embedded in that window's tab. */
function ScorecardInWindow({ b, sales, periodId, periodLabel, prev, focus }: { b: Book; sales: string; periodId: string; periodLabel: string; prev?: { id: string; label: string }; focus?: string | null }) {
  // Shown by default; the choice is remembered in this browser and shared by every window tab.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("rv-scorecard-open") !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen(v => {
      try {
        localStorage.setItem("rv-scorecard-open", v ? "0" : "1");
      } catch {
        /* private window: the choice just lasts for this page */
      }
      return !v;
    });
  return (
    <section className="rv-sc-embed">
      <div className="rv-sc-embed-bar">
        <div className="rv-eyebrow">{open ? "" : `Scorecard hidden · ${periodLabel}`}</div>
        <button type="button" className="rv-sc-btn" onClick={toggle} aria-expanded={open}>
          {open ? "Hide scorecard ▲" : "Show scorecard ▼"}
        </button>
      </div>
      {open || focus ? <ScorecardWithFams b={b} sales={sales} periodId={periodId} periodLabel={periodLabel} prev={prev} focus={focus} /> : null}
    </section>
  );
}

/** Loads the product families for the window (only while the scorecard is shown), then renders the scorecard. */
function ScorecardWithFams({ b, sales, periodId, periodLabel, prev, focus }: { b: Book; sales: string; periodId: string; periodLabel: string; prev?: { id: string; label: string }; focus?: string | null }) {
  const fams = useRcaQuery(api.leadFamilies.salesFamilies, sales ? { password: pw(), periodId, sales } : "skip");
  return <ScorecardTab key={`${periodId}|${focus ?? ""}`} b={b} fams={fams} periodLabel={periodLabel} focus={focus} sales={sales} periodId={periodId} prevId={prev?.id} prevLabel={prev?.label} />;
}

function WindowTab({
  b,
  sales,
  periodId,
  wins,
  periodLabel,
  showFunnel,
  planBeat,
  prev,
  scFocus,
}: {
  b: Book;
  sales: string;
  periodId: string;
  wins: Wins;
  periodLabel: string;
  showFunnel: boolean;
  planBeat: { label: string; amount: number; pct: number } | null;
  prev?: { id: string; label: string };
  /** A scorecard cell to highlight (from "See in scorecard"). */
  scFocus?: string | null;
}) {
  const [simplify, setSimplify] = useState(true);
  // Exact view: product families under branches A and B, like the main tree.
  const treeFams = useRcaQuery(
    api.leadFamilies.salesFamilies,
    sales && !simplify ? { password: pw(), periodId, sales } : "skip",
  );
  const [famScope, setFamScope] = useState<"bundle" | "nonbundle">("nonbundle");
  const [famOpen, setFamOpen] = useState<{ family: string; scope: "all" | "bundle" | "nonbundle" } | null>(null);
  const [famLimit, setFamLimit] = useState(25);
  const [focus, setFocus] = useState<{ focus: string; label: string } | null>(null);
  const focusRowsQ = useRcaQuery(
    api.repView.rowsByFocus,
    sales && focus ? { password: pw(), periodId, sales, focus: focus.focus } : "skip",
  );
  const L = b.lenses;
  const cohorts = [...L.cohorts].sort((x: Book, y: Book) => x.delta - y.delta);
  const worst = cohorts[0];
  // Same share-of-gap phrasing as the main dashboard's tree (Shyam,
  // 2026-09-28 exact-parity pass).
  const pct = (v: number) => {
    if (b.totals.delta === 0) return "—";
    const share = Math.round((Math.abs(v) / Math.abs(b.totals.delta)) * 100);
    const sameDirection = v < 0 === b.totals.delta < 0;
    const noun = b.totals.delta < 0 ? "gap" : "gain";
    return sameDirection ? `${share}% of ${noun}` : `${share}% offset`;
  };
  // Lifecycle view of the cohort card: retained top 20% + the rest are one stage, Active, cut by size.
  const lifecycleRows: Array<{ l: string; v: number; real?: number; amb?: number; focus: string; sub: string; cohortSplit?: Book; tiers?: Array<{ l: string; v: number; real?: number; amb?: number; focus: string; sub: string }> }> = (() => {
    const one = (c: Book) => ({ l: `${COHORT[c.key] ?? c.key} (${c.clinics})`, v: c.delta, real: c.real as number | undefined, amb: c.ambition as number | undefined, focus: `cohort:${c.key}`, sub: "clinic cohort", cohortSplit: c });
    const top = cohorts.find((c: Book) => c.key === "retained_top20");
    const rest = cohorts.find((c: Book) => c.key === "retained_rest");
    if (!top || !rest) return cohorts.map(one);
    // Active has three tiers (2026-10-18): New (this year's clinics still ordering), the largest 20% and everyone else.
    const newC = cohorts.find((c: Book) => c.key === "new");
    const parts = [newC, top, rest].filter(Boolean) as Book[];
    const tot = (f: (c: Book) => number) => parts.reduce((t, c) => t + f(c), 0);
    const merged: Book = {
      key: "active", clinics: tot(c => c.clinics), delta: tot(c => c.delta),
      posSum: tot(c => c.posSum), posCount: tot(c => c.posCount), posIds: parts.flatMap(c => c.posIds),
      negSum: tot(c => c.negSum), negCount: tot(c => c.negCount), negIds: parts.flatMap(c => c.negIds),
    };
    const tier = (c: Book, name: string, sub: string) => ({ l: `${name} (${c.clinics})`, v: c.delta, real: c.real as number | undefined, amb: c.ambition as number | undefined, focus: `cohort:${c.key}`, sub });
    const tiers = [
      ...(newC ? [tier(newC, "New", "this year's clinics still ordering")] : []),
      tier(top, "Largest 20%", "size tier of Active"),
      tier(rest, "Everyone else", "size tier of Active"),
    ];
    const active = { l: `Active (${merged.clinics})`, v: merged.delta, real: tot(c => (c.real as number) ?? 0), amb: tot(c => (c.ambition as number) ?? 0), focus: "cohort:active", sub: "still ordering: new this year, or ordered in the baseline", cohortSplit: merged, tiers };
    return [...cohorts.filter((c: Book) => c.key !== "retained_top20" && c.key !== "retained_rest" && c.key !== "new").map(one), active].sort((a, b) => a.v - b.v);
  })();
  const lensCardsBase: Array<{
    k: string;
    t: string;
    q: string;
    rows: Array<{ l: string; v: number; real?: number; amb?: number; focus: string; sub: string; cohortSplit?: Book; tiers?: Array<{ l: string; v: number; real?: number; amb?: number; focus: string; sub: string }> }>;
    note: string;
  }> = [
    {
      k: "A",
      t: "Volume vs price",
      q: "Fewer orders, or lower $ per order?",
      rows: [
        {
          l: "Order volume",
          v: L.volume,
          focus: L.volume < 0 ? "volneg" : "volpos",
          sub: `${Math.round(b.totals.orders - b.totals.expOrders)} orders vs run rate`,
        },
        {
          l: "AOV / price-mix",
          v: L.aovEffect,
          focus: L.aovEffect < 0 ? "aovneg" : "aovpos",
          sub: `$${Math.round(b.kpi.aov ?? 0)} vs $${Math.round(b.kpi.baseAov ?? 0)} baseline`,
        },
      ],
      note: `Orders ${b.totals.orders.toFixed(0)} vs ${b.totals.expOrders.toFixed(0)} expected.`,
    },
    {
      k: "B",
      t: "Product",
      q: "Bundles or single panels?",
      rows: [
        { l: "Bundle orders", v: L.bundle, focus: L.bundle < 0 ? "bundleneg" : "bundlepos", sub: `${b.clinics} clinics in scope` },
        { l: "Non-bundle orders", v: L.nonBundle, focus: L.nonBundle < 0 ? "nonbundleneg" : "nonbundlepos", sub: `${b.clinics} clinics in scope` },
      ],
      note: Math.abs(L.bundle) > Math.abs(L.nonBundle) ? "Bundles are the larger share." : "Non-bundle is the larger share.",
    },
    {
      k: "C",
      t: "Clinic cohort",
      q: "Which clinics?",
      rows: lifecycleRows,
      note: `${worst ? `${COHORT[worst.key] ?? worst.key} is the biggest swing. ` : ""}${Math.abs((L.cohortCalibration ?? 1) - 1) > 0.002 ? `Cohort rows are calibrated to the book baseline (expected ×${(L.cohortCalibration as number).toFixed(3)}) so they add up to the total; clinic lists use each clinic's own baseline.` : ""}`,
    },
    {
      k: "D",
      t: "Geography",
      q: "Where?",
      rows: L.states.map((s: Book) => ({ l: s.key, v: s.delta, focus: `state:${s.key}`, sub: "geography" })),
      note: "Allocated by each clinic's main state.",
    },
  ];
  // The rows split the existing-business goal; the new-business goal (a slice of the target for this year's new clinics) is
  // one more line in every card, so each card adds up to the shortfall against the whole goal (2026-10-18).
  const newGoalLine = b.totals.newGoal ?? 0;
  const goalRow: (typeof lensCardsBase)[number]["rows"][number] = { l: "New business goal", v: -newGoalLine, real: 0, amb: newGoalLine, focus: "newgoal", sub: "slice of the target for this year's new clinics" };
  const lensCards = newGoalLine ? lensCardsBase.map(c => ({ ...c, rows: [...c.rows, goalRow] })) : lensCardsBase;
  const max = Math.max(1, ...lensCards.flatMap(c => c.rows.map(r => Math.abs(r.v))));
  const e = b.effort;
  // Touched in the last N days, N = the Touch effort "Order within" choice (14 when it is "any time").
  const [touchSel] = useTouchDays();
  const touchN = touchSel || 14;
  const te = e.byDays?.[touchN] ?? { touched: e.touched, touchedRe: e.touchedRe };
  const touchedPct = te.touched ? te.touchedRe / te.touched : 0;
  const openFocus = (f: string, label: string) =>
    setFocus(cur => (cur && cur.focus === f && cur.label === label ? null : { focus: f, label }));
  return (
    <>
      <div className="rv-sec-head" style={{ marginTop: 0 }}>
        <div className="rv-eyebrow">{periodLabel}<Info k="headline" /></div>
      </div>
      <h1 className="rv-h1">
        Your book is {SK(b.totals.delta)} vs goal
        {worst && worst.delta < 0 ? `, and the biggest drag is ${COHORT[worst.key]?.toLowerCase() ?? worst.key} clinics.` : "."}
      </h1>

      <div className="rv-effort-banner rv-great-job">
        <div>
          <div className="rv-eyebrow rv-great-job-eyebrow">🎉 Great job<Info k="great" /></div>
          <div className="rv-effort-h">
            {te.touched
              ? `${P(touchedPct, 0)} of clinics you touched in the last ${touchN} days reordered since.`
              : `No touches logged in the last ${touchN} days yet.`}
          </div>
        </div>
        <div className="rv-mini">
          {planBeat ? (
            <div className="rv-mini-item">
              <b>+{K(planBeat.amount)}</b>
              <span>{planBeat.label}<br />over goal ({P(planBeat.pct, 0)})</span>
            </div>
          ) : null}
          <button
            type="button"
            className="rv-mini-item"
            disabled={!wins?.ready || !wins.beatersIds.length}
            onClick={() => wins?.ready && openFocus(`ids:${wins.beatersIds.join(",")}`, "Beating goal")}
          >
            <b>{wins?.ready ? wins.beatersCount : "—"}</b>
            <span>Beating goal<br />{wins?.ready ? SK(wins.beatersRevenue) : ""} combined</span>
          </button>
          <button
            type="button"
            className="rv-mini-item"
            disabled={!wins?.ready || !wins.comebackIds.length}
            onClick={() => wins?.ready && openFocus(`ids:${wins.comebackIds.join(",")}`, "Comebacks")}
          >
            <b>{wins?.ready ? wins.comeback.length : "—"}</b>
            <span>Comebacks<br />below last period, above now</span>
          </button>
          <button
            type="button"
            className="rv-mini-item"
            disabled={!wins?.ready || !wins.newLogoIds.length}
            onClick={() => wins?.ready && openFocus(`ids:${wins.newLogoIds.join(",")}`, "New-logo wins")}
          >
            <b>{wins?.ready ? wins.newLogoCount : "—"}</b>
            <span>New-logo wins<br />{wins?.ready ? `${wins.newLogoNew} new · ${wins.newLogoReturning} returning, ordering` : "new and returning clinics"}</span>
          </button>
          <button
            type="button"
            className="rv-mini-item"
            disabled={!wins?.ready || !wins.bundleGainerIds.length}
            onClick={() => wins?.ready && openFocus(`ids:${wins.bundleGainerIds.join(",")}`, "Bundle gainers")}
          >
            <b>{wins?.ready ? wins.bundleGainerIds.length : "—"}</b>
            <span>Bundle gainers<br />bundle $ above goal</span>
          </button>
        </div>
      </div>

      <HowCalc title="How the Great job numbers are calculated">
        <p><b>Beating goal, Comebacks, Bundle gainers:</b> existing clinics only, each against its own goal (new and returning clinics have none; they sit under the new-business goal). Comebacks are clinics behind goal last week and at or above it now (week tab only). Bundle gainers have bundle dollars above their goal.</p>
        <p><b>New-logo wins:</b> this year's new clinics plus returning clinics that ordered in the window. <b>On pace to beat goal:</b> where the window is heading against its goal, existing plus new business.</p>
        <p><b>Touch line:</b> of existing, new and returning clinics you touched (call or meeting) in the last N days, the share that ordered on or after the touch. N follows the "Order within" choice in Touch effort (14 on any time).</p>
      </HowCalc>
      <ScorecardInWindow b={b} sales={sales} periodId={periodId} periodLabel={periodLabel} prev={prev} focus={scFocus} />

      <div className="rv-sec-head">
        <h2>Where the gap comes from<Info k="tree" /></h2>
        <div className="rv-tree-toggle">
          <span>click a branch for its clinic list</span>
          <button type="button" className="rv-toggle-btn" onClick={() => setSimplify(s => !s)}>
            {simplify ? "Switch to detailed view ↔" : "Switch to simple view ↔"}
          </button>
        </div>
      </div>
      <HowCalc>
        <p>The top number is actual minus goal for this window, split into change vs baseline (what really moved) and goal stretch (what the goal asks above baseline). Each card then cuts that same gap a different way, and every card adds up to the whole gap.</p>
        <p>Volume is orders against expected, at the book's usual order value; AOV is what remains (a higher or lower ticket). The "New business goal" line is the slice of the target for this year's new clinics. Cohort rows are scaled to add up to the book total, so a clinic list can differ from its row by a small amount.</p>
      </HowCalc>
      {simplify ? (
        <div className="rv-tree">
          <div className="rv-tree-root">
            <div className="rv-tree-side">
              <div className="rv-eyebrow rv-dim">Goal</div>
              <div className="rv-tree-side-v">{K(b.totals.expected)}</div>
              {b.totals.baseline !== undefined ? <div className="rv-eyebrow rv-dim" title="Mean run rate over the baseline window; the goal is the yearly target spread over the year by baseline weekday weights">Baseline {K(b.totals.baseline)}</div> : null}
            </div>
            <button type="button" className="rv-tree-node" onClick={() => openFocus("", "Whole book")}>
              <div className="rv-eyebrow rv-dim">{periodLabel}</div>
              <div className={`rv-tree-node-v ${b.totals.delta < 0 ? "bad" : "good"}`}>{SK(b.totals.delta)}</div>
              {b.totals.realChange !== undefined ? (
                <div className="rv-tree-split" title="Shortfall vs goal = change vs baseline (actual − baseline) plus the goal stretch (goal above baseline). Baseline is what these clinics normally do.">
                  <span className={b.totals.realChange < 0 ? "bad" : "good"}>Change vs baseline {SK(b.totals.realChange)}</span>
                  <span className={b.totals.ambition > 0 ? "bad" : "good"}>Goal stretch {SK(-b.totals.ambition)}</span>
                </div>
              ) : null}
              <div className="rv-eyebrow rv-blue">clinic list ↓</div>
            </button>
            <div className="rv-tree-side">
              <div className="rv-eyebrow rv-dim">Actual</div>
              <div className="rv-tree-side-v">{K(b.totals.actual)}</div>
            </div>
          </div>
          <div className="rv-lenses">
            {lensCards.map(c => (
              <div className="rv-lens" key={c.k}>
                <div className="rv-lens-h">
                  <em>{c.k}</em> {c.t}
                </div>
                {c.rows.map(r => (
                  <Fragment key={r.l}>
                    <button type="button" className="rv-lens-row rv-lens-row-click" onClick={() => (r.focus === "newgoal" ? undefined : openFocus(r.focus, r.l))}>
                      <div>
                        <span>{r.l}</span>
                        <b className={r.v < 0 ? "bad" : "good"}>{SK(r.v)}</b>
                      </div>
                      {r.real !== undefined && r.amb !== undefined ? (
                        <div className="rv-lens-real"><span className={r.real < 0 ? "bad" : "good"}>vs baseline {SK(r.real)}</span><span className={r.amb > 0 ? "bad" : "good"}>goal stretch {SK(-r.amb)}</span></div>
                      ) : null}
                      <Bar v={r.v} max={max} />
                    </button>
                    {r.tiers?.map(t => (
                      <button type="button" className="rv-lens-tier" key={t.l} onClick={() => openFocus(t.focus, `Active · ${t.l}`)}>
                        <span>{t.l}</span>
                        <b className={t.v < 0 ? "bad" : "good"}>{SK(t.v)}</b>
                      </button>
                    ))}
                  </Fragment>
                ))}
                <div className="rv-lens-note">{c.note}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rca-tree rv-rca-tree">
          <div className="rca-root-row">
            <div className="rca-root-side">
              <div className="rca-eyebrow rca-dim">Goal</div>
              <div className="rca-root-side-value">{K(b.totals.expected)}</div>
              <div className="rca-eyebrow rca-dim">{b.totals.expOrders.toFixed(0)} orders</div>
              {b.totals.baseline !== undefined ? (
                <div className="rca-eyebrow rca-dim" title="Mean run rate over the baseline window; the goal is the yearly target spread over the year by baseline weekday weights">Baseline {K(b.totals.baseline)}</div>
              ) : null}
            </div>
            <button type="button" className="rca-root-node" onClick={() => openFocus("", "Whole book")}>
              <div className="rca-eyebrow rca-dim">{periodLabel}</div>
              <div className="rca-root-value" style={{ color: b.totals.delta < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>
                {SK(b.totals.delta)}
              </div>
              <div className="rca-eyebrow rca-dim">
                {b.totals.expected ? Math.abs((b.totals.delta / b.totals.expected) * 100).toFixed(1) : "0"}%{" "}
                {b.totals.delta < 0 ? "below" : "above"} goal
              </div>
              {b.totals.realChange !== undefined ? (
                <div className="rca-root-split" title="Shortfall vs goal = change vs baseline (actual − baseline) plus the goal stretch (goal above baseline). Baseline is what these clinics normally do.">
                  <span style={{ color: b.totals.realChange < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>Change vs baseline {SK(b.totals.realChange)}</span>
                  <span style={{ color: b.totals.ambition > 0 ? "var(--vw-error)" : "var(--vw-success)" }}>Goal stretch {SK(-b.totals.ambition)}</span>
                </div>
              ) : null}
              <div className="rca-eyebrow rca-blue">{focus && focus.focus === "" ? "hide clinics" : "clinic detail ↓"}</div>
            </button>
            <div className="rca-root-side">
              <div className="rca-eyebrow rca-dim">Actual</div>
              <div className="rca-root-side-value">{K(b.totals.actual)}</div>
              <div className="rca-eyebrow rca-dim">{b.totals.orders.toFixed(0)} orders</div>
            </div>
          </div>
          <div className="rca-stem" />
          <div className="rca-crossbar" />
          <div className="rca-grid-4">
            {lensCards.map(c => (
              <div key={c.k}>
                <div className="rca-stem" />
                <div className="rca-card rca-lens">
                  <div className="rca-lens-head">
                    <span className="rca-lens-letter">{c.k}</span>
                    <div>
                      <div className="rca-lens-title">{c.t}</div>
                      <div className="rca-lens-q">{c.q}</div>
                    </div>
                  </div>
                  {c.rows.map(r => {
                    const w = (Math.abs(r.v) / max) * 50;
                    const neg = r.v < 0;
                    return (
                      <Fragment key={r.l}>
                      <button
                        type="button"
                        className={`rca-lens-row${focus && focus.focus === r.focus ? " is-open" : ""}`}
                        onClick={() => (r.focus === "newgoal" ? undefined : openFocus(r.focus, r.l))}
                      >
                        <div className="rca-lens-row-top">
                          <span>{r.l}</span>
                          <span className="rca-mono" style={{ color: neg ? "var(--vw-error)" : "var(--vw-success)" }}>
                            {SK(r.v)}
                          </span>
                        </div>
                        {r.real !== undefined && r.amb !== undefined ? (
                          <div className="rca-lens-real">
                            <span style={{ color: r.real < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>vs baseline {SK(r.real)}</span>
                            <span style={{ color: r.amb > 0 ? "var(--vw-error)" : "var(--vw-success)" }}>goal stretch {SK(-r.amb)}</span>
                          </div>
                        ) : null}
                        <div className="rca-lens-row-sub">
                          <span>{r.sub}</span>
                          <span>{pct(r.v)}</span>
                        </div>
                        <div className="rca-track">
                          <span className="rca-track-mid" />
                          <span
                            className="rca-track-fill"
                            style={{
                              left: neg ? `${50 - w}%` : "50%",
                              width: `${w}%`,
                              background: neg ? "var(--vw-error)" : "var(--vw-success)",
                            }}
                          />
                        </div>
                        {r.cohortSplit && r.cohortSplit.posCount > 0 && r.cohortSplit.negCount > 0 ? (
                          <div className="rca-lens-split">
                            <span className="rca-lens-split-pos">
                              +{SK(r.cohortSplit.posSum)} · {r.cohortSplit.posCount}{" "}
                              {r.focus === "cohort:new" ? "on pace" : "beating"}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              className="rca-info-icon"
                              title={
                                r.focus === "cohort:new"
                                  ? "New clinics ordering within this cohort's own median days-between-orders (no baseline history to compare to yet)"
                                  : "See the clinics beating goal in this cohort"
                              }
                              onClick={e => {
                                e.stopPropagation();
                                openFocus(
                                  `ids:${r.cohortSplit.posIds.join(",")}`,
                                  r.focus === "cohort:new" ? `${r.l} · on pace` : `${r.l} · beating goal`,
                                );
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  openFocus(
                                    `ids:${r.cohortSplit.posIds.join(",")}`,
                                    r.focus === "cohort:new" ? `${r.l} · on pace` : `${r.l} · beating goal`,
                                  );
                                }
                              }}
                            >
                              i
                            </span>
                            <span>vs</span>
                            <span className="rca-lens-split-neg">
                              {SK(-r.cohortSplit.negSum)} · {r.cohortSplit.negCount}{" "}
                              {r.focus === "cohort:new" ? "overdue" : "missing"}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              className="rca-info-icon"
                              title={
                                r.focus === "cohort:new"
                                  ? "New clinics past this cohort's own median days-between-orders — falling behind their own pace, not a baseline"
                                  : "See the clinics missing goal in this cohort"
                              }
                              onClick={e => {
                                e.stopPropagation();
                                openFocus(
                                  `ids:${r.cohortSplit.negIds.join(",")}`,
                                  r.focus === "cohort:new" ? `${r.l} · overdue` : `${r.l} · missing goal`,
                                );
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  openFocus(
                                    `ids:${r.cohortSplit.negIds.join(",")}`,
                                    r.focus === "cohort:new" ? `${r.l} · overdue` : `${r.l} · missing goal`,
                                  );
                                }
                              }}
                            >
                              i
                            </span>
                          </div>
                        ) : null}
                      </button>
                      {r.tiers ? (
                        <div className="rca-lens-tiers">
                          {r.tiers.map(t => (
                            <button type="button" key={t.l} className={`rca-lens-tier${focus && focus.focus === t.focus ? " is-open" : ""}`} onClick={() => openFocus(t.focus, `Active · ${t.l}`)}>
                              <span>{t.l}</span>
                              <span className="rca-mono" style={{ color: t.v < 0 ? "var(--vw-error)" : "var(--vw-success)" }}>{SK(t.v)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      </Fragment>
                    );
                  })}
                  {(c.k === "A" || c.k === "B") && treeFams?.ready ? (
                    <FamilyLevel
                      rows={c.k === "A" ? treeFams.all : famScope === "nonbundle" ? treeFams.nonbundle : treeFams.bundle}
                      scopeNote={c.k === "A" ? null : famScope}
                      onScope={c.k === "B" ? setFamScope : undefined}
                      by={c.k === "A" ? "orders" : "revenue"}
                      openFamily={famOpen?.family ?? null}
                      onPick={family => {
                        setFamLimit(25);
                        setFocus(null);
                        setFamOpen(cur =>
                          cur && cur.family === family ? null : { family, scope: c.k === "A" ? "all" : famScope },
                        );
                      }}
                    />
                  ) : (c.k === "A" || c.k === "B") && !treeFams ? (
                    <div className="rca-sub rv-dim">Loading product families…</div>
                  ) : null}
                  <div className="rca-lens-note">{c.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showFunnel && focus && focus.focus === "cohort:new" ? (
        <ProviderRetentionFunnel periodId={periodId} sales={sales} />
      ) : null}

      {famOpen && !simplify ? (
        <FamilyPanel
          sales={sales}
          periodId={periodId}
          periodLabel={periodLabel}
          family={famOpen.family}
          scope={famOpen.scope}
          limit={famLimit}
          onLimit={setFamLimit}
          onClose={() => setFamOpen(null)}
        />
      ) : null}

      {focus ? (
        <FocusTable
          label={focus.label}
          rows={focusRowsQ?.ready ? focusRowsQ.rows : null}
          onClose={() => setFocus(null)}
          periodId={periodId}
          sales={sales}
        />
      ) : null}


    </>
  );
}

/**
 * "Provider Retention Funnel — Orders 1→5" (Shyam, 2026-09-28): signup →
 * order 1 → 2 → 3 → 4 → 5, each bar showing how many of this window's new
 * clinics reached it, plus avg days since the previous stage and total /
 * median revenue at that stage. Shown under the shortfall tree's "New"
 * clinic-cohort row, only for This month / This quarter / a Custom window of
 * a month or more (a week of new clinics is too thin to read as a funnel).
 */
/** MoM/QoQ % chip for a funnel stage — null means no prior-period base to
 * compare against (Shyam, 2026-09-28: always calendar month/quarter before
 * the current one, independent of the window tab selected). */
function TrendPct({ value, label, title }: { value: number | null; label: string; title: string }) {
  if (value === null) return <span title={title}>{label} —</span>;
  const cls = value > 0 ? "good" : value < 0 ? "bad" : "";
  return (
    <span title={title} className={cls}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(0)}% {label}
    </span>
  );
}

function ProviderRetentionFunnel({ periodId, sales }: { periodId: string; sales: string }) {
  const [touchFilter, setTouchFilter] = useState<"" | "touched" | "untouched">("");
  const [clinicalFilter, setClinicalFilter] = useState<"" | "touched" | "untouched">("");
  const [fview, setFview] = useState<"funnel" | "sankey">("funnel");
  const [rl, setRl] = useState<{ label: string; ids: string[] } | null>(null);
  const [showLeads, setShowLeads] = useState(false);
  const rlQ = useRcaQuery(api.repView.rowsByFocus, rl && rl.ids.length ? { password: pw(), periodId, sales, focus: `ids:${rl.ids.join(",")}` } : "skip");
  const data = useRcaQuery(api.newClinicFunnel.orderRetentionFunnel, {
    password: pw(),
    periodId,
    sales,
    touchFilter: touchFilter || undefined,
    clinicalFilter: clinicalFilter || undefined,
  });
  if (!data) return <div className="rv-panel rv-loading">Loading funnel…</div>;
  if (!data.ready) return null;
  const STAGE_LABEL = ["Order 1", "Order 2", "Order 3", "Order 4", "Order 5"];
  const top = Math.max(data.signups, data.clinics, 1);
  const bars = [
    { label: "Signup", n: data.signups, pct: data.signups ? 100 : 0 },
    ...data.stages.map(s => ({
      label: STAGE_LABEL[s.n - 1],
      n: s.clinics,
      ids: s.ids,
      next: data.stages.find(x => x.n === s.n + 1)?.ids,
      pct: data.signups ? Math.round((s.clinics / data.signups) * 100) : 0,
      medianDays: s.medianDays,
      totalRevenue: s.totalRevenue,
      medianRevenue: s.medianRevenue,
      momPct: s.momPct,
      qoqPct: s.qoqPct,
    })),
  ];
  return (
    <div className="rv-panel rv-funnel-panel">
      <div className="rv-sec-head">
        <h2>Provider retention funnel · orders 1→5<Info k="funnel" /></h2>
        <span>{data.clinics} new clinics this window</span>
      </div>
      <HowCalc>
        <p>Each stage counts the new clinics that reached that order number, and a clinic stays counted in the earlier stages. Each is compared with the baseline period's own new clinics at the same daily pace, so it reads as up or down rather than a raw count. "Active" means reached order 3 and still ordering in the last 14 days of the window.</p>
      </HowCalc>
      <div className="rv-chips" role="group" aria-label="Filter by call/meeting before order 1">
        {(
          [
            ["", "All clinics"],
            ["touched", "Had a call/meeting first"],
            ["untouched", "No call/meeting first"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={touchFilter === v ? "is-on" : ""}
            onClick={() => setTouchFilter(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rv-chips" role="group" aria-label="Filter by clinical consult before order 1">
        {(
          [
            ["", "All clinics"],
            ["touched", "Had a clinical consult first"],
            ["untouched", "No clinical consult first"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={clinicalFilter === v ? "is-on" : ""}
            onClick={() => setClinicalFilter(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rv-chips" role="group" aria-label="Funnel or Sankey">
        {(["funnel", "sankey"] as const).map(v => (
          <button key={v} type="button" className={fview === v ? "is-on" : ""} onClick={() => setFview(v)}>{v === "funnel" ? "Funnel" : "Sankey (with touches)"}</button>
        ))}
      </div>
      {fview === "funnel" ? <div className="rv-retention-funnel">
        {bars.map((r, i) => (
          <div className="rv-rf-row" key={r.label}>
            <div className="rv-rf-label">
              <b>{r.label}</b>
              {"medianDays" in r && r.medianDays !== null && r.medianDays !== undefined ? (
                <span className="rv-dim rv-small">median {Math.round(r.medianDays)}d</span>
              ) : null}
            </div>
            <div className="rv-rf-bar-track rv-step-click" role="button" tabIndex={0} onClick={() => "ids" in r && r.ids && setRl({ label: `${r.label} · ${r.ids.length} clinics`, ids: r.ids })}>
              <div className="rv-rf-bar" style={{ width: `${Math.max(2, (r.n / top) * 100)}%` }}>
                <b>{r.n.toLocaleString()}</b>
              </div>
            </div>
            <div className="rv-rf-side">
              <span>{i === 0 ? "100%" : `${r.pct}%`}</span>
              {"totalRevenue" in r && r.totalRevenue !== undefined ? (
                <span className="rv-dim rv-small">
                  {K(r.totalRevenue)} · rev {r.medianRevenue !== undefined ? K(Math.round(r.medianRevenue)) : "—"} median
                </span>
              ) : null}
              {i === 0 && data.noOrderLeads?.length ? (
                <button type="button" className="rv-drop" onClick={() => { setRl(null); setShowLeads(true); }}>↘ {data.noOrderLeads.length} signed up, no order yet</button>
              ) : null}
              {"ids" in r && r.ids && r.next ? (() => { const nx = new Set(r.next); const dr = r.ids.filter(c => !nx.has(c)); const nn = Number(r.label.slice(6)) + 1; return (
                <button type="button" className="rv-drop" onClick={() => setRl({ label: `Placed order ${nn - 1} but not order ${nn} · ${dr.length} clinics`, ids: dr })}>↘ {dr.length} didn't place order {nn}</button>
              ); })() : null}
              {"momPct" in r ? (
                <span className="rv-dim rv-small">
                  <TrendPct value={r.momPct} label="MoM" title={`${data.trendPrevM} → ${data.trendCurM}`} />
                  {" · "}
                  <TrendPct value={r.qoqPct} label="QoQ" title={`${data.trendPrevQ} → ${data.trendCurQ}`} />
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div> : null}
      {fview === "sankey" && SHOW_SANKEY && data.stages.length >= 4 ? <NewClinicFlow signups={data.signups} leadCount={data.noOrderLeads?.length} onLeads={() => { setRl(null); setShowLeads(true); }} ids={data.stages.slice(0, 4).map(x => x.ids)} onList={(label, ids) => { setShowLeads(false); setRl({ label: `${label} · ${ids.length} clinics`, ids }); }} /> : null}
      {showLeads && !rl ? <LeadTable leads={data.noOrderLeads ?? []} onClose={() => setShowLeads(false)} /> : null}
      {rl ? <FocusTable label={rl.label} rows={rlQ?.ready ? rlQ.rows : null} onClose={() => setRl(null)} periodId={periodId} sales={sales} /> : null}
      <p className="rv-dim rv-small" style={{ marginTop: 12 }}>
        Signup = leads assigned to you in this window (Power BI). Order stages are cumulative new-clinic
        counts reaching that order, ranked order 1 → 5; each bar's % is of signups. The call/meeting filter
        checks for a Call or Meeting touchpoint logged before order 1; the clinical consult filter checks
        for a Clinical Activity touchpoint (consult/training) logged before order 1. MoM/QoQ are fixed and ignore the window
        selected above: new clinics whose order 1 fell in the current month / quarter to date vs the same
        number of days into the prior month / quarter (hover a chip for the exact dates).
      </p>
    </div>
  );
}

type Cell = { label: string; value: string; sub: string; tone: Tone; allProducts?: boolean; famScoped?: boolean; tenureTag?: string; ids?: string[]; n?: number | null; u?: "$" | "%" | "n"; flow?: boolean; better?: 1 | -1 | 0 };
const NA = (label: string, why: string): Cell => ({ label, value: "—", sub: why, tone: "na" });
/** Target levels by tenure cut (Shyam, 2026-10-18): older signups keep and reorder far more than this year's, so one bar
 * for everyone made the cells always red. Levels sit at today's top-quartile rep (good) and median rep (watch) on the
 * live book, rounded; revisit as the book matures. higher = better except churn (lower is better).
 * Order: [good, watch]. */
const TENURE_TARGETS: Record<"retention" | "repeat" | "churn", Record<"all" | "pre" | "mid" | "cur", [number, number]>> = {
  retention: { all: [0.76, 0.7], pre: [0.77, 0.73], mid: [0.65, 0.53], cur: [0.49, 0.4] },
  repeat: { all: [0.68, 0.62], pre: [0.76, 0.72], mid: [0.66, 0.55], cur: [0.54, 0.45] },
  churn: { all: [0.35, 0.42], pre: [0.19, 0.24], mid: [0.3, 0.35], cur: [0.67, 0.7] },
};
const levelTone = (v: number | null, [good, watch]: [number, number], lowerBetter = false): Tone =>
  v === null ? "na" : lowerBetter ? (v <= good ? "good" : v <= watch ? "watch" : "bad") : v >= good ? "good" : v >= watch ? "watch" : "bad";
const CHURN_DAYS = 45;
/** Retention and repeat ordering are lumpier on short windows (each clinic is capped at its average baseline, and few
 * clinics reorder inside a week), so the bar scales with the window: median rep result on a tab of this length relative
 * to the whole analysis window, measured on the live book 2026-10-18 (day 0.44 / 0.43, week 0.78 / 0.71, month 0.95 /
 * 0.92, 77+ days 1). Piecewise-linear in log(days). Churn is by last order date and does not depend on the tab. */
const WINDOW_SCALE: Record<"retention" | "repeat", Array<[number, number]>> = {
  retention: [[1, 0.44], [7, 0.775], [31, 0.949], [77, 1]],
  repeat: [[1, 0.431], [7, 0.707], [31, 0.917], [77, 1]],
};
const windowScale = (kind: "retention" | "repeat", days: number): number => {
  const a = WINDOW_SCALE[kind];
  if (days <= a[0][0]) return a[0][1];
  if (days >= a[a.length - 1][0]) return 1;
  for (let i = 1; i < a.length; i++) {
    if (days <= a[i][0]) {
      const [d0, v0] = a[i - 1], [d1, v1] = a[i];
      return v0 + ((Math.log(days) - Math.log(d0)) / (Math.log(d1) - Math.log(d0))) * (v1 - v0);
    }
  }
  return 1;
};
const scaledLevels = (kind: "retention" | "repeat", tenure: "all" | "pre" | "mid" | "cur", days: number): [number, number] => {
  const f = windowScale(kind, days), [g, w] = TENURE_TARGETS[kind][tenure];
  return [g * f, w * f];
};
const vsTone = (ratio: number | null, watch = 0.95): Tone =>
  ratio === null ? "na" : ratio >= 1 ? "good" : ratio >= watch ? "watch" : "bad";

type Fam = {
  family: string;
  revenue: number;
  orders: number;
  expected: number;
  expectedOrders: number;
  delta: number;
  orderDelta: number;
};

/** Family scope for the whole scorecard (Shyam, 2026-10-16): when a family card is picked, the pillars that
 * can be computed per family follow it. Retention and Expansion need each clinic's baseline *for that family*,
 * which the data does not hold yet, so they stay on all products and say so. */
const PRODUCT_GROWTH_CELLS = new Set(["Target Product Orders", "Product adoption", "Product whitespace", "Repeat product rate"]);
const ALL_PRODUCTS_CELLS = new Set([
  "Low-AOV customers", "Revenue Retention", "Repeat ordering", "At-risk customers", "Customer churn",
  "Expansion Revenue", "NRR", "Revenue opportunity", "Growth decomposition",
]);
type Launch = { firstOrder: string; daysLive: number };
function scopeRows(rows: Array<{ pillar: string; cells: Cell[] }>, b: Book, hz: Fam | undefined, family: string, clinics: PGClinic[] | null, launch?: Launch) {
  const newSet = new Set<string>([...(b.newIds ?? []), ...(b.reactivatedIds ?? [])]);
  const loading = (c: Cell): Cell => NA(c.label, "loading product mix…");
  const none = (c: Cell): Cell => NA(c.label, `no ${family} orders in this book`);
  return rows.map(r => ({
    ...r,
    cells: r.cells.map((c): Cell => {
      if (ALL_PRODUCTS_CELLS.has(c.label)) return { ...c, allProducts: true };
      if (launch && c.label === "Target Product Orders") return { ...c, famScoped: true, tone: "act", sub: `new product · launched ${launch.firstOrder} · ${launch.daysLive}d live` };
      if (PRODUCT_GROWTH_CELLS.has(c.label)) return { ...c, famScoped: true };
      switch (c.label) {
        case "New Revenue": {
          if (!clinics) return loading(c);
          const mine = clinics.filter(x => newSet.has(x.clinic) && (x.win[family] ?? 0) > 0);
          const rev = mine.reduce((t, x) => t + (x.rev?.[family] ?? 0), 0);
          return {
            famScoped: true, label: c.label, value: K(rev), tone: "act", ids: mine.map(x => x.clinic), n: rev, u: "$", flow: true, better: 1,
            sub: `${mine.length} new / reactivated clinics ordering ${family}${hz?.revenue ? ` · ${P(rev / hz.revenue)} of ${family} revenue` : ""}`,
          };
        }
        case "AOV": {
          if (!hz || !hz.orders) return none(c);
          const aov = hz.revenue / hz.orders;
          const base = hz.expectedOrders ? hz.expected / hz.expectedOrders : 0;
          if (launch) return { famScoped: true, label: c.label, value: K(aov), n: aov, u: "$", better: 1, ids: clinics?.filter(x => (x.win[family] ?? 0) > 0).map(x => x.clinic), sub: `${family} · new product, no baseline`, tone: "act" };
          return {
            famScoped: true, label: c.label, value: K(aov), n: aov, u: "$", better: 1, ids: clinics?.filter(x => (x.win[family] ?? 0) > 0).map(x => x.clinic),
            sub: `${family} · ${SK(aov - base)} vs goal`, tone: vsTone(aov && base ? aov / base : null, 0.97),
          };
        }
        case "Net Revenue Growth": {
          if (launch) return { ...NA(c.label, "new product · no baseline to compare"), famScoped: true };
          if (!hz || !hz.expected) return none(c);
          const g = hz.revenue / hz.expected - 1;
          return { famScoped: true, label: c.label, value: SP(g), n: g, u: "%", better: 1, sub: `${family} · ${SK(hz.revenue - hz.expected)} vs goal`, tone: vsTone(1 + g) };
        }
        case "Growth run-rate": {
          if (!hz || !b.days) return none(c);
          const rr = (hz.revenue / b.days) * 7;
          const plan = (hz.expected / b.days) * 7;
          if (launch) return { famScoped: true, label: c.label, value: `${K(rr)}/wk`, n: rr, u: "$", better: 1, sub: `${family} · new product, ${launch.daysLive}d live`, tone: "act" };
          return { famScoped: true, label: c.label, value: `${K(rr)}/wk`, n: rr, u: "$", better: 1, sub: `${family} · goal ${K(plan)}/wk`, tone: vsTone(rr && plan ? rr / plan : null) };
        }
        default:
          return c;
      }
    }),
  }));
}

function scoreRows(b: Book, fams: Wins, pg?: PGStats | null, scope?: { family: string; clinics: PGClinic[] | null; launch?: Launch }, tenure: TenureKey = "all"): Array<{ pillar: string; cells: Cell[] }> {
  const k = b.kpi;
  const hz: Fam | undefined = pg
    ? (fams?.all ?? []).find((f: Fam) => f.family === pg.family)
    : (fams?.all ?? []).find((f: Fam) => /hormone\s*zoomer/i.test(f.family));
  const rows: Array<{ pillar: string; cells: Cell[] }> = [
    {
      pillar: "New Business",
      cells: [
        {
          label: "New Revenue",
          value: K(k.newRevenue + (k.reactivatedRevenue ?? 0)),
          sub: k.newSplit
            ? `${k.newSplit.active.ordering + k.newSplit.reactivated.ordering + k.newSplit.churned.ordering + k.newSplit.returning.ordering} of ${k.newTotal + k.newSplit.returning.n} clinics ordered · new clinics ${K(k.newSplit.active.rev + k.newSplit.reactivated.rev + k.newSplit.churned.rev)} (active ${K(k.newSplit.active.rev)}, reactivated ${K(k.newSplit.reactivated.rev)}, churned ${K(k.newSplit.churned.rev)}) · older clinics back ${K(k.newSplit.returning.rev)} · ${P(b.totals.actual ? (k.newRevenue + (k.reactivatedRevenue ?? 0)) / b.totals.actual : null)} of revenue`
            : `${k.newCustomers} of ${k.newTotal ?? k.newCustomers} new + ${k.reactivatedCount ?? 0} of ${(b.reactivatedIds ?? []).length} reactivated clinics ordering · ${P(b.totals.actual ? (k.newRevenue + (k.reactivatedRevenue ?? 0)) / b.totals.actual : null)} of revenue`,
          ids: [...(b.newIds ?? []), ...(b.reactivatedIds ?? [])],
          n: k.newRevenue + (k.reactivatedRevenue ?? 0), u: "$", flow: true, better: 1,
          tone: "act",
        },
        NA("Pipeline", "needs CRM pipeline data"),
        NA("Unconverted prospects", "needs CRM lead data"),
        NA("Win rate", "needs CRM opportunity data"),
      ],
    },
    {
      pillar: "Bundle growth",
      cells: [
        {
          label: "AOV",
          value: k.aov ? K(k.aov) : "—",
          sub: `${SK((k.aov ?? 0) - k.baseAov)} vs baseline`,
          ids: b.activeIds, n: k.aov, u: "$", better: 1,
          tone: vsTone(k.aov && k.baseAov ? k.aov / k.baseAov : null, 0.97),
        },
        NA("Stack penetration", "needs per-order panel mix"),
        { label: "Low-AOV customers", value: String(k.lowAov), sub: "clinics under $400 AOV", tone: "act", ids: b.opp?.lowAov?.ids, n: k.lowAov, u: "n", better: -1 },
        NA("Stack mix", "needs per-order panel mix"),
      ],
    },
    {
      pillar: "Product Growth",
      cells: [
        hz
          ? {
              label: "Target Product Orders",
              value: hz.orders.toFixed(0),
              sub: `${hz.family} · ${hz.expectedOrders.toFixed(0)} expected`,
              ids: pg?.buyerIds, n: hz.orders, u: "n", flow: true, better: 1,
              tone: vsTone(hz.expectedOrders ? hz.orders / hz.expectedOrders : null),
            }
          : NA("Target Product Orders", `no ${pg?.family ?? "Hormone Zoomer"} orders in this book`),
        pg
          ? {
              label: "Product adoption",
              value: P(pg.adoption),
              sub: `${pg.adoptN + pg.addedIds.length} of ${pg.newN + pg.exN} clinics · new ${pg.adoptN}/${pg.newN} · existing added ${pg.addedIds.length}/${pg.exN}`,
              ids: [...pg.adoptIds, ...pg.addedIds], n: pg.adoption, u: "%", better: 1,
              tone: pg.adoption === null ? "na" : pg.adoption >= 0.5 ? "good" : pg.adoption >= 0.3 ? "watch" : "bad",
            }
          : NA("Product adoption", "loading product mix…"),
        pg
          ? {
              label: "Product whitespace",
              value: String(pg.wsN),
              sub: pg.eligN ? `${pg.wsN} of ${pg.eligN} clinics you marked eligible never ordered ${pg.family}` : `mark clinics eligible for ${pg.family} below`,
              tone: "act",
              ids: pg.wsIds,
            }
          : NA("Product whitespace", "loading product mix…"),
        pg
          ? {
              label: "Repeat product rate",
              value: P(pg.repeat),
              sub: `${pg.repN} of ${pg.pairN} ${pg.family} clinics ordered it 2+ times`,
              ids: pg.repIds, n: pg.repeat, u: "%", better: 1,
              tone: pg.repeat === null ? "na" : pg.repeat >= 0.5 ? "good" : pg.repeat >= 0.35 ? "watch" : "bad",
            }
          : NA("Repeat product rate", "loading product mix…"),
      ],
    },
    {
      pillar: "Retention",
      cells: [
        {
          label: "Revenue Retention",
          value: P(k.revenueRetention),
          sub: "existing clinics' baseline $ kept",
          ids: b.existingIds, n: k.revenueRetention, u: "%", better: 1,
          tone: levelTone(k.revenueRetention, scaledLevels("retention", tenure, b.days)),
        },
        {
          label: "Repeat ordering",
          value: P(k.repeatRate),
          sub: `${k.repeatCount} of ${k.activeCount} ordered 2+ times`,
          ids: k.repeatIds, n: k.repeatRate, u: "%", better: 1,
          tone: levelTone(k.repeatRate, scaledLevels("repeat", tenure, b.days)),
        },
        { label: "At-risk customers", value: String(k.atRisk), sub: `${K(k.atRiskRev)} below baseline`, tone: "act", ids: b.opp?.atRisk?.ids, n: k.atRisk, u: "n", better: -1 },
        {
          label: "Customer churn",
          value: P(k.churnRate, 1),
          sub: `${k.churned} of ${k.churnBase ?? k.existingCount} clinics · no order in ${CHURN_DAYS}+ days`,
          ids: k.churnedIds, n: k.churnRate, u: "%", better: -1,
          tone: levelTone(k.churnRate, TENURE_TARGETS.churn[tenure], true),
        },
      ],
    },
    {
      pillar: "Expansion",
      cells: [
        { label: "Expansion Revenue", value: SK(k.expansionRev), sub: `${k.growing} clinics growing`, tone: "good", ids: b.opp?.growing?.ids, n: k.expansionRev, u: "$", flow: true, better: 1 },
        pg
          ? { label: "Products per customer", value: pg.ppcRange, sub: `families per clinic (middle 50%) · ${pg.activeN} clinics`, ids: pg.activeIds, n: pg.ppc, u: "n", better: 1, tone: pg.ppc === null ? "na" : pg.ppc >= 2 ? "good" : pg.ppc >= 1.5 ? "watch" : "bad" }
          : NA("Products per customer", "loading product mix…"),
        pg
          ? { label: "Cross-sell candidates", value: String(pg.xs.length), sub: `${K(pg.xsUp)} upside · active clinics on 1–2 families`, tone: "act", ids: pg.xs.map(x => x.clinic) }
          : NA("Cross-sell candidates", "loading product mix…"),
        { label: "NRR", value: P(k.nrr), sub: "existing clinics vs baseline", tone: vsTone(k.nrr), ids: b.existingIds, n: k.nrr, u: "%", better: 1 },
      ],
    },
    {
      pillar: "Combined",
      cells: [
        {
          label: "Net Revenue Growth",
          value: SP(k.netGrowth ?? 0),
          sub: `${SK(b.totals.delta)} vs goal`,
          ids: b.allIds, n: k.netGrowth, u: "%", better: 1,
          tone: vsTone(k.netGrowth === null ? null : 1 + k.netGrowth),
        },
        {
          label: "Growth run-rate",
          value: k.runRate ? `${K(k.runRate)}/wk` : "—",
          sub: `goal ${K(k.runRatePlan ?? 0)}/wk`,
          ids: b.allIds, n: k.runRate, u: "$", better: 1,
          tone: vsTone(k.runRate && k.runRatePlan ? k.runRate / k.runRatePlan : null),
        },
        { label: "Revenue opportunity", value: K(k.opportunity), sub: "at-risk + low-AOV gap", tone: "act", ids: b.oppIds },
        {
          label: "Growth decomposition",
          value: `${SK(k.volume)} / ${SK(k.aovEffect)}`,
          sub: "volume / AOV",
          ids: b.allIds,
          tone: "act",
        },
      ],
    },
  ];
  return scope ? scopeRows(rows, b, hz, scope.family, scope.clinics, scope.launch) : rows;
}

/** Pillar status from the scorecard tones: any red cell = behind, any amber = watch. */
function pillarStatus(b: Book, fams: Wins): Record<string, "behind" | "watch" | "good"> {
  const out: Record<string, "behind" | "watch" | "good"> = {};
  for (const r of scoreRows(b, fams))
    out[r.pillar] = r.cells.some(c => c.tone === "bad") ? "behind" : r.cells.some(c => c.tone === "watch") ? "watch" : "good";
  return out;
}

/** Which clinics push a scorecard metric up or pull it down (Shyam, 2026-10-16). Each metric names the clinics it
 * is measured over, a signed per-clinic contribution, and how to say it. Metrics with no per-clinic sign yet
 * (the single-family ones: the data holds no per-clinic baseline for a family) just open the plain list. */
type ContribRow = { daysSinceLast: number | null; life?: string | null; clinic: string; actual: number; expected: number; baseline: number; realChange: number; delta: number; orders: number; aovEffect: number; volume: number };
type Contribution = {
  universe: (b: Book) => string[];
  f: (r: ContribRow) => number;
  unit: "$" | "clinics";
  up: string;
  down: string;
  note: string;
  /** $ shown on a tile when the sign is not itself a dollar figure (churn: baseline $ of the clinics that stopped). */
  amount?: (r: ContribRow) => number;
  /** A line under the clinic's name in the list (product lists: orders vs expected and the status). */
  detail?: (clinic: string) => string;
  /** Several ways to cut the same metric (growth decomposition: volume effect / AOV effect). `inScope` limits the clinics a cut counts. */
  variants?: Array<{ label: string; f: (r: ContribRow) => number; note: string; up: string; down: string; inScope?: (r: ContribRow) => boolean }>;
};
const VS_BASELINE: Contribution = {
  universe: b => b.allIds ?? [], f: r => r.delta, unit: "$", up: "Above their goal", down: "Below their goal",
  note: "Each clinic's revenue this window against its own goal. Clinic baselines are set per clinic, so these sums can differ from the book-level figure in the card (which uses the rep-level baseline).",
};
const EXISTING_VS_BASELINE: Contribution = { ...VS_BASELINE, f: r => r.realChange, up: "Above their baseline", down: "Below their baseline", universe: b => b.existingIds ?? [], note: "Clinics that ordered in the baseline: revenue this window against their own baseline (change vs baseline, before the goal's stretch)." };
const CONTRIB: Record<string, Contribution> = {
  "New Revenue": { universe: b => [...(b.newIds ?? []), ...(b.reactivatedIds ?? [])], f: r => r.actual, unit: "$", up: "Bringing revenue", down: "Not ordering yet", note: "New clinics (first order this calendar year) and returning ones (no baseline: silent through the baseline period after an unusual gap) have no baseline, so each one's revenue counts in full. The headline is all of it, whether the clinic is still active, reactivated or now churned." },
  AOV: { universe: b => b.activeIds ?? [], f: r => r.aovEffect, unit: "$", up: "AOV above their baseline", down: "AOV below their baseline", note: "Revenue effect of each clinic's AOV against its own baseline AOV, on the orders it placed." },
  "Net Revenue Growth": VS_BASELINE,
  "Growth run-rate": VS_BASELINE,
  "Growth decomposition": {
    ...VS_BASELINE,
    f: r => r.volume,
    note: "Growth splits into a volume effect (more or fewer orders than expected) and an AOV effect (a higher or lower ticket). Pick one; each clinic is counted in the direction of that effect.",
    variants: [
      { label: "Volume effect", f: r => r.volume, up: "Ordering more than expected", down: "Ordering less than expected", note: "Revenue effect of each clinic ordering more or fewer times than expected, at its own baseline ticket. Clinic baselines differ slightly from the book-level split in the card, so totals will not tie exactly." },
      { label: "AOV effect", f: r => r.aovEffect, up: "AOV above their baseline", down: "AOV below their baseline", note: "Revenue effect of each clinic's AOV against its own baseline AOV, on the orders it placed. Totals can differ slightly from the book-level split in the card." },
    ],
  },
  // Retention counts only what existing clinics lost: growth is capped at 100% of baseline, so a clinic above baseline adds nothing.
  "Revenue Retention": {
    universe: b => b.existingIds ?? [], f: r => (r.realChange >= 0 ? 1 : -1), unit: "clinics", amount: r => Math.min(r.realChange, 0),
    up: "Kept in full (growth not counted)", down: "Lost baseline revenue",
    note: "Retention = baseline revenue kept ÷ baseline revenue, with each clinic capped at its own baseline. Only clinics below baseline lower it; the dollar figure is what they lost.",
  },
  NRR: EXISTING_VS_BASELINE,
  // Expansion counts only the growth; clinics below baseline are what it has to offset.
  "Expansion Revenue": {
    ...EXISTING_VS_BASELINE, up: "Growing: above their baseline", down: "Shrinking: offsets the expansion",
    note: "Expansion revenue = how far growing clinics sit above their own baseline (the up tile). Clinics below baseline are the losses it has to offset.",
  },
  "Customer churn": {
    universe: b => b.kpi.churnBaseIds ?? b.existingIds ?? [], f: r => (r.life ? (r.life === "churned" ? -1 : 1) : r.daysSinceLast !== null && r.daysSinceLast < CHURN_DAYS ? 1 : -1), unit: "clinics", up: "Still ordering", down: "Churned: silent past its gap threshold",
    note: `Existing, new and reactivated clinics: churned = no order for a clinic's own threshold, as of the latest data (the same on every tab): ${CHURN_DAYS} days for new clinics, and at least ${CHURN_DAYS} days and 3 times its typical gap between orders for established ones. The dollar figure is the baseline revenue existing clinics no longer bring, net of what they still brought in this window; new and reactivated clinics had no baseline, so their revenue stays in New Revenue.`,
    amount: r => (r.life ? r.life !== "churned" : r.daysSinceLast !== null && r.daysSinceLast < CHURN_DAYS) ? 0 : -Math.max(0, r.baseline - r.actual),
  },
  "Repeat ordering": { universe: b => b.tenureActiveIds ?? b.activeIds ?? [], f: r => (r.orders >= 2 ? 1 : -1), unit: "clinics", up: "Ordered 2+ times", down: "Ordered once", note: "Active clinics split by whether they reordered inside this window." },
};

type FocusRows = React.ComponentProps<typeof FocusTable>["rows"];
/** The clinic list behind a metric, split into who pushes it up, who pulls it down, and everyone. */
function ContributorPanel({ label, tone, contrib, rows, onClose, periodId, sales }: { label: string; tone: Tone; contrib?: Contribution; rows: FocusRows; onClose: () => void; periodId: string; sales: string }) {
  const [tab, setTab] = useState<"up" | "down" | "all">(tone === "bad" || tone === "watch" ? "down" : "up");
  const [variant, setVariant] = useState(0);
  if (!contrib || !rows) return <FocusTable label={label} rows={rows} onClose={onClose} periodId={periodId} sales={sales} />;
  type R = NonNullable<FocusRows>[number] & ContribRow;
  const v = contrib.variants?.[variant];
  const fOf = v?.f ?? contrib.f;
  const scored = (rows as R[]).filter(r => !v?.inScope || v.inScope(r)).map(r => ({ r, c: fOf(r) }));
  const up = scored.filter(x => x.c > 0).sort((a, b) => b.c - a.c);
  const down = scored.filter(x => x.c < 0).sort((a, b) => a.c - b.c);
  const sum = (xs: typeof up) => xs.reduce((t, x) => t + x.c, 0);
  const money = (n: number) => `${n >= 0 ? "+" : "−"}${K(Math.abs(n))}`;
  const amount = (xs: typeof up) => {
    if (contrib.amount) {
      const n = xs.reduce((t, x) => t + contrib.amount!(x.r), 0);
      return n ? money(n) : "";
    }
    return contrib.unit === "$" ? money(sum(xs)) : "";
  };
  const shown = tab === "up" ? up : tab === "down" ? down : [...scored].sort((a, b) => a.c - b.c);
  const ranked = shown.map((x, i) => ({ ...x.r, rank: i + 1 })) as unknown as FocusRows;
  return (
    <>
      <div className="rv-contrib">
        <button type="button" className={`rv-contrib-tab up${tab === "up" ? " on" : ""}`} onClick={() => setTab("up")}>
          <span>Pushing it up · {v?.up ?? contrib.up}</span><b>{up.length} clinics</b><em>{amount(up)}</em>
        </button>
        <button type="button" className={`rv-contrib-tab down${tab === "down" ? " on" : ""}`} onClick={() => setTab("down")}>
          <span>Pulling it down · {v?.down ?? contrib.down}</span><b>{down.length} clinics</b><em>{amount(down)}</em>
        </button>
        <button type="button" className={`rv-contrib-tab all${tab === "all" ? " on" : ""}`} onClick={() => setTab("all")}>
          <span>All clinics measured</span><b>{scored.length} clinics</b><em>{amount(scored)}</em>
        </button>
      </div>
      {contrib.variants ? (
        <div className="rv-contrib-var">
          {contrib.variants.map((x, i) => (
            <button type="button" key={x.label} className={i === variant ? "on" : ""} onClick={() => setVariant(i)}>{x.label}</button>
          ))}
        </div>
      ) : null}
      <p className="rv-contrib-note">{v?.note ?? contrib.note} <button type="button" className="rv-explain" onClick={() => openGuide(guideIdFor(label))}>Explain this metric</button></p>
      <FocusTable label={`${label} · ${tab === "up" ? "pushing up" : tab === "down" ? "pulling down" : "all clinics"}`} rows={ranked} onClose={onClose} periodId={periodId} sales={sales} detail={contrib.detail} />
    </>
  );
}

/** Tenure cut (Shyam, 2026-10-16): the retention and expansion numbers for clinics by first-order year. The analytics
 * service sends the same KPIs for every cut (`book.tenure`); picking one swaps them in, everything else stays. */
type TenureKey = "all" | "pre" | "mid" | "cur";
const TENURE_CELLS = new Set(["Revenue Retention", "Repeat ordering", "At-risk customers", "Customer churn", "Expansion Revenue", "NRR"]);
function applyTenure(b: Book, sel: TenureKey): Book {
  const t = sel === "all" ? undefined : b.tenure?.[sel];
  if (!t) return b;
  return {
    ...b,
    existingIds: t.existingIds,
    tenureActiveIds: t.activeIds,
    opp: {
      ...b.opp,
      atRisk: { ...b.opp.atRisk, n: t.atRisk, up: t.atRiskRev, ids: t.atRiskIds },
      growing: { ...b.opp.growing, n: t.growing, up: t.expansionRev, ids: t.growingIds },
    },
    kpi: {
      ...b.kpi,
      existingRevenue: t.existingRevenue, existingBaseline: t.existingBaseline, existingGoal: t.existingGoal, existingCount: t.existingCount,
      revenueRetention: t.revenueRetention, nrr: t.nrr, expansionRev: t.expansionRev, growing: t.growing,
      churned: t.churned, churnedIds: t.churnedIds, churnRate: t.churnRate, churnBase: t.churnBase, churnBaseIds: t.churnBaseIds,
      repeatRate: t.repeatRate, repeatCount: t.repeatCount, activeCount: t.activeCount, repeatIds: t.repeatIds,
      atRisk: t.atRisk, atRiskRev: t.atRiskRev,
    },
  };
}
const tenureLabel = (sel: TenureKey, year: number): string =>
  sel === "all" ? "All clinics" : sel === "pre" ? "Before 2025" : sel === "mid" ? (year - 1 > 2025 ? `2025–${year - 1}` : "2025") : `${year} signups`;

/** Dial / pillar key for the combined Retention + Expansion view. */
const EXISTING = "Existing business";
const isExistingPillar = (p: string) => p === EXISTING || p === "Retention" || p === "Expansion";

function ScorecardTab({ b: bAll, fams, periodLabel, focus, sales, periodId, prevId, prevLabel }: { b: Book; fams: Wins; periodLabel: string; focus?: string | null; sales?: string; periodId?: string; prevId?: string; prevLabel?: string }) {
  const [tenureSel, setTenureSel] = useState<TenureKey>("all");
  const [earlyOpen, setEarlyOpen] = useState(false);
  const b = useMemo(() => applyTenure(bAll, tenureSel), [bAll, tenureSel]);
  const tenureYear = Number(bAll.tenure?.year ?? new Date().getFullYear());
  const k = b.kpi;
  const prevQ = useRcaQuery(api.repView.book, sales && prevId ? { password: pw(), periodId: prevId, sales } : "skip");
  const scPaceQ = useRcaQuery(api.repView.pace, sales && periodId ? { password: pw(), periodId, sales } : "skip");
  const prevB = prevQ?.ready ? prevQ : null;
  const cmpTag = prevId ? ({ d: "DoD", w: "WoW", m: "MoM", q: "QoQ" } as Record<string, string>)[prevId.split(":")[0]] ?? "vs prior" : null;
  const hz: Fam | undefined = (fams?.all ?? []).find((f: Fam) => /hormone\s*zoomer/i.test(f.family));
  const totalRev = b.totals.actual;
  const pgd = usePG(sales, periodId);
  const [wsFam, setWsFam] = useState<string>("");
  const famList = useMemo(() => {
    const t = new Map<string, number>();
    for (const c of pgd.data?.clinics ?? []) for (const [f, n] of Object.entries(c.life)) t.set(f, (t.get(f) ?? 0) + n);
    return [...t].filter(([f]) => f !== "Unmapped" && f !== NON_ZOOMER).sort((a, b2) => b2[1] - a[1]).map(([f]) => f);
  }, [pgd.data]);
  const family = wsFam || famList.find(f => /hormone\s*zoomer/i.test(f)) || famList[0] || "Hormone Zoomer";
  const pg = pgd.data ? pgStats(b, pgd.data.clinics, pgd.elig, family) : null;
  const selFam: Fam | undefined = (fams?.all ?? []).find((f: Fam) => f.family === family) ?? hz;
  const scoped = wsFam !== "";
  // New product releases: families whose first order is recent have no fair baseline (analytics/familyLaunch.ts decides which).
  const launchQ = useRcaQuery(api.familyLaunch.launches, { password: pw() });
  const launchOf = useMemo(() => new Map((launchQ?.launches ?? []).map(l => [l.family, l])), [launchQ]);
  const isNewFam = (f: string) => launchOf.get(f)?.isNew === true;
  const famLaunch = scoped && isNewFam(family) ? launchOf.get(family) : undefined;
  const rows0 = scoreRows(b, fams, pg, scoped ? { family, clinics: pgd.data?.clinics ?? null, launch: famLaunch } : undefined, tenureSel);
  // This year's signups have no baseline (new clinics carry none), so Revenue Retention / NRR / Expansion / At-risk have
  // nothing to compare with; for that cut retention is the share of new clinics still ordering (2026-10-18).
  const curCell = (c: Cell): Cell => {
    const still = k.churnBase ? (k.churnBase - (k.churned ?? 0)) / k.churnBase : null;
    if (c.label === "Revenue Retention")
      return { ...c, value: P(still), sub: `${(k.churnBase ?? 0) - (k.churned ?? 0)} of ${k.churnBase ?? 0} new clinics still ordering · no baseline yet`, ids: k.churnBaseIds, n: still, u: "%", better: 1, tone: levelTone(still, [1 - TENURE_TARGETS.churn.cur[0], 1 - TENURE_TARGETS.churn.cur[1]]) };
    if (c.label === "NRR" || c.label === "Expansion Revenue" || c.label === "At-risk customers") return NA(c.label, "new clinics have no baseline yet");
    return c;
  };
  const rows = tenureSel === "all" ? rows0 : rows0.map(r => ({ ...r, cells: r.cells.map(c => (TENURE_CELLS.has(c.label) ? { ...(tenureSel === "cur" ? curCell(c) : c), tenureTag: tenureLabel(tenureSel, tenureYear) } : c)) }));
  const prevRows = prevB ? scoreRows(prevB, { all: [] }, null) : null;
  const prevCell = (label: string) => prevRows?.flatMap(r => r.cells).find(c => c.label === label);
  const deltaOf = (c: Cell) => {
    // Prior-window numbers are all-products, so a family-scoped cell has nothing to compare against yet.
    if (scoped && !c.allProducts && !ALL_PRODUCTS_CELLS.has(c.label)) return null;
    if (tenureSel !== "all" && TENURE_CELLS.has(c.label)) return null;
    const pc = prevCell(c.label);
    if (c.n == null || pc?.n == null || !cmpTag || !prevB) return null;
    const cur = c.flow ? c.n / Math.max(1, b.days) : c.n;
    const prv = c.flow ? pc.n / Math.max(1, prevB.days) : pc.n;
    if (c.u === "%") {
      const d = (cur - prv) * 100;
      return { txt: `${d >= 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}pt`, good: c.better ? Math.sign(d) === c.better : null };
    }
    if (!prv) return null;
    const d = cur / prv - 1;
    return { txt: `${d >= 0 ? "▲" : "▼"}${Math.abs(d * 100).toFixed(1)}%`, good: c.better ? Math.sign(d) === c.better : null };
  };
  const scPace: Pace | null = scPaceQ?.ready ? (scPaceQ as Pace) : null;
  // One projection factor for every dial (full-period goal over goal so far, by weekday shape), so the parts add up to Combined.
  const scale = scPace?.ratio ?? (scPace && scPace.elapsedDays ? (scPace.elapsedDays + scPace.remainingDays) / scPace.elapsedDays : 1);
  const outcomeMeters: Array<{ pillar: string; label: string; soFar: number; heading: number; plan: number; fmt: (n: number) => string; planLbl: string; allProducts?: boolean; famScoped?: boolean; tenureTag?: string }> = [
    // New + reactivated revenue (both have no baseline); the dial keeps its name until the layout is revisited.
    { pillar: "New Business", label: "New Revenue", soFar: k.newRevenue + (k.reactivatedRevenue ?? 0), heading: scPace?.newHeading ?? (k.newRevenue + (k.reactivatedRevenue ?? 0)) * scale, plan: scPace?.newPlan ?? 0, fmt: K, planLbl: scPace?.newPlan ? "goal" : "no goal", allProducts: scoped },
    scoped && selFam
      ? { pillar: "Bundle growth", label: `${selFam.family} AOV`, soFar: selFam.orders ? selFam.revenue / selFam.orders : 0, heading: selFam.orders ? selFam.revenue / selFam.orders : 0, plan: famLaunch ? 0 : selFam.expectedOrders ? selFam.expected / selFam.expectedOrders : 0, fmt: K, planLbl: famLaunch ? "new · no baseline" : "baseline AOV", famScoped: true }
      : { pillar: "Bundle growth", label: "AOV", soFar: k.aov ?? 0, heading: k.aov ?? 0, plan: k.baseAov ?? 0, fmt: K, planLbl: "baseline AOV" },
    ...(selFam ? [{ pillar: "Product Growth", label: `${selFam.family} orders`, soFar: selFam.orders, heading: selFam.orders * scale, plan: famLaunch ? 0 : selFam.expectedOrders * scale, fmt: (n: number) => n.toFixed(0), planLbl: famLaunch ? "new · no baseline" : "goal", famScoped: scoped }] : []),
    // Retention + Expansion as one dial: revenue from clinics that already ordered in the baseline, against their baseline.
    { pillar: EXISTING, label: "Existing business revenue", soFar: k.existingRevenue ?? 0, heading: tenureSel === "all" && scPace?.existingHeading !== undefined ? scPace.existingHeading : (k.existingRevenue ?? 0) * scale, plan: (k.existingGoal ?? k.existingBaseline ?? 0) * scale, fmt: K, planLbl: k.existingGoal !== undefined ? "goal" : "baseline", allProducts: scoped, tenureTag: tenureSel === "all" ? undefined : tenureLabel(tenureSel, tenureYear) },
    ...(scoped && selFam ? [{ pillar: "Combined", label: `${selFam.family} revenue`, soFar: selFam.revenue, heading: selFam.revenue * scale, plan: famLaunch ? 0 : selFam.expected * scale, fmt: K, planLbl: famLaunch ? "new · no baseline" : "goal", famScoped: true }] : scPace ? [{ pillar: "Combined", label: "Revenue", soFar: scPace.soFar, heading: scPace.heading, plan: scPace.plan, fmt: K, planLbl: "goal" }] : []),
  ];
  // How many clinics each dial is measured over, by that dial's own logic (they overlap on purpose).
  const bookClinics = (b.allIds ?? []).length;
  const famBuyers = pg ? pg.buyerIds.length : null;
  const dialCell = (p: string) => rows.find(r => r.pillar === (p === EXISTING ? "Retention" : p))?.cells[0];
  // Clinics that ordered in this tab. A dial's group (new / existing / the whole book) also holds clinics that did not
  // order in it: they carry a goal and are the "pulling down" side, so the dial shows both counts (2026-10-18).
  const orderedSet = useMemo(() => new Set(b.activeIds ?? []), [b.activeIds]);
  const clinicCount = (p: string): { n: number | null; ordered?: number; why: string } => {
    // The dial and the matrix cell it stands for must count the same clinics, so read it off the cell's own list.
    const own = dialCell(p)?.ids;
    const base = own ? { n: own.length, why: clinicCount0(p).why } : clinicCount0(p);
    const splits = !scoped && (p === "New Business" || p === EXISTING || p === "Combined");
    const ids = p === "New Business" ? [...(b.newIds ?? []), ...(b.reactivatedIds ?? [])] : p === EXISTING ? (b.existingIds ?? []) : p === "Combined" ? (b.allIds ?? []) : [];
    return splits && base.n !== null ? { ...base, ordered: ids.filter((id: string) => orderedSet.has(id)).length } : base;
  };
  const clinicCount0 = (p: string): { n: number | null; why: string } => {
    switch (p) {
      case "New Business": return { n: (b.newIds ?? []).length + (b.reactivatedIds ?? []).length, why: "new + reactivated" };
      case "Bundle growth": return scoped ? { n: famBuyers, why: `ordered ${family}` } : { n: (b.activeIds ?? []).length, why: "ordered in this window" };
      case "Product Growth": return { n: famBuyers, why: `ordered ${family}` };
      case EXISTING: return { n: (b.existingIds ?? []).length, why: "existing: ordered in the baseline" };
      default: return scoped ? { n: famBuyers, why: `ordered ${family}` } : { n: bookClinics, why: "existing + new + returning" };
    }
  };
  const [mStyle, setMStyle] = useMeterStyle();
  const famCards = famList.map(f => (fams?.all ?? []).find((x: Fam) => x.family === f)).filter(Boolean) as Fam[];
  const focusPillar = focus ? rows.find(r => r.cells.some(c => c.label === focus))?.pillar : undefined;
  const [pillar, setPillarRaw] = useState(focusPillar ?? "Combined");
  // Once the user has picked a dial or row, the rest of the matrix recedes so the choice reads clearly.
  const [picked, setPicked] = useState(false);
  const setPillar = (p: string) => { setPillarRaw(p); setPicked(true); };
  useEffect(() => {
    if (!focus) return;
    if (focusPillar) setPillar(focusPillar);
    const t = setTimeout(() => document.getElementById(`sc-cell-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    return () => clearTimeout(t);
  }, [focus, focusPillar]);
  const all = rows.flatMap(r => r.cells);
  const count = (t: Tone) => all.filter(c => c.tone === t).length;
  const behind = rows.filter(r => r.cells.some(c => c.tone === "bad")).map(r => r.pillar);
  const sel = rows.find(r => r.pillar === (pillar === EXISTING ? "Retention" : pillar)) ?? rows[5];

  const LIB = kpiLibrary(k, b, selFam, totalRev, pg);
  const [cl, setCl] = useState<{ key: string; label: string; ids: string[]; tone: Tone; contrib?: Contribution } | null>(null);
  const clQ = useRcaQuery(api.repView.rowsByFocus, sales && cl && periodId ? { password: pw(), periodId, sales, focus: `ids:${cl.ids.join(",")}` } : "skip");
  const openCell = (c: Cell, e: React.MouseEvent) => {
    if (!c.ids?.length) return;
    e.stopPropagation();
    // Family-scoped numbers have no per-clinic sign yet, so only unscoped metrics get the up / down split.
    const contrib = tenureSel === "cur" && c.label === "Revenue Retention" ? CONTRIB["Customer churn"] : listContrib(c.label, c.ids ?? []) ?? mixContrib(c.label) ?? (scoped && !c.allProducts ? undefined : CONTRIB[c.label]);
    const ids = contrib ? contrib.universe(b) : c.ids!;
    setCl(x => (x?.key === c.label ? null : { key: c.label, label: contrib ? c.label : `${c.label} · ${c.ids!.length} clinics`, ids: ids.length ? ids : c.ids!, tone: c.tone, contrib }));
    setTimeout(() => document.getElementById("sc-cl")?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
  };
  /** "Where to act" lists: the clinics in the cell are the ones the metric is about (down); everyone else measured is the contrast (up). */
  const listContrib = (label: string, ids: string[]): Contribution | undefined => {
    const set = new Set(ids);
    const inList = (r: ContribRow) => set.has(r.clinic);
    if (label === "At-risk customers")
      return { universe: b => b.existingIds ?? [], f: r => (inList(r) ? -1 : 1), unit: "clinics", amount: r => (inList(r) ? Math.min(r.realChange, 0) : 0), up: "Not at risk", down: "At risk: slipping or well under baseline", note: "Existing clinics last seen 5–44 days ago that are flagged slipping or overdue, or are under half their baseline. The dollar figure is their real shortfall below baseline; the rest are on rhythm." };
    if (label === "Low-AOV customers")
      return { universe: b => b.activeIds ?? [], f: r => (inList(r) ? -1 : 1), unit: "clinics", up: "AOV at or above $400", down: "AOV under $400", note: "Clinics that ordered in this window, split by whether their average order is under $400." };
    if (label === "Revenue opportunity")
      return { universe: b => b.allIds ?? [], f: r => (inList(r) ? -1 : 1), unit: "clinics", up: "No gap to close", down: "At-risk or below their baseline AOV", note: "The opportunity is the at-risk shortfall plus the AOV gap: these are the clinics where either applies." };
    return undefined;
  };
  const pgMap = useMemo(() => new Map((pgd.data?.clinics ?? []).map(c => [c.clinic, c])), [pgd.data]);
  const famsOf = (win: Record<string, number> | undefined) => Object.keys(win ?? {}).filter(f => f !== "Unmapped" && f !== NON_ZOOMER && (win?.[f] ?? 0) > 0);
  /** Metrics measured on the product mix: split by clinic using the same per-clinic family orders the number uses. */
  const mixContrib = (label: string): Contribution | undefined => {
    if (!pg) return undefined;
    if (label === "Repeat product rate")
      return { universe: () => pg.buyerIds, f: r => ((pgMap.get(r.clinic)?.win[family] ?? 0) >= 2 ? 1 : -1), unit: "clinics", up: `Ordered ${family} 2+ times`, down: `Ordered ${family} once`, note: `Clinics that ordered ${family} in this window, split by whether they reordered it.` };
    if (label === "Target Product Orders") {
      const ids = (pgd.data?.clinics ?? []).filter(c => (c.win[family] ?? 0) > 0 || famExpected(c, family) >= 1 || famStatus(c, family)).map(c => c.clinic);
      const calc = (cl: string) => {
        const c = pgMap.get(cl);
        const ord = c?.win[family] ?? 0, exp = famExpected(c, family), st = famStatus(c, family);
        const down = st === "STOPPED" || st === "DECLINING" || (exp >= 1 && ord < exp);
        const up = !down && ((exp >= 1 && ord > exp) || ((st === "NEW" || st === "RESTARTED") && ord > 0));
        return { ord, exp, st, down, up };
      };
      return {
        universe: () => ids,
        f: r => { const x = calc(r.clinic); return x.down ? -Math.max(x.exp - x.ord, 0.01) : x.up ? Math.max(x.ord - x.exp, 0.01) : 0; },
        unit: "clinics",
        up: `Above expected ${family} orders, or newly on it`,
        down: `Below expected, or stopped / declining on ${family}`,
        detail: cl => { const x = calc(cl); return `${family}: ${x.ord} ordered${x.exp >= 1 ? ` vs ${x.exp.toFixed(1)} expected` : " · nothing expected"}${x.st ? ` · ${x.st}` : ""}`; },
        note: `Each clinic's ${family} orders in this window against what its baseline implies (3+ baseline orders needed; clinics new this year have none). Pulling down: below expected, or Portfolio Changes says STOPPED or DECLINING on it. Pushing up: above expected, or restarted / newly on it. The status looks at the last 28 days against the 90 before, so it does not move with the tab.`,
      };
    }
    if (label === "Product adoption") {
      const clinics = pgd.data?.clinics ?? [];
      const newSet = new Set<string>(b.newIds ?? []);
      const hasProd = (c: PGClinic) => famsOf(c.win).length > 0;
      const newIds = clinics.filter(c => newSet.has(c.clinic) && hasProd(c)).map(c => c.clinic);
      const exIds = clinics.filter(c => !newSet.has(c.clinic) && hasProd(c)).map(c => c.clinic);
      const isNewC = (cl: string) => newSet.has(cl);
      const addedC = (cl: string) => (pgMap.get(cl)?.win[family] ?? 0) > 0 && famStatus(pgMap.get(cl), family) === "NEW";
      return {
        universe: () => [...newIds, ...exIds],
        f: r => ((pgMap.get(r.clinic)?.win[family] ?? 0) > 0 ? 1 : -1),
        unit: "clinics",
        up: `Ordered ${family}`,
        down: `Have not ordered ${family}`,
        detail: cl => { const c = pgMap.get(cl); const st = famStatus(c, family); return `${isNewC(cl) ? "New clinic" : "Existing"} · ${c?.win[family] ?? 0} ${family} orders in this window${st ? ` · ${st}` : ""}`; },
        note: `New clinics ordering this window, split by whether they ordered ${family}.`,
        variants: [
          { label: "All clinics", f: r => (isNewC(r.clinic) ? ((pgMap.get(r.clinic)?.win[family] ?? 0) > 0 ? 1 : -1) : addedC(r.clinic) ? 1 : -1), up: `Adopted ${family}`, down: `Ordering, but not ${family}`, note: `The card's percentage: new clinics that ordered ${family} plus existing clinics that ordered it in this window with status NEW, out of all of them that ordered in this window.` },
          { label: "New clinics", inScope: r => isNewC(r.clinic), f: r => ((pgMap.get(r.clinic)?.win[family] ?? 0) > 0 ? 1 : -1), up: `Ordered ${family}`, down: `Ordering, but not ${family}`, note: `New clinics (first order this year) that ordered in this window, split by whether ${family} was among their orders. Part of the adoption rate on the card.` },
          { label: "Existing clinics", inScope: r => !isNewC(r.clinic), f: r => (addedC(r.clinic) ? 1 : -1), up: `Added ${family}: ordered it in this window, status NEW`, down: `Ordering, but have not added ${family}`, note: `Established clinics that ordered in this window, split by whether they added ${family}: ordered it in this window and Portfolio Changes status is NEW, meaning no ${family} orders in the 90 days before the last 28, and fewer than 3 ever before (3+ earlier orders would be RESTARTED, not new to them). It looks at the last 28 days, so it does not move with the tab.` },
        ],
      };
    }
    if (label === "Products per customer")
      return { universe: () => pg.activeIds, f: r => (famsOf(pgMap.get(r.clinic)?.win).length >= 2 ? 1 : -1), unit: "clinics", up: "On 2+ product families", down: "On 1 family", note: "Clinics that ordered a Zoomer product in this window, split by how many Zoomer families they bought. Non Zoomer is not counted as a family." };
    return undefined;
  };
  const libFor = LIB.filter(x => (pillar === EXISTING ? isExistingPillar(x.pillar) : x.pillar === pillar));

  return (
    <>
      <div className="rv-eyebrow">Scorecard · {periodLabel} · your book<Info k="sc" /></div>
      <div className="rv-sc-head">
        <h1 className="rv-h1">
          {count("good")} on track, {count("watch")} to watch, {count("bad")} behind.
          {behind.length ? ` ${behind.slice(0, 2).join(" and ")} need the most work.` : ""}
        </h1>
        <div className="rv-legend">
          <span><i className="good" />On track</span>
          <span><i className="watch" />Watch</span>
          <span><i className="bad" />Behind</span>
          <span><i className="act" />Where to act</span>
          <span><i className="na" />Not in data yet</span>
        </div>
      </div>
      <div className="rv-sec-head" style={{ marginTop: 8 }}>
        <h2>Outcomes vs heading to &amp; goal</h2>
        <MeterToggle v={mStyle} set={setMStyle} />
      </div>
      <HowCalc>
        <p>Each dial shows booked so far, where the window is heading and the goal at the end of the dial. Heading is the pace to date carried over the whole window using each weekday's usual weight. Combined is Existing plus New; Existing is measured against its clinics' goals and New against the new-business goal. "x of y clinics ordered" counts the clinics that ordered in this window out of the group.</p>
        <p>The colour compares heading with goal for that dial. The matrix below has one row per pillar; click a cell for the clinics behind it, or "Explain this metric" for its Scorecard guide entry.</p>
      </HowCalc>
      {scoped ? (
        <div className="rv-scope">
          <span>Scorecard scoped to <b>{family}</b>. <i className="rv-famkey" /> Blue bar = follows {family}; &ldquo;all products&rdquo; = not family-specific yet (retention and expansion).{famLaunch ? ` ${family} launched ${famLaunch.firstOrder}, so there is no baseline and no target yet.` : ""}</span>
          <button type="button" onClick={() => setWsFam("")}>Back to all products</button>
        </div>
      ) : null}
      {(() => {
        // Combined revenue is the headline dial: alone on top and larger; the four pillar dials sit in one row below.
        const renderMeter = (m: (typeof outcomeMeters)[number], hero: boolean) => (
          <button type="button" key={m.pillar} className={`rv-outm${hero ? " rv-outm-hero" : ""}${m.famScoped ? " is-fam" : ""}${(m.pillar === EXISTING ? isExistingPillar(pillar) : pillar === m.pillar) ? " is-sel" : ""}`} onClick={() => setPillar(m.pillar)}>
            <div className="rv-eyebrow">{m.pillar}{m.allProducts ? <em className="rv-allp"> · all products</em> : null}{m.tenureTag ? <em className="rv-allp"> · {m.tenureTag}</em> : null}</div>
            <b>{m.label}</b>
            <MiniMeter soFar={m.soFar} heading={m.heading} plan={m.plan} style={mStyle} big={hero} />
            <div className="rv-outm-nums">
              <span><i className="sw sofar" />So far <b>{m.fmt(m.soFar)}</b></span>
              <span><i className="sw heading" />Heading <b>{m.fmt(m.heading)}</b></span>
              <span><i className="sw plan" />{m.planLbl} <b>{m.plan ? m.fmt(m.plan) : "—"}</b></span>
            </div>
            {(() => {
              const cc = clinicCount(m.pillar);
              return (
                <div className="rv-outm-clin" title={`Clinics this dial is measured over: ${cc.why}`}>
                  <b>{cc.ordered !== undefined ? `${cc.ordered} of ${cc.n}` : (cc.n ?? "…")}</b> {cc.ordered !== undefined ? "clinics ordered" : "clinics"}
                  <span>{cc.why}{m.pillar === "Combined" && !scoped ? ` · ${cc.n} in the book` : ` · of ${bookClinics} in the book`}</span>
                </div>
              );
            })()}
          </button>
        );
        const heroMeter = outcomeMeters.find(m => m.pillar === "Combined");
        return (
          <>
            {heroMeter ? <div className="rv-outhero">{renderMeter(heroMeter, true)}</div> : null}
            <div className="rv-outmeters">{outcomeMeters.filter(m => m.pillar !== "Combined").map(m => renderMeter(m, false))}</div>
          </>
        );
      })()}
      {famCards.length ? (
        <>
          <div className="rv-eyebrow" style={{ marginTop: 10 }}>Product families<Info k="fam" /></div>
          <div className="rv-famcards">
            {famCards.filter(f => !isNewFam(f.family)).map(f => {
              const g = f.expectedOrders ? f.orders / f.expectedOrders - 1 : null;
              return (
                <button type="button" key={f.family} className={`rv-famcard${f.family === family ? " on" : ""} ${g === null ? "" : g >= 0 ? "good" : g > -0.05 ? "watch" : "bad"}`} onClick={() => setWsFam(f.family)}>
                  <span>{f.family}</span>
                  <b>{f.orders.toFixed(0)} orders</b>
                  <em>{f.expectedOrders.toFixed(0)} exp · {g === null ? "—" : SP(g)} vs exp</em>
                </button>
              );
            })}
          </div>
          {famCards.some(f => isNewFam(f.family)) ? (
            <>
              <div className="rv-famgroup">
                <b>New product releases</b>
                <span>First order within the last {Math.round((launchQ?.newWithinDays ?? 60) / 30)} months, so there is no fair baseline: no expected orders, no on-track / behind colour. Shown with how long each has been live.</span>
              </div>
              <div className="rv-famcards rv-famcards-new">
                {famCards.filter(f => isNewFam(f.family)).map(f => {
                  const l = launchOf.get(f.family);
                  return (
                    <button type="button" key={f.family} className={`rv-famcard new${f.family === family ? " on" : ""}`} onClick={() => setWsFam(f.family)}>
                      <span>{f.family}</span>
                      <b>{f.orders.toFixed(0)} orders</b>
                      <em>launched {l?.firstOrder} · {l?.daysLive}d live</em>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <div className="rv-tenure">
        <div className="rv-tenure-sel">
          <span className="rv-eyebrow">Retention &amp; expansion for</span>
          {(["all", "pre", "mid", "cur"] as TenureKey[]).map(t => (
            <button type="button" key={t} className={tenureSel === t ? "on" : ""} onClick={() => setTenureSel(t)}>
              {tenureLabel(t, tenureYear)}
              <em>{bAll.tenure?.[t]?.existingCount ?? "…"}</em>
            </button>
          ))}
        </div>
        {bAll.earlyLife ? (
          <button type="button" className="rv-tenure-early" onClick={() => setEarlyOpen(v => !v)} title="Clinics whose first order was this year, before this window, and who ordered in it">
            <span className="rv-eyebrow">Early-life retention · {bAll.earlyLife.year} class</span>
            <b>{bAll.earlyLife.rate === null ? "—" : P(bAll.earlyLife.rate)}</b>
            <em>{bAll.earlyLife.kept} of {bAll.earlyLife.base} still ordering{bAll.earlyLife.base - bAll.earlyLife.kept ? ` · ${bAll.earlyLife.base - bAll.earlyLife.kept} lost ${earlyOpen ? "▲" : "▼"}` : ""}</em>
          </button>
        ) : null}
      </div>
      {earlyOpen && bAll.earlyLife?.lost?.length ? (
        <div className="rca-card rv-early-lost">
          <div className="rv-eyebrow">Signed up (first order) in {bAll.earlyLife.year}, before this window, no order in it · {bAll.earlyLife.lost.length}{bAll.earlyLife.base - bAll.earlyLife.kept > bAll.earlyLife.lost.length ? "+" : ""} clinics</div>
          <table className="rca-table rca-table-sub">
            <thead><tr><th>Clinic</th><th>State</th><th>First order</th><th>Last order</th></tr></thead>
            <tbody>
              {bAll.earlyLife.lost.map((l: { clinic: string; name: string; state?: string; firstOrder: string | null; lastOrder: string | null }) => (
                <tr key={l.clinic}><td>{l.name}</td><td>{l.state ?? "—"}</td><td>{fmtD(l.firstOrder) || "—"}</td><td>{fmtD(l.lastOrder) || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className={`rv-matrix${picked ? " has-pick" : ""}`}>
        <div className="rv-mx-h">Pillar</div>
        <div className="rv-mx-h">Outcome<span>Did it happen?</span></div>
        <div className="rv-mx-h">Leading indicator<span>Will it happen?</span></div>
        <div className="rv-mx-h">Opportunity<span>Where to act</span></div>
        <div className="rv-mx-h">Diagnostic<span>Why</span></div>
        {rows.map(r => (
          <div
            className={`rv-mx-row${pillar === r.pillar || (pillar === EXISTING && isExistingPillar(r.pillar)) ? " is-sel" : ""}`}
            key={r.pillar}
            onClick={() => setPillar(r.pillar)}
            onKeyDown={e => e.key === "Enter" && setPillar(r.pillar)}
            role="button"
            tabIndex={0}
          >
            <div className="rv-mx-p">
              <b>{r.pillar}</b>
              <div className="rv-dots">
                {r.cells.map((c, i) => (
                  <i key={i} className={c.tone} />
                ))}
              </div>
            </div>
            {r.cells.map(c => (
              <div className={`rv-mx-c ${c.tone}${c.famScoped ? " is-fam" : ""}${cl?.key === c.label ? " is-open" : ""}${focus === c.label ? " is-focus" : ""}${c.ids?.length ? " rv-click" : ""}`} key={c.label} id={`sc-cell-${c.label}`} onClick={e => openCell(c, e)} title={c.ids?.length ? "Click for the clinic list" : undefined}>
                <div className="rv-mx-l">
                  {c.label}{c.allProducts ? <em className="rv-allp"> · all products</em> : null}{c.tenureTag ? <em className="rv-allp"> · {c.tenureTag}</em> : null}
                  <i className={c.tone} />
                </div>
                <div className="rv-mx-v">{c.value}</div>
                <div className="rv-mx-s">{c.sub}</div>
                <button type="button" className="rv-explain" onClick={e => { e.stopPropagation(); openGuide(guideIdFor(c.label)); }}>Explain this metric</button>
                {(() => { const d = deltaOf(c); return d ? <div className={`rv-mx-d ${d.good === null ? "" : d.good ? "up" : "dn"}`}>{cmpTag} {d.txt}{c.flow ? " /day" : ""} <span>vs {prevLabel}</span></div> : null; })()}
              </div>
            ))}
          </div>
        ))}
      </div>
      {cl ? (
        <div id="sc-cl">
          <ContributorPanel key={cl.key} label={cl.label} tone={cl.tone} contrib={cl.contrib} rows={clQ?.ready ? clQ.rows : null} onClose={() => setCl(null)} periodId={periodId ?? ""} sales={sales ?? ""} />
        </div>
      ) : null}
      <div className="rv-sel-bar">
        <span className="rv-mono">{sel.pillar} · outcome</span>
        <b>{sel.cells[0].label}</b>
        <span className="rv-mono">{sel.cells[0].value} · {sel.cells[0].sub}</span>
      </div>
      <div className="rv-sec-head">
        <h2>All {pillar} KPIs</h2>
        <span>from Sales perf KPIs v2 · {libFor.filter(x => x.value !== null).length} of {libFor.length} calculable from RCA data</span>
      </div>
      <div className="rv-lib">
        {libFor.map(x => (
          <div className={`rv-lib-card${x.value === null ? " na" : ""}`} key={x.name}>
            <div className="rv-eyebrow">{x.pillar}</div>
            <b>{x.name}</b>
            <div className="rv-lib-v">{x.value ?? "—"}</div>
            <p>{x.def}</p>
            {x.value === null ? <span className="rv-mono rv-dim">Not in RCA data · {x.why}</span> : null}
          </div>
        ))}
      </div>
      {pillar === "Product Growth" ? (
        <>
          {(sales ?? "").startsWith("team:") ? <p className="rv-dim rv-small">Product whitespace is marked rep by rep. Pick a rep to mark or review their clinics.</p> : <WhitespacePlanner sales={sales} clinics={pgd.data?.clinics ?? null} elig={pgd.elig} family={family} famList={famList} setFamily={setWsFam} />}
        </>
      ) : null}
      {pillar === "Expansion" || pillar === EXISTING ? <CrossSellList pg={pg} /> : null}
    </>
  );
}

export function ProductFamilies({ fams }: { fams: Wins }) {
  const all: Fam[] = fams?.ready ? fams.all : [];
  if (!fams?.ready) return <p className="rv-dim rv-small" style={{ marginTop: 16 }}>Loading product families…</p>;
  if (all.length === 0) return <p className="rv-dim rv-small" style={{ marginTop: 16 }}>No product-family orders in this window.</p>;
  const withGrowth = all.map(f => ({ ...f, growth: f.expected ? f.revenue / f.expected - 1 : null }));
  const ranked = [...withGrowth].sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return (
    <>
      <div className="rv-sec-head">
        <h2>All product families<Info k="fam" /></h2>
        <span>
          {all.length} families · best {best?.family} ({best?.growth !== null && best?.growth !== undefined ? SP(best.growth) : "—"}) · worst{" "}
          {worst?.family} ({worst?.growth !== null && worst?.growth !== undefined ? SP(worst.growth) : "—"})
        </span>
      </div>
      <div className="rv-fam-list">
        {ranked.map(f => (
          <div
            className={`rv-fam-row${f.family === best?.family ? " best" : ""}${f.family === worst?.family ? " worst" : ""}`}
            key={f.family}
          >
            <b>{f.family}</b>
            <span className="rv-mono">{K(f.revenue)} / {K(f.expected)} exp</span>
            <span className="rv-mono">{f.orders} orders ({f.orderDelta > 0 ? "+" : ""}{f.orderDelta.toFixed(0)} vs base)</span>
            <em className={f.growth === null ? "rv-dim" : f.growth < 0 ? "bad" : "good"}>
              {f.growth === null ? "—" : SP(f.growth)}
            </em>
          </div>
        ))}
      </div>
    </>
  );
}

type Lib = { pillar: string; name: string; def: string; value: string | null; why?: string };
function kpiLibrary(k: Book, b: Book, hz: Fam | undefined, totalRev: number, pg?: PGStats | null): Lib[] {
  const n = (pillar: string, name: string, def: string, value: string | null, why = "") => ({ pillar, name, def, value, why });
  const CRM = "needs CRM (HubSpot deals/leads)";
  const MIX = "needs clinic × product history";
  return [
    n("New Business", "New Revenue", "Revenue from clinics whose first-ever order is in this window.", K(k.newRevenue)),
    n("New Business", "New Customers", "First-time clinics that placed an order.", String(k.newCustomers)),
    n("New Business", "New Customer Orders", "Orders placed by first-time clinics.", String(k.newOrders)),
    n("New Business", "New Customer AOV", "Average order value from first-time clinics.", k.newAov ? K(k.newAov) : null, "no new clinics"),
    n("New Business", "New Customer Revenue %", "New-clinic revenue as a share of total.", P(k.newRevShare, 1)),
    n("New Business", "Order 1 → Order 2", "Share of new clinics that placed a second order (activation).", P(k.o1to2)),
    n("New Business", "Lead → Customer Conversion", "Share of leads that become paying customers.", null, CRM),
    n("New Business", "Pipeline $", "Open new-business opportunity value.", null, CRM),
    n("New Business", "Pipeline Coverage", "Open pipeline relative to target.", null, CRM),
    n("New Business", "Sales Cycle", "Average days from first contact to closed-won.", null, CRM),
    n("New Business", "Win Rate", "Share of qualified opportunities closed won.", null, CRM),
    n("New Business", "Quota Attainment", "Performance against assigned quota.", null, "no quota data"),
    n("Bundle growth", "Overall AOV", "Average revenue per order.", k.aov ? K(k.aov) : null),
    n("Bundle growth", "New Customer AOV", "AOV from first-time clinics.", k.newAov ? K(k.newAov) : null, "no new clinics"),
    n("Bundle growth", "Existing Customer AOV", "AOV from existing clinics (vs their baseline).", k.existingAov ? `${K(k.existingAov)} (base ${K(k.existingBaseAov ?? 0)})` : null),
    n("Bundle growth", "Orders per Customer", "Orders per active clinic in the window.", k.ordersPerCustomer ? k.ordersPerCustomer.toFixed(1) : null),
    n("Bundle growth", "Bundle Penetration", "Share of orders that are bundle orders.", P(k.bundlePen)),
    n("Bundle growth", "AOV Opportunity", "Revenue if clinics below their own baseline AOV got back to it.", K(k.aovOpp)),
    n("Bundle growth", "Discount Rate", "Average discount vs list price.", null, "no list-price/discount field"),
    n("Bundle growth", "Stack Penetration", "Orders with 2+ Zoomers.", null, "needs per-order panel mix"),
    n("Bundle growth", "Stack Mix", "Revenue share by panel combination.", null, "needs per-order panel mix"),
    n("Bundle growth", "Zoomers per Order", "Zoomer panels per order.", null, "needs per-order panel mix"),
    n("Product Growth", "Target Product Orders", "Selected family orders in the window.", hz ? hz.orders.toFixed(0) : null, "no Hormone Zoomer orders"),
    n("Product Growth", "Target Product Growth %", "Selected family revenue vs its goal.", hz && hz.expected ? SP(hz.revenue / hz.expected - 1) : null, "no baseline"),
    n("Product Growth", "Product Mix %", "Selected family share of revenue.", hz && totalRev ? P(hz.revenue / totalRev, 1) : null, "no Hormone Zoomer orders"),
    n("Product Growth", "Attach Rate", "Orders that attach the target product.", null, "needs per-order panel mix"),
    n("Product Growth", "Product Penetration", "Clinics you marked eligible that have ordered the product.", pg && pg.eligN ? P((pg.eligN - pg.wsN) / pg.eligN) : null, "mark eligible clinics in the planner below"),
    n("Product Growth", "Product Adoption", "New clinics that ordered the selected family plus existing clinics that added it (status NEW), out of all measured.", pg ? P(pg.adoption) : null, "no new clinics with orders"),
    n("Product Growth", "Repeat Rate", "Clinics ordering the selected family that ordered it 2+ times in the window.", pg ? P(pg.repeat) : null, "no orders"),
    n("Product Growth", "Product Whitespace", "Eligible clinics (marked by you) that never ordered it.", pg ? String(pg.wsN) : null, "loading"),
    n("Product Growth", "Portfolio changes", "Clinics by Portfolio Changes status (NEW / DECLINING / STOPPED).", pstat(b), "no portfolio status"),
    n("Retention", "Revenue Retention", "Existing clinics' baseline revenue kept (growth capped).", P(k.revenueRetention)),
    n("Retention", "Customer Retention", "Existing clinics still ordering.", P(k.customerRetention)),
    n("Retention", "Customer Churn", `Existing clinics with no order in the last ${CHURN_DAYS} days.`, `${P(k.churnRate, 1)} (${k.churned})`),
    n("Retention", "Revenue Churn", "Baseline revenue of churned clinics, net of what they still brought in this window.", K(k.revenueChurn)),
    n("Retention", "Contraction Revenue", "Revenue lost from clinics still ordering but below baseline.", K(k.contraction)),
    n("Retention", "Repeat Purchase Rate", "Active clinics with 2+ orders.", P(k.repeatRate)),
    n("Retention", "Time to Next Order", "Approx. days between orders for repeat clinics (window ÷ orders).", k.daysBetweenOrders ? `${k.daysBetweenOrders.toFixed(0)}d` : null),
    n("Retention", "Dormant Customers", "Clinics with no order in 9+ months.", String(k.dormant)),
    n("Retention", "At-Risk Revenue", "Shortfall at clinics flagged slipping/overdue or under half their baseline.", K(k.atRiskRev)),
    n("Retention", "Reactivation Rate", "Lapsed clinics that resumed ordering.", null, "needs lapsed-list history"),
    n("Expansion", "Expansion Revenue", "Revenue above baseline at growing existing clinics.", SK(k.expansionRev)),
    n("Expansion", "Expansion Rate", "Existing clinics above baseline.", P(k.expansionRate)),
    n("Expansion", "Existing Customer Revenue Growth", "Existing clinics' revenue vs baseline.", SP(k.existingGrowth ?? 0)),
    n("Expansion", "AOV Expansion", "Existing-clinic AOV change vs baseline.", k.existingAov && k.existingBaseAov ? SK(k.existingAov - k.existingBaseAov) : null),
    n("Expansion", "Bundle Expansion", "Existing clinics whose bundle share rose.", String(k.bundleUp)),
    n("Expansion", "NRR", "Existing clinics' revenue ÷ their baseline.", P(k.nrr)),
    n("Expansion", "Orders per Customer", "Orders per active clinic.", k.ordersPerCustomer ? k.ordersPerCustomer.toFixed(1) : null),
    n("Expansion", "Products per Customer", "Distinct panels per clinic.", null, MIX),
    n("Expansion", "Product Expansion", "Clinics adding new products.", null, MIX),
    n("Combined", "Net Revenue Growth", "Revenue vs goal across the book.", `${SP(k.netGrowth ?? 0)} · ${SK(b.totals.delta)}`),
    n("Combined", "Growth run-rate", "Weekly revenue pace in the window.", k.runRate ? `${K(k.runRate)}/wk` : null),
    n("Combined", "Revenue opportunity", "At-risk shortfall + AOV gap.", K(k.opportunity)),
    n("Combined", "Growth decomposition", "Volume effect / AOV effect.", `${SK(k.volume)} / ${SK(k.aovEffect)}`),
  ];
}

/** Full-metrics drawer for one clinic, opened from a Call-first card, a
 * stuck-funnel row, or a clinic list inside the shortfall tree — every
 * number the clinic list itself would show (Shyam, 2026-09-28). */
function ClinicDrawer({ name, detail, onClose, periodId }: { name: string; detail: Book | null; onClose: () => void; periodId: string }) {
  return (
    <div className="rv-modal-mask" onClick={onClose}>
      <div className="rv-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="rv-modal-x" onClick={onClose}>
          close ✕
        </button>
        {detail === null ? (
          <div className="rv-loading">Loading {name}…</div>
        ) : detail.ready === false ? (
          <div className="rv-loading">
            {name} has no data in this window
            {detail.reason === "not-in-book" ? " (not in your book for this period)" : ""}. Try a wider window (This month/Custom).
          </div>
        ) : (
          <ClinicCardBody detail={detail} periodId={periodId} />
        )}
      </div>
    </div>
  );
}

/** One vs-baseline comparison bar (mockup option 3), reused for every metric
 * in the combined clinic-card design. */
function CompareBar({
  label,
  actual,
  exp,
  fmt,
  higherIsBetter,
}: {
  label: string;
  actual: number;
  exp: number;
  fmt: (v: number) => string;
  higherIsBetter?: boolean;
}) {
  const max = Math.max(actual, exp, 1);
  const worse = higherIsBetter ? actual < exp : actual < exp;
  return (
    <div className="rv-ch-comp">
      <div className="rv-ch-comp-h">
        <span>{label}</span>
        <b className={worse ? "bad" : "good"}>
          {fmt(actual)} / {fmt(exp)}
        </b>
      </div>
      <div className="rv-ch-comp-bar">
        <i className="rv-ch-comp-exp" style={{ width: `${(exp / max) * 100}%` }} />
        <i className={`rv-ch-comp-actual${worse ? " bad" : " good"}`} style={{ width: `${(actual / max) * 100}%` }} />
      </div>
    </div>
  );
}

/** Everything a single clinic card shows (Shyam, 2026-09-28 rounds 4/5) —
 * hero delta + timeline (mockup option 2) + vs-baseline bars (mockup option
 * 3) + the option-1 stat grid + health/portfolio tags, then the same
 * portfolio / customers ("providers") / digital-footprint panels the main
 * dashboard's own expandable clinic row shows, scoped to this rep's book and
 * whatever window is currently open. Shared by the single-clinic modal and
 * the inline expand inside a clinic-list row. */
function ClinicCardBody({ detail, periodId, winLabel }: { detail: Book; periodId: string; winLabel?: string }) {
  return (
    <div className="rv-cc">
      <div className="rv-cc-head">
      <div className="rv-eyebrow">{detail.state}{detail.country && detail.country !== "US" ? `, ${detail.country}` : ""} · {COHORT[detail.cohort] ?? detail.cohort}</div>
      <h2 className="rv-modal-h">{detail.name}</h2>

      <div className="rv-ch-hero">
        <div className={`rv-ch-hero-v ${detail.delta < 0 ? "bad" : "good"}`}>{SK(detail.delta)}</div>
        <div className="rv-ch-hero-l">vs goal · {winLabel ?? "this period"} · {K(detail.expected)} goal{detail.baseline !== undefined ? ` · ${K(detail.baseline)} baseline` : ""}</div>
        {detail.realChange !== undefined ? (
          <div className="rv-ch-hero-l">
            vs baseline <b className={detail.realChange < 0 ? "bad" : "good"}>{SK(detail.realChange)}</b> · goal stretch <b className={detail.ambition > 0 ? "bad" : "good"}>{SK(-detail.ambition)}</b>
          </div>
        ) : null}
      </div>
      <div className="rv-ch-timeline">
        <div className="rv-ch-tl-pt">
          <i className="rv-ch-tl-dot rv-ch-tl-dot-grey" />
          First order<b>{fmtD(detail.firstOrder) || "—"}</b>
        </div>
        <div className="rv-ch-tl-pt">
          <i className={`rv-ch-tl-dot${detail.daysSinceTouch === null || detail.daysSinceTouch > 14 ? " rv-ch-tl-dot-bad" : ""}`} />
          Last touch<b>{detail.daysSinceTouch !== null ? `${detail.daysSinceTouch}d ago` : "no record"}</b>
        </div>
        <div className="rv-ch-tl-pt">
          <i className="rv-ch-tl-dot rv-ch-tl-dot-bad" />
          Last order<b>{detail.daysSinceLast !== null ? `${detail.daysSinceLast}d ago` : "—"}</b>
        </div>
      </div>
      </div>

      <div className="rv-cc-bars">
      <div className="rv-ch-bars" style={detail.fallback ? { display: "none" } : undefined}>
        <CompareBar label="Revenue" actual={detail.actual} exp={detail.expected} fmt={K} />
        <CompareBar label="Orders" actual={detail.orders} exp={detail.expectedOrders} fmt={(v: number) => v.toFixed(1)} />
        <CompareBar label="AOV" actual={detail.aov} exp={detail.baseAov} fmt={K} higherIsBetter />
        <CompareBar label="Bundle share" actual={detail.bundleShare} exp={detail.baseBundleShare} fmt={(v: number) => P(v)} higherIsBetter />
      </div>
      {detail.health?.length || detail.pstatus?.length ? (
        <div className="rv-modal-tags">
          {(detail.health ?? []).map((h: string) => (
            <span className="rv-tag" key={`h-${h}`}>{h}</span>
          ))}
          {(detail.pstatus ?? []).map((p: string) => (
            <span className="rv-tag rv-tag-blue" key={`p-${p}`}>{p}</span>
          ))}
        </div>
      ) : null}
      </div>

      <div className="rv-cc-stats">
      <div className="rv-modal-grid">
        <div><span>Volume effect</span><b className={detail.volume < 0 ? "bad" : "good"}>{SK(detail.volume)}</b></div>
        <div><span>AOV effect</span><b className={detail.aovEffect < 0 ? "bad" : "good"}>{SK(detail.aovEffect)}</b></div>
        <div><span>Last order</span><b>{fmtD(detail.lastOrderAllTime) || "—"} {detail.daysSinceLast !== null ? `(${detail.daysSinceLast}d ago)` : ""}</b></div>
        <div><span>Last touch</span><b>{fmtD(detail.lastTouchDate) || "no touch on record"} {detail.daysSinceTouch !== null ? `(${detail.daysSinceTouch}d ago)` : ""}</b></div>
        <div><span>Orders · {winLabel ?? "this window"}</span><b>{detail.windowOrders}</b></div>
        <ClinicalRows clinic={detail.clinic} />
      </div>
      {detail.fallback ? (
        <div className="rv-modal-grid" style={{ marginTop: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}><span>No orders in {winLabel ?? "this window"} — showing This qtr ({fmtD(detail.fallback.start)} – {fmtD(detail.fallback.end)})</span></div>
          <div><span>Orders</span><b>{detail.fallback.orders}</b></div>
          <div><span>Revenue</span><b>{K(detail.fallback.actual)}</b></div>
          <div><span>AOV</span><b>{detail.fallback.aov ? K(detail.fallback.aov) : "—"}</b></div>
          <div><span>Bundle share</span><b>{detail.fallback.bundleShare !== null ? P(detail.fallback.bundleShare) : "—"}</b></div>
        </div>
      ) : null}

      </div>

      <div className="rv-cc-tables">
      <RepClinicPortfolio clinic={detail.clinic} periodId={detail.fallback?.periodId ?? periodId} />
      <RepFootprintNote clinic={detail.clinic} />
      <RepCustomerTable clinic={detail.clinic} periodId={detail.fallback?.periodId ?? periodId} />
      </div>
    </div>
  );
}

/** Rep-scoped clinic portfolio panel — same `families.portfolioAction` the main dashboard's expandable clinic row calls;
 * `assertOwnsClinic` inside it already restricts a rep session to their own clinics.
 * Two windows live here and are labelled as such (2026-10-18): Orders and expected follow the tab; the status (NEW /
 * DECLINING / STOPPED) is the last 28 days against the prior 90 days, whatever the tab. Tests that have a status but no
 * row in the tab (the model works on tests, not families) are listed in their own block. */
type PortRes = {
  rows: Array<{ family: string; orders: number; expectedOrders: number; orderDelta: number; status: string; baselineAvg: number; recentOrders: number; product?: boolean; lastBefore?: string; expectation?: "ok" | "low" | "none" }>;
  testStatus: Array<{ test: string; status: string; baselineAvg: number; recentOrders: number; lastBefore?: string }>;
  window?: { start: string; end: string };
  recent?: { start: string; end: string };
  prior?: { start: string; end: string };
  isNew?: boolean;
};
function RepClinicPortfolio({ clinic, periodId }: { clinic: string; periodId: string }) {
  const run = useRcaAction(api.families.portfolioAction);
  const [res, setRes] = useState<PortRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    run({ password: pw(), clinic, periodId })
      .then(r => {
        if (live) setRes(r as unknown as PortRes);
      })
      .catch(e => {
        if (live) setError(String(e).slice(0, 160));
      });
    return () => {
      live = false;
    };
  }, [run, clinic, periodId]);

  if (error) return <div className="rca-sub rv-dim">{error}</div>;
  if (res === null) return <div className="rca-sub rv-dim">Loading this clinic's portfolio…</div>;
  const ordered = res.rows.filter(r => r.orders > 0);
  const products = ordered.filter(r => r.product !== false);
  if (res.rows.length === 0 && res.testStatus.length === 0) return <div className="rca-sub rv-dim">No product families in this window.</div>;
  const win = res.window ? `${fmtD(res.window.start)} – ${fmtD(res.window.end)}` : "this window";
  const rec = res.recent ? `${fmtD(res.recent.start)} – ${fmtD(res.recent.end)}` : "last 28 days";
  const pri = res.prior ? `${fmtD(res.prior.start)} – ${fmtD(res.prior.end)}` : "prior 90 days";
  return (
    <div className="rca-portfolio rv-expand-panel">
      <div className="rv-eyebrow rv-dim">
        Product families · {win}: {ordered.length} ordered ({products.length} product famil{products.length === 1 ? "y" : "ies"})
        {res.testStatus.length ? ` · ${res.testStatus.length} other test${res.testStatus.length === 1 ? "" : "s"} with activity in the last 28 days` : ""}
      </div>
      <div className="rca-sub rv-dim rca-tiny">
        Orders and expected follow the tab ({win}).{" "}
        {res.isNew ? "New this year, so no baseline and nothing expected." : "Expected is this clinic's baseline-period orders scaled to the window. A family needs 3 or more baseline orders to have an expectation, and 1 or more expected in the tab to show an Order Δ."}
      </div>
      <div className="rca-sub rv-dim rca-tiny">
        Status is separate and does not change with the tab: the last 28 days ({rec}) against the prior 90 days ({pri}), tracked per test.
      </div>
      {res.rows.length ? (
        <table className="rca-table rca-table-sub">
          <thead>
            <tr>
              <th>Family</th>
              <th className="rca-num" title={`Orders in ${win}`}>Orders · {win}</th>
              <th className="rca-num">Order Δ</th>
              <th title={`Last 28 days (${rec}) vs the prior 90 days (${pri})`}>Status ⓘ</th>
              <th className="rca-num" title="Prior 90 days, per 28 days → last 28 days">Prior 90d (per 28d) → last 28d</th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map(r => (
              <tr key={r.family}>
                <td>
                  {r.family}
                  {r.product === false ? <span className="rv-dim"> · not a product family</span> : null}
                </td>
                <td className="rca-num">
                  {r.orders.toFixed(0)}
                  {res.isNew ? <span className="rv-dim"> · no baseline</span> : r.expectation === "none" ? <span className="rv-dim"> · nothing expected</span> : r.expectation === "low" ? <span className="rv-dim"> vs &lt;1</span> : <span className="rv-dim"> vs {r.expectedOrders.toFixed(0)}</span>}
                </td>
                <td className={`rca-num ${res.isNew || r.expectation !== "ok" ? "rv-dim" : r.orderDelta < 0 ? "bad" : "good"}`}>{res.isNew || r.expectation !== "ok" ? "—" : `${r.orderDelta >= 0 ? "+" : ""}${r.orderDelta.toFixed(0)}`}</td>
                <td>{r.status ? <span className={`rca-status is-${r.status.toLowerCase()}`} title={r.lastBefore ? `Ordered before, last on ${fmtD(r.lastBefore)}; none in the prior 90 days, then again in the last 28` : undefined}>{r.status}</span> : <span className="rv-dim">—</span>}{r.lastBefore ? <span className="rv-dim"> · last {fmtD(r.lastBefore)}</span> : null}</td>
                <td className="rca-num rv-dim">{r.status ? `${r.baselineAvg.toFixed(1)} → ${r.recentOrders.toFixed(0)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="rca-sub rv-dim">No families ordered in {win}.</div>
      )}
      {res.testStatus.length ? (
        <>
          <div className="rv-eyebrow rv-dim" style={{ marginTop: 10 }}>Other tests with activity in the last 28 days ({rec})</div>
          <table className="rca-table rca-table-sub">
            <thead>
              <tr>
                <th>Test</th>
                <th>Status ⓘ</th>
                <th className="rca-num" title="Prior 90 days, per 28 days → last 28 days">Prior 90d (per 28d) → last 28d</th>
              </tr>
            </thead>
            <tbody>
              {res.testStatus.map(t => (
                <tr key={t.test}>
                  <td>{t.test}</td>
                  <td><span className={`rca-status is-${t.status.toLowerCase()}`}>{t.status}</span>{t.lastBefore ? <span className="rv-dim"> · last {fmtD(t.lastBefore)}</span> : null}</td>
                  <td className="rca-num rv-dim">{t.baselineAvg.toFixed(1)} → {t.recentOrders.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

/** Rep-scoped "providers" panel — the customers/providers ordering inside
 * this clinic, same `families.customersAction` the main dashboard uses. */
function RepCustomerTable({ clinic, periodId }: { clinic: string; periodId: string }) {
  const run = useRcaAction(api.families.customersAction);
  const [rows, setRows] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    run({ password: pw(), clinic, periodId })
      .then(r => {
        if (live) setRows(r.rows);
      })
      .catch(e => {
        if (live) setError(String(e).slice(0, 160));
      });
    return () => {
      live = false;
    };
  }, [run, clinic, periodId]);

  if (error) return <div className="rca-sub rv-dim">{error}</div>;
  if (rows === null) return <div className="rca-sub rv-dim">Loading providers…</div>;
  if (rows.length === 0) return <div className="rca-sub rv-dim">No provider detail for this period.</div>;
  return (
    <div className="rv-expand-panel">
      <div className="rv-eyebrow rv-dim">Providers ordering in this clinic</div>
      <table className="rca-table rca-table-sub">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Type</th>
            <th className="rca-num">Expected</th>
            <th className="rca-num">Actual</th>
            <th className="rca-num">Orders</th>
            <th className="rca-num">AOV</th>
            <th className="rca-num">Last order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c: Book) => (
            <tr key={c.customerId}>
              <td>{c.hubspot ? <a className="rca-link" href={c.hubspot} target="_blank" rel="noreferrer">{c.name} ↗</a> : c.name}</td>
              <td>{c.type}</td>
              <td className="rca-num">{K(c.expected)}</td>
              <td className="rca-num">{K(c.revenue)}</td>
              <td className="rca-num">{c.orders.toFixed(0)} <span className="rv-dim">vs {c.expectedOrders.toFixed(0)}</span></td>
              <td className="rca-num">{K(c.aov)}</td>
              <td className="rca-num rv-dim">{c.lastOrder}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Digital-footprint OSINT note — a static per-clinic lookup, same one the
 * main dashboard's expandable clinic row shows. */
function RepFootprintNote({ clinic }: { clinic: string }) {
  const note = CLINIC_FOOTPRINTS[clinic];
  if (!note) return null;
  return (
    <div className="rca-masknote rv-expand-panel">
      <div className="rv-eyebrow rv-dim">Digital footprint (OSINT, {note.confidence === "solid" ? "verified" : "tentative"})</div>
      <div>{note.finding}</div>
      <div style={{ marginTop: 4 }}>
        <strong>Likely cause:</strong> {note.cause}
      </div>
    </div>
  );
}

/** Clinic list opened from a shortfall-tree branch or a Great Job stat
 * (Shyam, 2026-09-28 rounds 3-5) — renders inline below the tree, not a
 * modal, using the same `rca-table` markup the main dashboard's "Clinics
 * behind this number" panel uses. Round 5: added the health/portfolio-status
 * filter bar and search the main dashboard's clinic lists have, and clicking
 * a row expands/collapses the full clinic card (portfolio, providers,
 * digital footprint) in place instead of opening a separate modal. */
function FocusTable({
  label,
  rows,
  onClose,
  periodId,
  sales,
  detail,
}: {
  label: string;
  detail?: (clinic: string) => string;
  rows: Array<{
    rank: number;
    clinic: string;
    name: string;
    state: string;
    cohort: string;
    health?: string[];
    pstatus?: string[];
    actual: number;
    expected: number;
    baseline?: number;
    realChange?: number;
    ambition?: number;
    delta: number;
    orders: number;
    expectedOrders: number;
    orderDelta: number;
    aov: number;
    baseAov: number;
    aovDelta: number;
    bundleShare: number;
    baseBundleShare: number;
    bundleDelta: number;
  }> | null;
  onClose: () => void;
  periodId: string;
  sales: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [health, setHealth] = useState("");
  const [pstatus, setPstatus] = useState("");

  const healthOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) for (const h of r.health ?? []) m.set(h, (m.get(h) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const pstatusOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) for (const p of r.pstatus ?? []) m.set(p, (m.get(p) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const q = term.trim().toLowerCase();
  const filtered = (rows ?? []).filter(
    r =>
      (!health || (r.health ?? []).includes(health)) &&
      (!pstatus || (r.pstatus ?? []).includes(pstatus)) &&
      (!q || r.name.toLowerCase().includes(q)),
  );

  return (
    <section className="rca-card rca-drill rv-focus-table">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">Clinics behind this number</div>
          <div className="rca-drill-title">{label}</div>
          <div className="rca-sub">
            {rows ? `${rows.length} clinics · same rows the number above is built from` : "Loading clinic detail…"}
          </div>
        </div>
        <div className="rca-drill-actions">
          <button type="button" className="rca-tab" onClick={onClose}>
            close
          </button>
        </div>
      </div>
      {rows ? (
        rows.length === 0 ? (
          <p className="rv-dim">No clinics in this branch.</p>
        ) : (
          <>
            <div className="rca-filters">
              <span className="rca-filter-label">Filter</span>
              <input
                className="rca-search-input rca-filter-search"
                placeholder="Find clinic in this list…"
                value={term}
                onChange={e => setTerm(e.target.value)}
              />
              <select className="rca-select" value={health} onChange={e => setHealth(e.target.value)}>
                <option value="">Health · any</option>
                {healthOptions.map(([v, n]) => (
                  <option key={v} value={v}>{v} ({n})</option>
                ))}
              </select>
              <select className="rca-select" value={pstatus} onChange={e => setPstatus(e.target.value)} title="Portfolio status: the last 28 days vs the prior 90 days">
                <option value="">Portfolio status · any</option>
                {pstatusOptions.map(([v, n]) => (
                  <option key={v} value={v}>{v} ({n})</option>
                ))}
              </select>
              {health || pstatus || q ? (
                <>
                  <button type="button" className="rca-tab" onClick={() => { setHealth(""); setPstatus(""); setTerm(""); }}>
                    clear
                  </button>
                  <span className="rca-filter-note">{filtered.length} of {rows.length} listed clinics</span>
                </>
              ) : null}
            </div>
            <div className="rca-table-wrap">
              <table className="rca-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Clinic</th>
                    <th>State</th>
                    <th>Cohort</th>
                    <th className="rca-num" title="Mean run rate over the baseline window">Baseline</th>
                    <th className="rca-num" title="Baseline plus the stretch: the yearly target spread over the year by baseline weekday weights">Goal</th>
                    <th className="rca-num">Actual</th>
                    <th className="rca-num">Orders</th>
                    <th className="rca-num">Order Δ</th>
                    <th className="rca-num">AOV</th>
                    <th className="rca-num">AOV Δ</th>
                    <th className="rca-num">Bundle %</th>
                    <th className="rca-num">Bundle Δ</th>
                    <th className="rca-num" title="Actual minus baseline: what the clinic did compared with what it normally does">vs baseline</th>
                    <th className="rca-num" title="Actual minus goal = change vs baseline plus the goal stretch">vs Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <Fragment key={r.clinic}>
                      <tr
                        className={`rv-focus-tr${expanded === r.clinic ? " is-open" : ""}`}
                        onClick={() => setExpanded(cur => (cur === r.clinic ? null : r.clinic))}
                      >
                        <td>{r.rank}</td>
                        <td>
                          <span className="rca-chevron">{expanded === r.clinic ? "▾" : "▸"}</span> {r.name}
                          {detail ? <small className="rv-rowdetail">{detail(r.clinic)}</small> : null}
                        </td>
                        <td>{r.state}</td>
                        <td>{COHORT[r.cohort] ?? r.cohort}</td>
                        <td className="rca-num">{r.baseline !== undefined ? K(r.baseline) : "—"}</td>
                        <td className="rca-num">{K(r.expected)}</td>
                        <td className="rca-num">{K(r.actual)}</td>
                        <td className="rca-num">{r.orders.toFixed(0)}</td>
                        <td className={`rca-num ${r.orderDelta < 0 ? "bad" : "good"}`}>{r.orderDelta > 0 ? "+" : ""}{r.orderDelta.toFixed(1)}</td>
                        <td className="rca-num">{K(r.aov)}</td>
                        <td className={`rca-num ${r.aovDelta < 0 ? "bad" : "good"}`}>{SK(r.aovDelta)}</td>
                        <td className="rca-num">{P(r.bundleShare)}</td>
                        <td className={`rca-num ${r.bundleDelta < 0 ? "bad" : "good"}`}>{r.bundleDelta > 0 ? "+" : ""}{(r.bundleDelta * 100).toFixed(1)}pp</td>
                        <td className={`rca-num ${(r.realChange ?? 0) < 0 ? "bad" : "good"}`}>{r.realChange !== undefined ? SK(r.realChange) : "—"}</td>
                        <td className={`rca-num ${r.delta < 0 ? "bad" : "good"}`}>{SK(r.delta)}</td>
                      </tr>
                      {expanded === r.clinic ? (
                        <tr className="rca-subrow">
                          <td colSpan={15}>
                            <ExpandedClinicCard clinic={r.clinic} periodId={periodId} sales={sales} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <div className="rv-loading">Loading…</div>
      )}
    </section>
  );
}

/** Fetches one clinic's full detail for the in-place expand row (rather than
 * reusing the parent's list row, which doesn't carry every field the card
 * needs — first/last order, touch dates, etc.). */
function ExpandedClinicCard({ clinic, periodId, sales, winLabel }: { clinic: string; periodId: string; sales: string; winLabel?: string }) {
  const detailQ = useRcaQuery(
    api.repView.clinicDetail,
    sales ? { password: pw(), periodId, sales, clinic } : "skip",
  );
  if (!detailQ) return <div className="rv-loading">Loading {clinic}…</div>;
  if (detailQ.ready === false) {
    return <div className="rv-loading">No data for this clinic in {winLabel ?? "this window"}. Try a wider window.</div>;
  }
  return (
    <div className="rv-expand-card">
      <ClinicCardBody detail={detailQ} periodId={periodId} winLabel={winLabel} />
    </div>
  );
}


type ProvHit = {
  customerId: string; name: string; type: string; clinic: string; clinicName: string;
  state: string; sales: string; revenue: number; orders: number; patients: number; aov: number;
  expected: number; expectedOrders: number; delta: number; orderDelta: number;
  lastOrder: string; hubspot: string; health: string[];
};

/** Left-pane search results (Shyam, 2026-09-29): the top "Search clinic" /
 * "Search provider" boxes land here, scoped to this rep's book, and each hit
 * opens the same full clinic card used when a clinic-list row is expanded. */
type SearchSel = { kind: "c"; clinic: string; name: string } | { kind: "p"; hit: ProvHit };
function searchKey(s: SearchSel | null) { return !s ? null : s.kind === "c" ? `c:${s.clinic}` : `p:${s.hit.customerId}:${s.hit.clinic}`; }

function SearchDetailPage({ sel, periodId, winLabel, sales, onBack }: { sel: SearchSel; periodId: string; winLabel: string; sales: string; onBack: () => void }) {
  const run = useRcaAction(api.families.providerSearch);
  const [pr, setPr] = useState<ProvHit | null | "none">(null);
  const hit = sel.kind === "p" ? sel.hit : null;
  useEffect(() => {
    if (!hit) return;
    let live = true;
    setPr(null);
    run({ password: pw(), term: hit.name, periodId })
      .then(x => { if (live) setPr(((x.rows as ProvHit[]).find(y => y.customerId === hit.customerId)) ?? "none"); })
      .catch(() => live && setPr("none"));
    return () => { live = false; };
  }, [hit?.customerId, hit?.name, periodId, run]);
  const r = hit ? (pr && pr !== "none" ? pr : { ...hit, revenue: 0, orders: 0, patients: 0, aov: 0, expected: 0, expectedOrders: 0, delta: 0, orderDelta: 0 }) : null;
  return (
    <div className="rv-sd-page">
      <button type="button" className="rv-sd-back" onClick={onBack}>← Back to dashboard</button>
      <div className="rv-sd-win">Window: <b>{winLabel}</b> <span>· switch tabs on the left to change it; consult/VCT history is all-time</span></div>
      {sel.kind === "c" ? (
        <>
          <div className="rv-eyebrow">Clinic · #{sel.clinic}</div>
          <h1 className="rv-h1">{sel.name}</h1>
          <div className="rv-rs-card"><ExpandedClinicCard clinic={sel.clinic} periodId={periodId} sales={sales} winLabel={winLabel} /></div>
        </>
      ) : r ? (
        <div className="rv-rs-card">
          {pr === null ? <p className="rv-dim">Loading {winLabel} numbers…</p> : pr === "none" ? <p className="rv-dim">No orders or baseline for this provider in {winLabel}.</p> : null}
          <div className="rv-eyebrow">Provider · #{r.customerId} · {r.type}</div>
                    <h2 className="rv-modal-h">{r.name}</h2>
                    <div className="rv-ch-hero">
                      <div className={`rv-ch-hero-v ${r.delta < 0 ? "bad" : "good"}`}>{SK(r.delta)}</div>
                      <div className="rv-ch-hero-l">vs goal · {winLabel} · {K(r.expected)} goal</div>
                    </div>
                    <div className="rv-rs-grid">
                      <div><span>Actual · {winLabel}</span><b>{K(r.revenue)}</b></div>
                      <div><span>Expected · {winLabel}</span><b>{K(r.expected)}</b></div>
                      <div><span>Orders · {winLabel}</span><b>{r.orders} <small>vs {Math.round(r.expectedOrders)}</small></b></div>
                      <div><span>Order Δ</span><b>{r.orderDelta >= 0 ? "+" : ""}{Math.round(r.orderDelta)}</b></div>
                      <div><span>AOV · {winLabel}</span><b>${Math.round(r.aov).toLocaleString()}</b></div>
                      <div><span>Patients · {winLabel}</span><b>{r.patients}</b></div>
                      <div><span>Last order · {winLabel}</span><b>{r.lastOrder || "—"}</b></div>
                      <ClinicalRows provider={r.customerId} />
                      <div><span>HubSpot</span><b>{r.hubspot ? <a href={r.hubspot} target="_blank" rel="noreferrer">open</a> : "—"}</b></div>
                    </div>
                    {r.health?.length ? <div className="rv-rs-tags">{r.health.map(h => <span key={h}>{h}</span>)}</div> : null}
                    <div className="rv-rs-label" style={{ marginTop: 14 }}>Their clinic</div>
                    <ExpandedClinicCard clinic={r.clinic} periodId={periodId} sales={sales} winLabel={winLabel} />
        </div>
      ) : null}
    </div>
  );
}

function RailSearch({ clinicTerm, provTerm, sales, onClear, selKey, onOpen }: {
  clinicTerm: string; provTerm: string; sales: string; onClear?: () => void; selKey: string | null; onOpen: (s: SearchSel | null) => void;
}) {
  const cq = clinicTerm.trim();
  const pq = provTerm.trim();
  const open = selKey;
  const clinics = useRcaQuery(api.feed.clinicSearch, cq.length >= 2 ? { term: cq, password: pw() } : "skip");
  const run = useRcaAction(api.families.providerSearch);
  const [provs, setProvs] = useState<ProvHit[] | null>(null);
  const [provErr, setProvErr] = useState<string | null>(null);
  useEffect(() => {
    setProvs(null);
    setProvErr(null);
    if (pq.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      run({ password: pw(), term: pq })
        .then(r => { if (live) setProvs(r.rows as ProvHit[]); })
        .catch(e => { if (live) setProvErr(String(e).slice(0, 140)); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [pq, run]);
  if (cq.length < 2 && pq.length < 2) return null;
  const cHits = ((clinics?.matches ?? []) as any[]).filter(m => !sales || m.sales === sales);
  const pHits = (provs ?? []).filter(r => !sales || r.sales === sales);
  return (
    <div className="rv-rail-sec rv-rail-search">
      <div className="rv-rail-search-h">
        <div className="rv-eyebrow">Search results<Info k="search" /></div>
        {onClear ? <button type="button" onClick={onClear}>clear ✕</button> : null}
      </div>
      {!sales ? <p className="rv-dim">Pick a rep to search their book.</p> : null}
      {sales && cq.length >= 2 ? (
        <div className="rv-rs-group">
          <div className="rv-rs-label">Clinics · “{cq}”</div>
          {clinics === undefined ? <p className="rv-dim">Searching…</p> : cHits.length === 0 ? (
            <p className="rv-dim">No clinic in this book matches.</p>
          ) : cHits.map(m => {
            const k = `c:${m.clinic}`;
            return (
              <Fragment key={k}>
                <button type="button" className={`rv-rs-hit${open === k ? " is-on" : ""}`} onClick={() => onOpen(open === k ? null : { kind: "c", clinic: m.clinic, name: m.name })}>
                  <span><b>{m.name}</b><em>#{m.clinic} · {m.state}</em></span>
                  <strong className={`rv-rs-d ${m.delta < 0 ? "bad" : "good"}`}>{SK(m.delta)}</strong>
                </button>
                              </Fragment>
            );
          })}
        </div>
      ) : null}
      {sales && pq.length >= 2 ? (
        <div className="rv-rs-group">
          <div className="rv-rs-label">Providers · “{pq}”</div>
          {provErr ? <p className="rv-dim">{provErr}</p> : provs === null ? <p className="rv-dim">Searching providers…</p> : pHits.length === 0 ? (
            <p className="rv-dim">No provider in this book matches.</p>
          ) : pHits.map(r => {
            const k = `p:${r.customerId}:${r.clinic}`;
            return (
              <Fragment key={k}>
                <button type="button" className={`rv-rs-hit${open === k ? " is-on" : ""}`} onClick={() => onOpen(open === k ? null : { kind: "p", hit: r })}>
                  <span><b>{r.name}</b><em>{r.clinicName} · {r.type}</em></span>
                  <strong className={`rv-rs-d ${r.delta < 0 ? "bad" : "good"}`}>{SK(r.delta)}</strong>
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RecentSearches({ items, selKey, onOpen, onClear }: { items: SearchSel[]; selKey: string | null; onOpen: (s: SearchSel) => void; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="rv-rail-sec rv-rail-search">
      <div className="rv-rail-search-h">
        <div className="rv-eyebrow">Recent searches<Info k="recent" /></div>
        <button type="button" onClick={onClear}>clear ✕</button>
      </div>
      {items.map(it => {
        const k = searchKey(it)!;
        return (
          <button type="button" key={k} className={`rv-rs-hit${selKey === k ? " is-on" : ""}`} onClick={() => onOpen(it)}>
            {it.kind === "c" ? (
              <span><b>{it.name}</b><em>Clinic · #{it.clinic}</em></span>
            ) : (
              <span><b>{it.hit.name}</b><em>Provider · {it.hit.clinicName}</em></span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type CT = { n: number; last: string } | null;
function ClinicalRows({ clinic, provider }: { clinic?: string; provider?: string }) {
  const run = useRcaAction(api.clinicalTouch.clinicalTouch);
  const [d, setD] = useState<{ consult: CT; training: CT } | null | "err">(null);
  useEffect(() => {
    let live = true;
    setD(null);
    run({ password: pw(), clinic, provider }).then(r => live && setD(r)).catch(() => live && setD("err"));
    return () => { live = false; };
  }, [clinic, provider, run]);
  const cell = (x: CT) => d === null ? "…" : d === "err" ? "unavailable" : !x ? "No" : `Yes · last ${fmtD(x.last)}${x.last.slice(0, 4) !== String(new Date().getFullYear()) ? ", " + x.last.slice(0, 4) : ""} (${x.n})`;
  const c = d && d !== "err" ? d.consult : null;
  const t = d && d !== "err" ? d.training : null;
  return (
    <>
      <div><span>Clinical consult</span><b className={c ? "good" : ""}>{cell(c)}</b></div>
      <div><span>VCT (clinical training)</span><b className={t ? "good" : ""}>{cell(t)}</b></div>
    </>
  );
}

type EffortWin = {
  start: string; touched: number; touchedRe: number; untouched: number; untouchedRe: number; idle: number;
  touchedIds: string[]; touchedReIds: string[]; untouchedIds: string[]; idleIds: string[]; touchGaps?: (number | null)[];
};
/** The "Order within X days of touch" choice is shared: the Touch effort cards and the Great Job line read the same value. */
const touchDays = { v: 0, subs: new Set<() => void>() };
function useTouchDays(): [number, (n: number) => void] {
  const v = useSyncExternalStore(
    cb => { touchDays.subs.add(cb); return () => { touchDays.subs.delete(cb); }; },
    () => touchDays.v,
  );
  return [v, n => { touchDays.v = n; for (const f of touchDays.subs) f(); }];
}
/** Today KPI strip (Shyam, 2026-09-30): touch effort for this week / month /
 * quarter, picked with chips. Each card opens the standard clinic list. */
/** One row of touch-effort cards for one group of clinics (existing, or new business). */
function TouchRow({ label, e0, pool, cur, sales, xd, WL, open }: {
  label: string; e0: EffortWin | undefined; pool: "existing" | "new";
  cur: { periodId: string } | null; sales: string; xd: number; WL: string; open: (ids: string[], label: string) => void;
}) {
  const e = e0 && xd && e0.touchGaps ? (() => {
    const re = e0.touchedIds.filter((_, i) => { const g = e0.touchGaps![i]; return g != null && g <= xd; });
    return { ...e0, touchedRe: re.length, touchedReIds: re };
  })() : e0;
  const teamQ = useRcaQuery(
    api.repView.teamEffort,
    sales && cur && e0 ? { password: pw(), periodId: cur.periodId, sales, start: e0.start, within: xd || undefined, pool } : "skip",
  );
  const tm = teamQ?.ready && teamQ.lead ? teamQ : null;
  const vs = (mine: number, team: number | undefined, fmt: (x: number) => string, higherGood = true) =>
    team == null ? null : (
      <span className={`rv-kpi-team ${(mine >= team) === higherGood ? "good" : "bad"}`}>team avg {fmt(team)}</span>
    );
  const tr = e && e.touched ? e.touchedRe / e.touched : 0;
  const ur = e && e.untouched ? e.untouchedRe / e.untouched : 0;
  const lift = (tr - ur) * 100;
  const Card = ({ v, l, sub, ids, cls, team }: { v: string; l: string; sub: string; ids?: string[]; cls?: string; team?: React.ReactNode }) => (
    <button type="button" className={`rv-kpi ${cls ?? ""}`} disabled={!ids?.length} onClick={() => ids && open(ids, `${l} · ${label} · ${WL}`)}>
      <span className="rv-kpi-l">{l}</span>
      <b className="rv-kpi-v">{v}</b>
      <span className="rv-kpi-s">{sub}</span>
      {team}
    </button>
  );
  return (
    <>
      <div className="rv-touch-sub">{label}{tm ? ` · vs ${tm.lead}'s team avg (${tm.reps} reps)` : ""}</div>
      {!e ? <p className="rv-dim">Loading…</p> : (
        <div className="rv-kpis">
          <Card l="Touched" v={String(e.touched)} sub="clinics with a call/meeting" ids={e.touchedIds} team={vs(e.touched, tm?.touched, x => x.toFixed(0))} />
          <Card l="Touched reorder" v={P(tr, 0)} sub={`${e.touchedRe} reordered ${xd ? `within ${xd}d of` : "after"} the touch`} ids={e.touchedReIds} cls={tr >= ur ? "good" : ""} team={vs(tr, tm?.tr, x => P(x, 0))} />
          <Card l="Untouched" v={String(e.untouched)} sub={`${P(ur, 0)} reordered anyway`} ids={e.untouchedIds} team={vs(e.untouched, tm?.untouched, x => x.toFixed(0), false)} />
          <Card l="Lift" v={`${lift >= 0 ? "+" : ""}${lift.toFixed(0)} pts`} sub="touched vs untouched reorder rate" cls={lift >= 0 ? "good" : "bad"} team={vs(lift, tm?.lift, x => `${x >= 0 ? "+" : ""}${x.toFixed(0)} pts`)} />
          <Card l="Idle" v={String(e.idle)} sub="no touch and no order" ids={e.idleIds} cls={e.idle ? "bad" : ""} team={vs(e.idle, tm?.idle, x => x.toFixed(0), false)} />
        </div>
      )}
    </>
  );
}

function TouchKpis({ sales, src, w }: {
  sales: string;
  w: "week" | "month" | "quarter";
  src: Record<"week" | "month" | "quarter", { e: EffortWin & { ex?: EffortWin; nw?: EffortWin }; periodId: string } | null>;
}) {
  const [focus, setFocus] = useState<{ focus: string; label: string } | null>(null);
  const cur = src[w];
  const rowsQ = useRcaQuery(
    api.repView.rowsByFocus,
    sales && focus && cur ? { password: pw(), periodId: cur.periodId, sales, focus: focus.focus } : "skip",
  );
  useEffect(() => setFocus(null), [w]);
  const WL = { week: "This week", month: "This month", quarter: "This quarter" }[w];
  const [xd, setXd] = useTouchDays();
  const e0 = cur?.e;
  const open = (ids: string[], label: string) =>
    ids.length && setFocus(f => (f?.label === label ? null : { focus: `ids:${ids.join(",")}`, label }));
  return (
    <div className="rv-kpis-wrap">
      <div className="rv-sec-head" style={{ marginTop: 0 }}>
        <div className="rv-eyebrow">Touch effort · {WL}{e0 ? ` (since ${fmtD(e0.start)})` : ""}<Info k="touch" /></div>
        <label className="rv-dim" style={{ marginLeft: 12 }}>Order within{" "}
          <select value={xd} onChange={ev => { setXd(Number(ev.target.value)); setFocus(null); }}>
            {[0, 7, 14, 21, 30, 45, 60].map(d => <option key={d} value={d}>{d ? `${d} days` : "any time"}</option>)}
          </select>{" "}of touch
        </label>
      </div>
      <HowCalc>
        <p>The same five figures twice: for existing clinics (not new, with a baseline), and for new business (this year's new clinics plus returning ones). <b>Touched:</b> clinics with a call or meeting on or after the window's start. <b>Touched reorder:</b> those that ordered on or after the touch ("Order within" counts only orders inside that many days). <b>Untouched:</b> clinics with no touch, and the share that ordered in the window anyway. <b>Idle:</b> no touch and no order. <b>Lift:</b> touched rate minus untouched rate.</p>
        <p>The team average is the same figures for every rep under the same team lead, averaged rep by rep, for the same group of clinics.</p>
      </HowCalc>
      {!e0 ? <p className="rv-dim">Loading {WL.toLowerCase()}…</p> : (
        <>
          <TouchRow label="Existing clinics" pool="existing" e0={e0.ex} cur={cur} sales={sales} xd={xd} WL={WL} open={open} />
          <TouchRow label="New clinics (this year's new and returning)" pool="new" e0={e0.nw} cur={cur} sales={sales} xd={xd} WL={WL} open={open} />
        </>
      )}
      {focus ? (
        <FocusTable label={focus.label} rows={rowsQ?.ready ? rowsQ.rows : null} onClose={() => setFocus(null)} periodId={cur?.periodId ?? ""} sales={sales} />
      ) : null}
    </div>
  );
}

/* ───────────── Opportunity agenda · My week plan · Next best action (Shyam, 2026-10-05) ─────────────
 * Five cards = the scorecard's Opportunity column. Only At-risk and Low-AOV are computable from RCA
 * data; Unconverted prospects / Product whitespace / Cross-sell need CRM or clinic×product history and
 * show as "not in data yet" (never invented). Hours and likelihoods below are planning estimates. */
type PlanState = { sellHours: number; weighted: boolean; pins: Record<string, "in" | "out">; /** hours the rep set for an action, replacing the estimate */ hrs?: Record<string, number> };
type PKey = "New Business" | "Bundle growth" | "Product Growth" | "Retention" | "Expansion";
const PILLAR_COLOR: Record<PKey, string> = {
  "New Business": "#9aa4b2", "Bundle growth": "#5b6b82", "Product Growth": "#3b82f6", Retention: "#1d4ed8", Expansion: "#0f172a",
};
const WEIGHT: Record<string, number> = { behind: 1.5, watch: 1.15, good: 1 };
const hrsFor = (n: number, per: number) => Math.max(1, Math.min(10, Math.ceil(n * per)));

type ActionRow = { est?: number; ids?: string[]; id: string; p: PKey; label: string; detail: string; hrs: number; up: number; pr: number; exp: number; score: number; inPlan?: boolean };

/** What each action's upside dollars are (weekly), shown in the plan's "how expected revenue is calculated" panel. */
const UPSIDE_BASIS: Record<string, string> = {
  callFirst: "What these clinics are short of their goal this week (goal minus actual), top 25 by dollars",
  atRisk: "How far below baseline these clinics are, top 25",
  churned: "Half the weekly baseline revenue of the biggest clinics that went quiet in the last 6 months",
  nearChurn: "One typical new-clinic order for each new clinic silent 30-44 days",
  secondOrder: "One typical new-clinic order for each new clinic with a single order",
  nurture: "One typical new-clinic order for each new clinic on orders 2-3",
  returning: "A quarter of what the biggest returning clinics ordered this week (keeping them ordering)",
  lowAov: "The gap between $400 and each clinic's average order, times its orders, top 25",
  followUp: "Weekly baseline revenue of clinics you touched this week that have not reordered",
  idle: "Weekly baseline revenue of the 15 biggest untouched clinics with no order this week",
  gap: "The shortfall against goal of the few clinics that make up 60% of this week's gap",
  stopped: "Half the weekly baseline revenue of each product the clinic STOPPED ordering",
  declining: "A quarter of the weekly baseline revenue of each product ordered at half its usual rate",
  famBelow: "Orders below expected for the target product, times its revenue per order",
  famAdopt: "One order of the target product at its revenue per order, per new clinic ordering other Zoomers",
  famRepeat: "One more order of the target product per clinic that ordered it once",
  whitespace: "One order of the target product per clinic you marked eligible",
  crosssell: "A quarter of each clinic's per-family spend (one more family at today's rate)",
};

/** Likelihood a touched clinic orders, from this rep's own touch record over the quarter (shrunk toward 50% when the
 * sample is small); the fixed guesses it replaces were 0.5-0.7. Returns the base rate and where it came from. */
function touchRate(b: Book): { pr: number; n: number; own: number | null } {
  const e = b.effortWin?.quarter;
  const n = e?.touched ?? 0, re = e?.touchedRe ?? 0;
  return { pr: (re + 0.5 * 20) / (n + 20), n, own: n ? re / n : null };
}

/** Product actions from the status model (STOPPED / DECLINING per test) and the product mix. Dollars are weekly. */
function productActions(b: Book, pgd: ReturnType<typeof usePG>, famName: string): Array<Omit<ActionRow, "exp" | "score" | "pr"> & { prMul: number }> {
  const d = pgd.data as ({ clinics: PGClinic[]; baseWeeks?: number } | null);
  if (!d || !d.baseWeeks) return [];
  const wk = d.baseWeeks;
  const out: Array<Omit<ActionRow, "exp" | "score" | "pr"> & { prMul: number }> = [];
  const famsOfClinic = (c: PGClinic) => Object.keys(c.base ?? {});
  // Weekly baseline revenue of the families a clinic stopped / is declining on (test names run longer than the family name).
  const lost = (status: string) => {
    const hit: Array<{ c: PGClinic; up: number }> = [];
    for (const c of d.clinics) {
      if (c.isNew) continue;
      let up = 0;
      for (const [t, st] of c.tests ?? []) {
        if (st !== status) continue;
        const f = famsOfClinic(c).find(x => t.toLowerCase().startsWith(x.toLowerCase()));
        if (f) up += (c.baseRev?.[f] ?? 0) / wk;
      }
      if (up > 0) hit.push({ c, up });
    }
    return hit.sort((a, b2) => b2.up - a.up).slice(0, 25);
  };
  const stopped = lost("STOPPED"), declining = lost("DECLINING");
  if (stopped.length) out.push({ ids: stopped.map(x => x.c.clinic), id: "stopped", p: "Retention", label: "Win back stopped products", detail: `${stopped.length} clinics STOPPED a product they ordered 3+ times`, hrs: hrsFor(stopped.length, 0.3), up: 0.5 * stopped.reduce((t, x) => t + x.up, 0), prMul: 0.8 });
  if (declining.length) out.push({ ids: declining.map(x => x.c.clinic), id: "declining", p: "Retention", label: "Re-engage declining products", detail: `${declining.length} clinics ordering a product at half its usual rate`, hrs: hrsFor(declining.length, 0.25), up: 0.25 * declining.reduce((t, x) => t + x.up, 0), prMul: 0.9 });
  // Target product (the scorecard's default family): below expected, adoption gaps, single orders.
  const fam = famName;
  const famRev = d.clinics.reduce((t, c) => t + (c.baseRev?.[fam] ?? 0), 0), famOrd = d.clinics.reduce((t, c) => t + (c.base?.[fam] ?? 0), 0);
  const perOrder = famOrd ? famRev / famOrd : 0;
  const below = d.clinics.map(c => ({ c, gap: famExpected(c, fam) - (c.win[fam] ?? 0) })).filter(x => famExpected(x.c, fam) >= 1 && x.gap > 0.5).sort((a, b2) => b2.gap - a.gap).slice(0, 25);
  if (below.length) out.push({ ids: below.map(x => x.c.clinic), id: "famBelow", p: "Product Growth", label: `Lift ${fam} orders`, detail: `${below.length} clinics below their expected ${fam} orders`, hrs: hrsFor(below.length, 0.2), up: below.reduce((t, x) => t + x.gap, 0) * perOrder, prMul: 1 });
  const newOrdering = d.clinics.filter(c => (b.newIds ?? []).includes(c.clinic) && Object.keys(c.win).some(f => f !== "Unmapped" && f !== NON_ZOOMER && c.win[f] > 0) && !((c.win[fam] ?? 0) > 0));
  if (newOrdering.length) out.push({ ids: newOrdering.map(c => c.clinic), id: "famAdopt", p: "Product Growth", label: `Introduce ${fam} to new clinics`, detail: `${newOrdering.length} new clinics ordering other Zoomers, not ${fam}`, hrs: hrsFor(newOrdering.length, 0.2), up: newOrdering.length * perOrder, prMul: 0.8 });
  const once = d.clinics.filter(c => (c.win[fam] ?? 0) === 1);
  if (once.length) out.push({ ids: once.map(c => c.clinic), id: "famRepeat", p: "Product Growth", label: `Ask for the ${fam} repeat`, detail: `${once.length} clinics ordered ${fam} once this week`, hrs: hrsFor(once.length, 0.15), up: once.length * perOrder, prMul: 0.9 });
  const ws = pgd.elig.filter(e => e.family === fam && !((d.clinics.find(c => c.clinic === e.clinic)?.life[fam] ?? 0) > 0));
  if (ws.length) out.push({ ids: [...new Set(ws.map(e => e.clinic))], id: "whitespace", p: "Product Growth", label: `Introduce ${fam} (whitespace)`, detail: `${new Set(ws.map(e => e.clinic)).size} clinics you marked eligible, never ordered`, hrs: hrsFor(ws.length, 0.25), up: ws.length * perOrder, prMul: 0.6 });
  const pgA = pgStats(b, d.clinics, pgd.elig, "");
  if (pgA.xs.length) out.push({ ids: pgA.xs.map(x => x.clinic), id: "crosssell", p: "Expansion", label: "Pitch a second product family", detail: `${pgA.xs.length} active clinics on 1-2 families`, hrs: hrsFor(pgA.xs.length, 0.2), up: pgA.xsUp / 4, prMul: 0.6 });
  return out;
}

/** Everything the plan ranks: the scorecard's opportunity pools, the lifecycle and touch pools, and the product actions. */
function rankActions(b: Book, fams: Wins, plan: PlanState, pgd?: ReturnType<typeof usePG>, famName = "Hormone Zoomer"): ActionRow[] {
  const o = b.opp;
  if (!o) return [];
  const st = pillarStatus(b, fams);
  const tr = touchRate(b);
  const raw: Array<Omit<ActionRow, "exp" | "score" | "pr"> & { prMul: number }> = [];
  const add = (n: number | undefined, a: Omit<ActionRow, "exp" | "score" | "pr" | "hrs" | "detail"> & { detail: string; per: number; prMul: number }) => {
    if (!n) return;
    const { per, ...rest } = a;
    raw.push({ ...rest, hrs: hrsFor(n, per) });
  };
  const cf = o.callFirstPlan ?? o.callFirst;
  add(cf?.n, { ids: cf?.ids, id: "callFirst", p: "Retention", label: "Overdue reorder calls", detail: `top ${cf?.n} of ${o.callFirst?.n} overdue clinics by dollars (not churned)`, per: 0.25, up: cf?.up, prMul: 1.1 });
  const ar = o.atRiskPlan ?? o.atRisk;
  add(ar?.n, { ids: ar?.ids, id: "atRisk", p: "Retention", label: "Check in on at-risk clinics", detail: `top ${ar?.n} of ${o.atRisk?.n} at-risk clinics, ${K(ar?.up ?? 0)} below baseline`, per: 0.3, up: ar?.up, prMul: 1 });
  add(o.churned?.n, { ids: o.churned?.ids, id: "churned", p: "Retention", label: "Win back churned clinics", detail: `${o.churned?.n} biggest clinics gone quiet in the last 6 months (half their baseline counted)`, per: 0.3, up: o.churned?.up, prMul: 0.5 });
  add(o.nearChurn?.n, { ids: o.nearChurn?.ids, id: "nearChurn", p: "New Business", label: "Save new clinics near the churn line", detail: `${o.nearChurn?.n} new clinics silent 30-44 days`, per: 0.3, up: o.nearChurn?.up, prMul: 0.7 });
  add(o.secondOrder?.n, { ids: o.secondOrder?.ids, id: "secondOrder", p: "New Business", label: "Get the second order", detail: `${o.secondOrder?.n} new clinics with one order so far`, per: 0.25, up: o.secondOrder?.up, prMul: 0.9 });
  add(o.nurtureNew?.n, { ids: o.nurtureNew?.ids, id: "nurture", p: "New Business", label: "Nurture new clinics to order 4", detail: `${o.nurtureNew?.n} new clinics on orders 2-3, due for the next`, per: 0.3, up: o.nurtureNew?.up, prMul: 1 });
  add(o.returning?.n, { ids: o.returning?.ids, id: "returning", p: "New Business", label: "Make the restart stick", detail: `${o.returning?.n} biggest returning clinics ordering again`, per: 0.15, up: o.returning?.up, prMul: 1.1 });
  const la = o.lowAovPlan ?? o.lowAov;
  add(la?.n, { ids: la?.ids, id: "lowAov", p: "Bundle growth", label: "Bundle suggestion on next order", detail: `top ${la?.n} of ${o.lowAov?.n} clinics under $400 AOV`, per: 0.2, up: la?.up, prMul: 0.9 });
  // Growing clinics are not an action: they are already above baseline, so there is no gap to close. Expansion work is the second-family pitch below.
  add(o.followUp?.n, { ids: o.followUp?.ids, id: "followUp", p: "Retention", label: "Follow up touched clinics that have not reordered", detail: `${o.followUp?.n} clinics touched this week, no order since`, per: 0.2, up: o.followUp?.up, prMul: 0.8 });
  add(o.idle?.n, { ids: o.idle?.ids, id: "idle", p: "Retention", label: "First touch for the biggest idle clinics", detail: `${o.idle?.n} untouched clinics with no order this week`, per: 0.25, up: o.idle?.up, prMul: 0.7 });
  add(o.gap?.n, { ids: o.gap?.ids, id: "gap", p: "Retention", label: "Close the gap: the clinics behind goal", detail: `${o.gap?.n} clinics make up most of this week's shortfall`, per: 0.3, up: o.gap?.up, prMul: 0.5 });
  if (pgd) raw.push(...productActions(b, pgd, famName));
  const rows: ActionRow[] = raw
    .map(({ prMul, ...a0 }) => {
      const set = plan.hrs?.[a0.id];
      // `est` keeps the estimate so the page can show what the rep changed.
      const a = { ...a0, est: a0.hrs, hrs: set && set > 0 ? set : a0.hrs };
      const pr = Math.min(0.9, tr.pr * prMul);
      const exp = a.up * pr;
      const w = plan.weighted ? WEIGHT[st[a.p] ?? "good"] ?? 1 : 1;
      return { ...a, pr, exp, score: (exp / a.hrs) * w };
    })
    .sort((a, b2) => b2.score - a.score);
  let used = 0;
  for (const r of rows) if (plan.pins[r.id] === "in") { used += r.hrs; r.inPlan = true; }
  for (const r of rows) if (!r.inPlan && plan.pins[r.id] !== "out" && used + r.hrs <= plan.sellHours) { used += r.hrs; r.inPlan = true; }
  return rows;
}

/** One ranking for the Today strip and the plan page. */
function usePlanRows(b: Book | null, fams: Wins, plan: PlanState, sales: string, periodId: string): ActionRow[] {
  const pgd = usePG(sales, periodId);
  const famName = useMemo(() => {
    const t = new Map<string, number>();
    for (const c of pgd.data?.clinics ?? []) for (const [f, n] of Object.entries(c.life)) t.set(f, (t.get(f) ?? 0) + n);
    const names = [...t].filter(([f]) => f !== "Unmapped" && f !== NON_ZOOMER).sort((a, b2) => b2[1] - a[1]).map(([f]) => f);
    return names.find(f => /hormone\s*zoomer/i.test(f)) ?? names[0] ?? "Hormone Zoomer";
  }, [pgd.data]);
  return useMemo(() => (b ? rankActions(b, fams, plan, pgd, famName) : []), [b, fams, plan, pgd, famName]);
}

function NextBestAction({ rows, onPlan }: { rows: ActionRow[]; onPlan: () => void }) {
  const a = rows[0];
  if (!a) return null;
  return (
    <div className="rv-nba">
      <div className="rv-nba-main">
        <div className="rv-nba-eye">Next best action<Info k="nba" /></div>
        <div className="rv-nba-t">{a.label}</div>
        <div className="rv-nba-s">Highest weighted return in your week: {a.p} · {a.detail}.</div>
      </div>
      <div className="rv-nba-num">
        <div className="rv-nba-ph">{K(a.score)}/h</div>
        <div className="rv-nba-sub">{a.hrs}h · {K(a.exp)} expected</div>
      </div>
      <button type="button" className="rv-nba-btn" onClick={onPlan}>See my week</button>
    </div>
  );
}

const OPP_PILLAR: Record<string, string> = { atRisk: "Retention", prospects: "New Business", whitespace: "Product Growth", lowAov: "Bundle growth", crosssell: "Expansion" };

function OppAgenda({ b, st, planned, onToggle, onOpenClinic, onScorecard, sales, periodId }: {
  sales: string; periodId: string; b: Book; st?: Record<string, string>; planned: Record<string, boolean>; onToggle: (id: string) => void; onOpenClinic: (c: string) => void; onScorecard: (cell: string) => void;
}) {
  const o = b.opp;
  const pgd = usePG(sales, periodId);
  const pgA = pgd.data ? pgStats(b, pgd.data.clinics, pgd.elig, "") : null;
  const wsAll = pgd.data ? (() => {
    const byId = new Map(pgd.data.clinics.map(c => [c.clinic, c]));
    const ids = [...new Set(pgd.elig.filter(e => !((byId.get(e.clinic)?.life[e.family] ?? 0) > 0)).map(e => e.clinic))];
    return { ids, names: ids.slice(0, 3).map(id => ({ clinic: id, name: byId.get(id)?.name ?? id, v: 0 })) };
  })() : null;
  const [focus, setFocus] = useState<{ focus: string; label: string } | null>(null);
  const rowsQ = useRcaQuery(api.repView.rowsByFocus, sales && focus && periodId ? { password: pw(), periodId, sales, focus: focus.focus } : "skip");
  if (!o) return null;
  const openIds = (ids: string[] | undefined, label: string) =>
    ids?.length && setFocus(f => (f?.label === label ? null : { focus: `ids:${ids.join(",")}`, label }));
  const cards = [
    { id: "atRisk", label: "At-risk customers", n: o.atRisk.n, up: o.atRisk.up, action: "Rescue calls before the next reorder window closes.", names: o.atRisk.names, ids: o.atRisk.ids },
    { id: "prospects", label: "Unconverted prospects", na: "needs CRM lead data" },
    wsAll && wsAll.ids.length
      ? { id: "whitespace", label: "Product whitespace", n: wsAll.ids.length, up: 0, action: "Introduce the product you marked them eligible for.", names: wsAll.names, ids: wsAll.ids }
      : { id: "whitespace", label: "Product whitespace", na: "mark eligible clinics in Scorecard → Product Growth" },
    { id: "lowAov", label: "Low-AOV customers", n: o.lowAov.n, up: o.lowAov.up, action: "Suggest a bundle on the next order to lift them past $400.", names: o.lowAov.names, ids: o.lowAov.ids },
    pgA && pgA.xs.length
      ? { id: "crosssell", label: "Cross-sell candidates", n: pgA.xs.length, up: pgA.xsUp, action: "Pitch the family similar clinics already buy.", names: pgA.xs.slice(0, 3).map(x => ({ clinic: x.clinic, name: `${x.name} → ${x.suggest}`, v: x.up })), ids: pgA.xs.map(x => x.clinic) }
      : { id: "crosssell", label: "Cross-sell candidates", na: pgd.data ? "no active clinics on 1–2 families" : "loading product mix…" },
  ] as Array<{ id: string; label: string; n?: number; up?: number; action?: string; names?: Array<{ clinic: string; name: string; v: number }>; ids?: string[]; na?: string }>;
  const total = cards.reduce((s, c) => s + (c.up ?? 0), 0);
  const done = cards.reduce((s, c) => s + (planned[c.id] ? c.up ?? 0 : 0), 0);
  const dot = (id: string) => { const v = st?.[OPP_PILLAR[id]]; return v === "behind" ? "bad" : v === "watch" ? "watch" : v ? "good" : "na"; };
  return (
    <div className="rv-opp">
      <div className="rv-opp-head">
        <div>
          <h2 className="rv-opp-h">Opportunity agenda<Info k="opp" /></h2>
          <div className="rv-opp-sub">The Opportunity column of your scorecard (this week's book), turned into today's work. Add what you'll act on.</div>
        </div>
        <div className="rv-opp-tot">
          <div><b>{K(done)}</b> <span>of {K(total)} planned</span></div>
          <div className="rv-opp-sub">Total revenue opportunity on your scorecard</div>
        </div>
      </div>
      <HowCalc>
        <p>The dollar figure on each card is its upside: <b>At-risk</b> is how far those clinics are below baseline; <b>Low-AOV</b> is the gap between $400 and each clinic's average order, times its orders; <b>Cross-sell</b> is one more product family at each clinic's current per-family spend; <b>Whitespace</b> is clinics you marked eligible for the selected product that have never ordered it. The bar sizes the cards by upside, and "planned" adds up the cards you added. The My week plan tab ranks these actions, and more, by expected revenue per hour.</p>
      </HowCalc>
      <div className="rv-opp-seg">
        {cards.filter(c => c.up).map(c => (
          <i key={c.id} style={{ flex: c.up }} className={planned[c.id] ? "on" : ""} />
        ))}
      </div>
      <div className="rv-opp-grid">
        {cards.map(c => (
          <div key={c.id} className={`rv-opp-card${c.na ? " na" : ""}${planned[c.id] ? " is-planned" : ""}`}>
            <div className="rv-opp-pil"><span>{OPP_PILLAR[c.id]}</span><i className={dot(c.id)} /></div>
            <div className="rv-opp-t">{c.label}</div>
            {c.na ? (
              <>
                <div className="rv-opp-v">—</div>
                <p className="rv-opp-act">Not in data yet</p>
                <p className="rv-opp-nm">{c.na[0].toUpperCase() + c.na.slice(1)}.</p>
              </>
            ) : (
              <>
                <button type="button" className="rv-opp-v rv-opp-vbtn" title="Show clinic list" onClick={() => openIds(c.ids, `${c.label} · this week`)}>{c.n}<span>+{K(c.up ?? 0)}</span><small> clinics ↓</small></button>
                <p className="rv-opp-act">{c.action}</p>
                <p className="rv-opp-nm">
                  {(c.names ?? []).slice(0, 3).map((x, i) => (
                    <span key={x.clinic}>{i ? ", " : ""}<button type="button" onClick={() => onOpenClinic(x.clinic)}>{x.name}</button></span>
                  ))}
                  {(c.n ?? 0) > 3 ? ` and ${(c.n ?? 0) - 3} more.` : "."}
                </p>
                <div className="rv-opp-btns">
                  <button type="button" className={`rv-opp-add${planned[c.id] ? " is-on" : ""}`} onClick={() => onToggle(c.id)}>
                    {planned[c.id] ? "✓ Added" : "Add to today"}
                  </button>
                  <button type="button" className="rv-opp-link" onClick={() => onScorecard(c.label)}>See in scorecard</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {focus ? <FocusTable label={focus.label} rows={rowsQ?.ready ? rowsQ.rows : null} onClose={() => setFocus(null)} periodId={periodId} sales={sales} /> : null}
    </div>
  );
}

function WeekPlan({ b, fams, plan, onPlan, sales, periodId }: { sales: string; periodId: string; b: Book; fams: Wins; plan: PlanState; onPlan: (p: PlanState) => void }) {
  const rows = usePlanRows(b, fams, plan, sales, periodId);
  const st = pillarStatus(b, fams);
  const [focus, setFocus] = useState<{ focus: string; label: string } | null>(null);
  const rowsQ = useRcaQuery(api.repView.rowsByFocus, sales && focus && periodId ? { password: pw(), periodId, sales, focus: focus.focus } : "skip");
  const openIds = (ids: string[] | undefined, label: string) =>
    ids?.length && setFocus(f => (f?.label === label ? null : { focus: `ids:${ids.join(",")}`, label }));
  const paceQ = useRcaQuery(api.repView.pace, sales && periodId ? { password: pw(), periodId, sales } : "skip");
  const gp = paceQ?.ready ? paceQ : null;
  const tr = touchRate(b);
  const [pillarSel, setPillarSel] = useState<PKey | null>(null);
  const inPlan = rows.filter(r => r.inPlan);
  const shownRows = pillarSel ? rows.filter(r => r.p === pillarSel) : rows;
  const setHrs = (id: string, v: number) => {
    const hrs = { ...(plan.hrs ?? {}) };
    if (Number.isFinite(v) && v > 0) hrs[id] = Math.min(40, Math.round(v * 2) / 2); else delete hrs[id];
    onPlan({ ...plan, hrs });
  };
  const used = inPlan.reduce((s, r) => s + r.hrs, 0);
  const expTotal = inPlan.reduce((s, r) => s + r.exp, 0);
  const pillars = (Object.keys(PILLAR_COLOR) as PKey[]).map(p => {
    const rs = inPlan.filter(r => r.p === p);
    const hrs = rs.reduce((s, r) => s + r.hrs, 0);
    const ex = rs.reduce((s, r) => s + r.exp, 0);
    const mult = plan.weighted ? WEIGHT[st[p] ?? "good"] ?? 1 : 1;
    return { p, hrs, ex, raw: hrs ? ex / hrs : 0, ph: hrs ? (ex / hrs) * mult : 0 };
  }).sort((a, c) => c.ph - a.ph);
  const top = pillars[0];
  const overhead = 40 - plan.sellHours;
  const free = plan.sellHours - used;
  const toggle = (id: string, isIn: boolean) => {
    const pins = { ...plan.pins };
    pins[id] = isIn ? "out" : "in";
    onPlan({ ...plan, pins });
  };
  const statusLabel = (p: string) => (st[p] === "behind" ? "Behind" : st[p] === "watch" ? "Watch" : "On track");
  return (
    <>
      <div className="rv-wp-eye">My week · 40 hours · this week's book<Info k="week" /></div>
      <h1 className="rv-wp-h1">
        {top && top.hrs ? `Start with ${top.p}: ${K(top.raw)} per hour, ${Math.round((top.hrs / Math.max(used, 1)) * 100)}% of your selling time.` : "Nothing to plan yet this week."}
      </h1>
      <p className="rv-wp-lead">Every action from Call first, the Opportunity agenda and your scorecard is ranked by expected revenue per hour, then filled into your selling hours from the top. Click any row to pin it in or take it out.</p>
      <div className="rv-wp-kpis">
        <div className="rv-wp-k">
          <div className="rv-wp-kl">Hours I can sell</div>
          <div className="rv-wp-step">
            <button type="button" onClick={() => onPlan({ ...plan, sellHours: Math.max(10, plan.sellHours - 1) })}>−</button>
            <span>{plan.sellHours}</span>
            <button type="button" onClick={() => onPlan({ ...plan, sellHours: Math.min(40, plan.sellHours + 1) })}>+</button>
          </div>
          <div className="rv-wp-ks">{overhead}h of the 40 go to admin, meetings and travel</div>
        </div>
        <div className="rv-wp-k">
          <div className="rv-wp-kl">Hours planned</div>
          <div className="rv-wp-kv">{used}<small> / {plan.sellHours}h</small></div>
          <div className="rv-wp-ks">{free > 0 ? `${free}h still free` : "Fully booked"}</div>
        </div>
        <div className="rv-wp-k">
          <div className="rv-wp-kl">Expected revenue</div>
          <div className="rv-wp-kv g">{K(expTotal)}</div>
          <div className="rv-wp-ks">{K(expTotal / Math.max(used, 1))} per hour planned</div>
        </div>
        <button type="button" className={`rv-wp-k rv-wp-tog${plan.weighted ? " on" : ""}`} onClick={() => onPlan({ ...plan, weighted: !plan.weighted })}>
          <div className="rv-wp-kl">Favour pillars that are behind <b>{plan.weighted ? "ON" : "OFF"}</b></div>
          <div className="rv-wp-ks2">Behind pillars score x1.5, watch x1.15. Turn off to rank on revenue per hour alone.</div>
        </button>
      </div>
      {gp && gp.plan > 0 ? (() => {
        const gap = Math.max(0, gp.plan - gp.heading);
        const exNew = Math.max(0, (gp.newPlan ?? 0) - (gp.newHeading ?? 0)), exOld = Math.max(0, (gp.existingPlan ?? 0) - (gp.existingHeading ?? 0));
        const cover = gap ? Math.min(1, expTotal / gap) : 1;
        return (
          <div className="rv-wp-card rv-wp-gap">
            <div className="rv-wp-ch"><h2>Gap to goal this week<Info k="gap" /></h2></div>
            <div className="rv-wp-gapnums">
              <div><span>Heading</span><b>{K(gp.heading)}</b></div>
              <div><span>Goal</span><b>{K(gp.plan)}</b></div>
              <div><span>{gap ? "Shortfall" : "Ahead by"}</span><b className={gap ? "bad" : "good"}>{K(gap || gp.heading - gp.plan)}</b></div>
              <div><span>Plan expects</span><b className="g">{K(expTotal)}</b></div>
            </div>
            {gap ? (
              <>
                <div className="rv-wp-pb big"><i style={{ width: `${cover * 100}%`, background: cover >= 1 ? "#16a34a" : "#3b82f6" }} /></div>
                <p className="rv-wp-ks">
                  {cover >= 1 ? "The plan more than covers the shortfall." : `The plan covers ${Math.round(cover * 100)}% of the shortfall.`}
                  {gp.existingPlan != null && gp.newPlan != null ? ` Existing clinics ${gp.existingHeading >= gp.existingPlan ? `${K(gp.existingHeading - gp.existingPlan)} ahead` : `${K(exOld)} short`}, new business ${(gp.newHeading ?? 0) >= gp.newPlan ? `${K((gp.newHeading ?? 0) - gp.newPlan)} ahead` : `${K(exNew)} short`}.` : ""}
                  {cover < 1 ? " Add hours or pin more actions in to close it." : ""}
                </p>
              </>
            ) : <p className="rv-wp-ks">Pace is at or above the weekly goal; the plan is about protecting it.</p>}
          </div>
        );
      })() : null}
      <div className="rv-wp-card">
        <div className="rv-wp-ch"><h2>Your 40 hours<Info k="hours" /></h2>
          <div className="rv-hours-key">
            <span><i style={{ background: "#e5e7eb" }} />Admin and meetings</span>
            {(Object.keys(PILLAR_COLOR) as PKey[]).map(p => <span key={p}><i style={{ background: PILLAR_COLOR[p] }} />{p}</span>)}
          </div>
        </div>
        <div className="rv-hours">
          {overhead > 0 ? <i style={{ flex: overhead, background: "#e5e7eb", color: "#6b7280" }}>{overhead >= 5 ? "Admin" : ""}</i> : null}
          {(Object.keys(PILLAR_COLOR) as PKey[]).flatMap(p => inPlan.filter(r => r.p === p).map(r => (
            <i key={r.id} style={{ flex: r.hrs, background: PILLAR_COLOR[p], color: p === "New Business" ? "#0f172a" : "#fff" }} title={`${r.label} · ${r.hrs}h`}>{r.hrs >= 2 ? `${r.hrs}h` : ""}</i>
          )))}
          {free > 0 ? <i style={{ flex: free, background: "#f3f4f6", color: "#6b7280" }}>{free >= 3 ? "free" : ""}</i> : null}
        </div>
      </div>
      <div className="rv-plan-grid">
        <div className="rv-wp-card p0">
          <div className="rv-wp-ch pad"><div><h2>Which pillar first<Info k="pillar" /></h2><p className="rv-wp-ks">Ranked by weighted revenue per hour of what is in your plan.</p></div></div>
          {pillars.map((p, i) => (
            <button type="button" key={p.p} className={`rv-wp-pil${i === 0 ? " top" : ""}${pillarSel === p.p ? " sel" : ""}`} onClick={() => setPillarSel(cur => (cur === p.p ? null : (p.p as PKey)))} title={pillarSel === p.p ? "Show every action again" : `Show only ${p.p} actions`}>
              <div className="rv-wp-pr">
                <span><em>{i + 1}</em> <b>{p.p}</b> <i className={st[p.p] === "behind" ? "bad" : st[p.p] === "watch" ? "watch" : "good"} /></span>
                <span className="g">{K(p.raw)}/h</span>
              </div>
              <div className="rv-wp-pr s"><span>{statusLabel(p.p)}</span><span>{p.hrs}h · {K(p.ex)}</span></div>
              <div className="rv-wp-pb"><i style={{ width: `${pillars[0].raw ? (p.raw / pillars[0].raw) * 100 : 0}%`, background: PILLAR_COLOR[p.p as PKey] }} /></div>
            </button>
          ))}
        </div>
        <div className="rv-wp-card p0">
          <div className="rv-wp-ch pad"><div><h2>Action queue<Info k="queue" /></h2><p className="rv-wp-ks">Expected revenue = upside x likelihood. {tr.own !== null ? `Likelihood starts from your own reorder rate after a touch: ${Math.round(tr.own * 100)}% of ${tr.n} clinics touched this quarter, blended toward 50% while the sample is small, then adjusted per action.` : "No touches logged this quarter, so likelihood starts at 50%."} Win-backs count half their baseline.</p></div></div>
          {pillarSel ? (
            <div className="rv-wp-filter">Showing {pillarSel} actions only ({shownRows.length}) <button type="button" onClick={() => setPillarSel(null)}>Show all</button></div>
          ) : null}
          <div className="rv-plan-row hd"><span>#</span><span>Action</span><span>Hours</span><span>Expected</span><span>Per hour</span><span>Status</span></div>
          {!shownRows.length ? <p className="rv-wp-ks pad">No actions in {pillarSel} this week.</p> : null}
          {shownRows.map((r, i) => (
            <div role="button" tabIndex={0} key={r.id} className={`rv-plan-row${r.inPlan ? " in" : ""}`} onClick={() => toggle(r.id, !!r.inPlan)} onKeyDown={ev => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); toggle(r.id, !!r.inPlan); } }}>
              <span className="rv-mono">{i + 1}</span>
              <span><b>{r.label}</b><em>{r.p} · <a className="rv-plan-cl" role="button" title="Show clinic list" onClick={ev => { ev.stopPropagation(); openIds(r.ids, `${r.label} · this week`); }}>{r.detail} ↓</a></em></span>
              <span className="rv-mono rv-hrs" title={r.est !== undefined && r.est !== r.hrs ? `Estimate was ${r.est}h; you set ${r.hrs}h. Clear the box to go back.` : "Type your own hours for this action"} onClick={ev => ev.stopPropagation()}>
                <input type="number" min={0.5} max={40} step={0.5} value={r.hrs} className={r.est !== undefined && r.est !== r.hrs ? "set" : ""} aria-label={`Hours for ${r.label}`}
                  onChange={ev => setHrs(r.id, ev.target.value === "" ? 0 : Number(ev.target.value))} onKeyDown={ev => ev.stopPropagation()} />h
              </span>
              <span className="rv-mono">{K(r.exp)}</span>
              <span className="rv-mono g">{K(r.score)}</span>
              <span className="rv-mono st">{r.inPlan ? "In plan" : "Out"}{plan.pins[r.id] ? " 📌" : ""}</span>
            </div>
          ))}
          <details className="rv-wp-how">
            <summary>How expected revenue is calculated</summary>
            <div className="rv-wp-how-b">
              <p><b>Expected revenue = upside x likelihood.</b> Per hour = expected / hours. Upside is the weekly dollars at stake if the action works; likelihood is the chance it does. Hours default to a time per clinic and you can overwrite them in the queue.</p>
              <p><b>Likelihood</b> starts from your reorder rate after a touch this quarter{tr.own !== null ? ` (${Math.round(tr.own * 100)}% of ${tr.n} touched clinics)` : ""}, blended toward 50% (as if 20 clinics at 50% were added) so a small sample cannot swing it. It becomes {Math.round(tr.pr * 100)}% for you, then each action scales it: win-backs and idle clinics lower, calls and restarts higher, capped at 90%.</p>
              <p><b>Pillar boost:</b> when "Favour pillars that are behind" is on, per hour is multiplied by 1.5 for a behind pillar and 1.15 for watch. That changes the order, not the expected dollars.</p>
              <table>
                <thead><tr><th>Action</th><th>What the upside is</th><th>Upside</th><th>Likelihood</th><th>Expected</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}><td>{r.label}</td><td>{UPSIDE_BASIS[r.id] ?? ""}</td><td>{K(r.up)}</td><td>{Math.round(r.pr * 100)}%</td><td>{K(r.exp)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p>Prospect calls are not included: they need CRM lead data. These are planning estimates, not forecasts.</p>
            </div>
          </details>
          <p className="rv-wp-ks pad">Click a row to pin it in or out; type in the Hours box to set your own time for an action; click the clinic count to see the clinic list. Prospect calls are not ranked yet: they need CRM lead data.</p>
        </div>
      </div>
      {focus ? <FocusTable label={focus.label} rows={rowsQ?.ready ? rowsQ.rows : null} onClose={() => setFocus(null)} periodId={periodId} sales={sales} /> : null}
    </>
  );
}

/** Business feed tab (2026-10-20): the main Business Feed's own questions, cut to the rep's book. The cards are built on the
 * server by the same functions as the company feed (`feed:repQuestions`), so the wording matches; only the scope changes.
 * Shortlisted so far: "Is Toxin Zoomer offsetting the Total Tox downfall?" and "Which clinics are ready for the $400
 * Foundation Zoomer panel?". Adding a question means adding it to `repQuestions` in analytics/feed.ts. */
function SignalsFeed({ sales, periodId, weekLabel, clinics }: { sales: string; periodId: string; weekLabel: string; clinics: number }) {
  const q = useRcaQuery(api.feed.repQuestions, sales ? { password: pw(), sales } : "skip");
  const [view, setView] = useFeedView();
  const [limit, setLimit] = useState(60);
  const [focus, setFocus] = useState<{ focus: string; label: string } | null>(null);
  const rowsQ = useRcaQuery(api.repView.rowsByFocus, sales && focus && !focus.focus.startsWith("pair:") && periodId ? { password: pw(), periodId, sales, focus: focus.focus } : "skip");
  const toneLabel: Record<string, string> = { alert: "Act now", watch: "Watch", info: "Opportunity", good: "Good news" };
  const cards = q?.ready ? q.cards : [];
  return (
    <div className="rv-sig">
      <div className="rv-eyebrow">Business feed · your book<Info k="signals" /></div>
      <h1 className="rv-h1">{cards.length ? `${cards.length === 2 ? "Two" : cards.length} questions about ${sales.startsWith("team:") ? "your team's" : "your"} ${clinics} clinics` : "Business feed"}</h1>
      <div className="rv-sig-legend">
        <span className="rv-sig-chip is-fact">1 Fact</span><i>→</i><span className="rv-sig-chip is-inf">2 Inference</span><i>→</i><span className="rv-sig-chip is-evi">3 Evidence</span><i>→</i><span className="rv-sig-chip is-act">4 Action</span>
        <em>What happened, what it means, the numbers behind it, what to do. The same questions as the main Business Feed, cut to your own clinics.</em>
        <span style={{ marginLeft: "auto" }}><ViewToggle view={view} onChange={setView} /></span>
      </div>
      {!q ? <p className="rv-dim">Loading…</p> : null}
      {view === "table" && cards.length ? (
        <FeedTable
          lastLabel="Confidence"
          rows={cards.map<FeedRow>(c => ({
            id: c.id, tone: c.tone, topicLine: `${c.domain} · ${c.topic}`, question: c.question, headline: insightHeadline(c.fact, c.topic),
            fact: c.fact, inference: c.inference, evidence: c.evidence, action: c.action, last: c.confidence,
            onOpen: c.focus && c.applies ? () => setFocus(f => (f?.label === (c.focusLabel ?? c.question) ? null : { focus: c.focus!, label: c.focusLabel ?? c.question })) : undefined,
          }))}
        />
      ) : null}
      <div className="rv-sig-grid" style={view === "table" ? { display: "none" } : undefined}>
      {cards.map(c => {
        const head = insightHeadline(c.fact, c.topic);
        return (
          <article key={c.id} className={`rv-sig-card tone-${c.tone}`}>
            <header className="rv-sig-hd">
              {head ? <div className="rv-sig-kpi">{head.value}<small>{head.caption}</small></div> : null}
              <div className="rv-sig-q"><span>{c.domain} · {c.topic} · {toneLabel[c.tone] ?? c.tone}</span><h3>{c.question}</h3></div>
              <div className="rv-sig-side">
                <div className="rv-sig-meta">Confidence <b>{c.confidence}</b></div>
              </div>
            </header>
            <div className="rv-sig-step"><div className="gut"><span className="rv-sig-chip is-fact">Fact</span></div><div className="body">{c.fact}</div></div>
            <div className="rv-sig-step is-inf"><div className="gut"><span className="rv-sig-chip is-inf">Inference</span></div><div className="body">{c.inference}</div></div>
            {c.evidence.length ? (
              <div className="rv-sig-step"><div className="gut"><span className="rv-sig-chip is-evi">Evidence</span></div>
                <div className="body"><div className="rv-sig-evi">{c.evidence.map(e => <span key={e}>{e}</span>)}</div></div></div>
            ) : null}
            <div className="rv-sig-step is-act"><div className="gut"><span className="rv-sig-chip is-act">Action</span></div>
              <div className="body">{c.action}
                {c.focus && c.applies ? (
                  <div className="rv-sig-btns">
                    <button type="button" className="pri" onClick={() => setFocus(f => (f?.label === (c.focusLabel ?? c.question) ? null : { focus: c.focus!, label: c.focusLabel ?? c.question }))}>Open the clinics</button>
                  </div>
                ) : null}
              </div></div>
          </article>
        );
      })}
      </div>
      {focus && focus.focus.startsWith("pair:") ? (
        <SwitchPanel periodId="all" periodLabel="analysis window" pair={focus.focus.slice(5)} limit={limit} onLimit={setLimit} onClose={() => setFocus(null)} sales={sales} />
      ) : focus ? (
        <FocusTable label={focus.label} rows={rowsQ?.ready ? rowsQ.rows : null} onClose={() => setFocus(null)} periodId={periodId} sales={sales} />
      ) : null}
      <p className="rv-dim rv-small">{weekLabel ? `Clinic lists open for ${weekLabel}. ` : ""}More questions from the main Business Feed will be added here over time.</p>
    </div>
  );
}

/** A collapsed "how is this calculated" note under a section heading (2026-10-20). */
function HowCalc({ title = "How this is calculated", children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="rv-howcalc">
      <summary>{title}</summary>
      <div className="rv-howcalc-b">{children}</div>
    </details>
  );
}

/** A short "how to use this tab" panel at the top of each tab (2026-10-20). Closed by default once opened and closed; the
 * choice is remembered per tab. Window tabs link to the Scorecard guide, which explains every dial and cell. */
type GuideItem = { t: string; d: string };
const WINDOW_GUIDE: GuideItem[] = [
  { t: "Headline and Great job", d: "Where the book stands against its goal for this window. Great job lists wins: beating goal, comebacks, new and returning clinics, bundle gainers, and how many touched clinics reordered. Click a number for the clinics." },
  { t: "Scorecard", d: "Dials for Combined, New and Existing business, then the matrix of metrics by pillar. Click a cell for the clinics pushing it up and pulling it down; \"Explain this metric\" opens its entry in the Scorecard guide. The retention and expansion row can be cut by when clinics signed up." },
  { t: "Product families", d: "Cards for each product family stay visible. Click one to scope the Product Growth cells to it; the lists for Target Product Orders and Product adoption use each clinic's portfolio status." },
  { t: "Where the gap comes from", d: "The gap to goal split by volume vs AOV, bundles vs single panels, clinic cohort and state. Click a branch for its clinic list; the toggle switches between the simple and detailed view." },
];
const TOUCH_GUIDE: GuideItem = { t: "Touch effort (bottom of the tab)", d: "Clinics you called or met in this window, how many reordered after, against clinics you did not touch, and your lift, in two rows: existing clinics and new business, each with the team average. \"Order within\" limits how soon after a touch an order counts." };
const TAB_GUIDE: Partial<Record<Tab, { title: string; lead: string; items: GuideItem[]; link?: boolean }>> = {
  today: {
    title: "Today's agenda",
    lead: "What to do today. Start at the top and work down.",
    items: [
      { t: "Next best action", d: "The one action with the highest expected revenue per hour this week. \"See my week\" opens the full plan." },
      { t: "Opportunity agenda", d: "Your scorecard's opportunity column as cards: how many clinics, the dollars at stake and the suggested action. \"Add to today\" plans it; \"See in scorecard\" jumps to the metric." },
      { t: "Call first", d: "Existing clinics at least 5 days since their last order that have not churned by their own threshold, ranked by dollars. Filter by health note or portfolio status; click a clinic for its card." },
      { t: "New clinics: getting to order 4", d: "This year's new clinics due for their next order. Change the days-between-orders filter to widen or narrow who shows." },
      { t: "Touch effort", d: "At the bottom. Clinics you called or met this week, how many reordered after, against clinics you did not touch, and your lift, in two rows: existing clinics and new business. \"Order within\" limits how soon after a touch an order counts; the Great job touch line follows it." },
      { t: "Left rail", d: "This week against goal, the leaderboard (my team or all reps), clinic and provider search, and your recently opened clinics." },
    ],
  },
  plan: {
    title: "My week plan",
    lead: "Turns everything above into a plan for the hours you can sell.",
    items: [
      { t: "Hours I can sell", d: "Set your selling hours; the rest of the 40 go to admin, meetings and travel. Actions fill your hours from the top of the queue." },
      { t: "Gap to goal this week", d: "Where the week is heading against goal, and how much of any shortfall the planned actions are expected to cover (existing clinics and new business shown separately)." },
      { t: "Which pillar first", d: "Pillars ranked by expected revenue per hour of what is in your plan. Click one to show only its actions in the queue." },
      { t: "Action queue", d: "Every action ranked by expected dollars per hour. Click a row to pin it in or out, type in the Hours box to use your own time, click the clinic count for the list." },
      { t: "How expected revenue is calculated", d: "Expected = upside x likelihood. Upside is the weekly dollars at stake for that action (its basis is listed under the queue). Likelihood starts from your own reorder rate after a touch this quarter, blended toward 50% while the sample is small, then adjusted per action and capped at 90%. Win-backs count half their baseline. Open \"How expected revenue is calculated\" under the queue for each action's figures." },
      { t: "Favour pillars that are behind", d: "Boosts pillars the scorecard shows as behind (x1.5) or watch (x1.15). Turn it off to rank on revenue per hour alone." },
    ],
  },
  feed: {
    title: "Business feed",
    lead: "Questions from the main Business Feed, answered for your own clinics.",
    items: [
      { t: "Fact, Inference, Evidence, Action", d: "Every card reads in the same order: what happened (blue), what it means (violet), the numbers behind it (teal), and what to do (amber). The big number at the top is the answer in one figure." },
      { t: "Is Toxin Zoomer offsetting the Total Tox downfall?", d: "Compares your clinics' Total Tox and Toxin Zoomer against baseline over the analysis window. The net tells you whether the drop is a loss or a switch; the action opens the clinics that dropped Total Tox without picking up Toxin Zoomer." },
      { t: "Which clinics are ready for the $400 Foundation Zoomer panel?", d: "Your clinics that already run VA-only orders at $275 or more and 3 or more orders a week over the trailing year. Open the list to see them." },
      { t: "Same wording as the main feed", d: "The cards are built by the same code as the company-wide Business Feed, so they read the same; only the scope changes. More questions will be added over time." },
    ],
  },
  week: { title: "This week", lead: "The week to date against its goal.", items: [...WINDOW_GUIDE, TOUCH_GUIDE], link: true },
  month: { title: "This month", lead: "The month to date against its goal.", items: [...WINDOW_GUIDE, { t: "Provider retention funnel", d: "How many providers placed order 1, 2, 3 and so on, and where they dropped off. Click a stage for the clinics." }, TOUCH_GUIDE], link: true },
  quarter: { title: "This quarter", lead: "The quarter to date against its goal.", items: [...WINDOW_GUIDE, { t: "Provider retention funnel", d: "How many providers placed order 1, 2, 3 and so on, and where they dropped off. Click a stage for the clinics." }, TOUCH_GUIDE], link: true },
  custom: { title: "Custom dates", lead: "The same view for the dates chosen in the date picker.", items: [...WINDOW_GUIDE, { t: "Provider retention funnel", d: "Shown for windows of four weeks or more." }], link: true },
};
function TabGuide({ tab }: { tab: Tab }) {
  const g = TAB_GUIDE[tab];
  const key = `rv-tabguide:${tab}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  useEffect(() => { try { setOpen(localStorage.getItem(key) === "1"); } catch { setOpen(false); } }, [key]);
  if (!g) return null;
  const flip = () => setOpen(o => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  return (
    <div className={`rv-tabguide${open ? " is-open" : ""}`}>
      <div className="rv-tabguide-row">
        <button type="button" className="rv-tabguide-h" onClick={flip} aria-expanded={open}>
          <span>How to use this tab</span><em>{g.title}</em><i>{open ? "Hide" : "Show"}</i>
        </button>
        <Info k="tabguide" />
      </div>
      {open ? (
        <div className="rv-tabguide-b">
          <p>{g.lead}</p>
          <dl>
            {g.items.map(x => (<div key={x.t}><dt>{x.t}</dt><dd>{x.d}</dd></div>))}
          </dl>
          {g.link ? <button type="button" className="rv-explain" onClick={() => { guideNav.target = null; guideNav.go(""); }}>Open the Scorecard guide: every dial and metric, with examples</button> : null}
        </div>
      ) : null}
    </div>
  );
}

/* Quick tour (Shyam, 2026-10-06): chains every section (i) guide with Next/Back. */
const TOUR: Array<{ tab: Tab; k: string }> = [
  ...["headline", "tabguide", "nba", "opp", "call", "newc", "touch"].map(k => ({ tab: "today" as Tab, k })),
  ...["week", "gap", "hours", "pillar", "queue"].map(k => ({ tab: "plan" as Tab, k })),
  ...["signals"].map(k => ({ tab: "feed" as Tab, k })),
  ...["headline", "great", "sc", "fam", "tree", "funnel", "touch"].map(k => ({ tab: "week" as Tab, k })),
  ...["gauge", "lb", "recent"].map(k => ({ tab: "today" as Tab, k })),
];
const tourStore = { step: null as number | null, dir: 1, subs: new Set<() => void>(), setTab: (_: Tab) => {} };
const tourSet = (step: number | null, dir = 1) => {
  if (step != null && (step < 0 || step >= TOUR.length)) step = null;
  tourStore.step = step; tourStore.dir = dir;
  if (step == null) localStorage.setItem("rv-tour-done", "1"); else tourStore.setTab(TOUR[step].tab);
  tourStore.subs.forEach(f => f());
};
const useTour = () => useSyncExternalStore(f => { tourStore.subs.add(f); return () => { tourStore.subs.delete(f); }; }, () => tourStore.step);
function TourGuide({ setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  tourStore.setTab = setTab;
  const step = useTour();
  useEffect(() => { if (!localStorage.getItem("rv-tour-done")) setTimeout(() => tourSet(0), 1200); }, []);
  // Skip sections not shown for this rep/window.
  useEffect(() => {
    if (step == null) return;
    const t = setTimeout(() => {
      if (tourStore.step === step && !document.querySelector(`[data-info="${TOUR[step].k}"]`)) tourSet(step + tourStore.dir, tourStore.dir);
    }, 1500);
    return () => clearTimeout(t);
  }, [step]);
  return (
    <div className="rv-tour-bar">
      <button type="button" className="rv-tour-start" onClick={() => tourSet(0)}>Quick tour</button>
    </div>
  );
}

const INFO: Record<string, string> = {
  lb: "Ranks reps on % of goal for this window. Toggle my team / all reps. Team leads are excluded; other reps' clinic data stays private.",
  gauge: "Solid needle = booked so far. Dotted needle = where you're heading at current pace. End of the dial = goal. Shows this week on Today.",
  call: "Existing clinics at least 5 days since their last order that have not churned by their own threshold (45 days, or 3 times their usual gap for slow buyers), ranked by $ at stake then days since order. Filter by health note or portfolio status. Click a clinic for its full card.",
  newc: "New clinics due for their next order, order 4 first. Use the days-between-orders filter to change the window (default 14–21 days). Shows who dropped off before the next order.",
  tree: "The gap between actual and goal for this window, split into volume vs AOV, bundles vs single panels, clinic cohorts and states. Green is ahead of goal, red is behind. Click any branch for its clinic list. The toggle switches between the simple and the detailed view.",
  funnel: "How many providers placed order 1, 2, 3… and where they dropped off. Click a stage for the clinic list.",
  sc: "The scorecard: three dials (Combined, New, Existing) and a matrix of metrics by pillar, green on track, amber watch, red behind. Click a cell for the clinics pushing it up and pulling it down; \"Explain this metric\" opens its Scorecard guide entry. The retention row can be cut by when clinics signed up.",
  fam: "One card per product family, always visible: orders against expected. Click a card to scope the Product Growth cells to that family; the Target Product Orders and Product adoption lists then use each clinic's portfolio status (NEW, RESTARTED, DECLINING, STOPPED).",
  ws: "Mark clinics that should be ordering a product but never have. Your marked list is the Product whitespace count on the scorecard; it is saved per rep.",
  search: "Live results as you type. Click one to open its full clinic/provider card.",
  recent: "Your last 10 opened clinics/providers, one click to reopen.",
  touch: "Touch effort sits at the bottom of the tab: clinics you called or met in this window, how many reordered after, against clinics you did not touch, and the lift, in two rows (existing clinics, and new business) with the team average. 'Order within' limits how soon after a touch an order counts.",
  nba: "The single action with the highest expected revenue per hour this week. 'See my week' opens your full plan.",
  opp: "Your scorecard's Opportunity column as cards: count, $ upside, suggested action. Click the count for clinics, 'Add to today' to plan it, 'See in scorecard' to jump there.",
  week: "Set your selling hours; actions fill them from the top by expected revenue per hour.",
  tabguide: "A short guide to this tab: what each section shows and how to use it. Open it any time; the FAQ button in the top bar answers the wider 'what does that word mean' questions, and the notes marked 'How this is calculated' under each section give the formulas.",
  signals: "Your Business feed: the main Business Feed's questions, answered for your own clinics. Each card leads with the answer as one number, then reads Fact (what happened), Inference (what it means), Evidence (the numbers) and Action (what to do).",
  gap: "Where this week is heading against its goal (existing clinics plus the new-business goal), and how much of any shortfall the actions in your plan are expected to cover.",
  hours: "How your 40 hours split across admin, each pillar and free time.",
  pillar: "Which pillar returns the most per hour in your plan. Click a pillar to show only its actions in the queue. Behind pillars get a boost when the toggle is on.",
  queue: "All actions ranked by expected $/hour (upside x likelihood / hours). Click a row to pin in/out, edit the Hours box to use your own time, click the clinic count for the list. Open 'How expected revenue is calculated' under the queue for each action's figures.",
  great: "What's going right in this window. Beating goal, Comebacks and Bundle gainers look at existing clinics only, each against its own goal (new and returning clinics have none: they sit under the new-business goal). New-logo wins counts this year's new clinics plus returning ones (no baseline, ordering again) that ordered in the window. The touch line is the share of clinics you touched in the last N days that reordered since; N follows the Touch effort 'Order within' choice (14 on any time). Click a number for the clinics.",
  headline: "Booked vs goal for this window and the $/day needed for the days left.",
};
function Info({ k }: { k: string }) {
  const [o, setO] = useState(false);
  const step = useTour();
  const ref = useRef<HTMLSpanElement>(null);
  const [mine, setMine] = useState(false);
  const want = step != null && TOUR[step].k === k;
  useEffect(() => {
    if (!want) { setMine(false); return; }
    const t = setTimeout(() => {
      const first = document.querySelector(`[data-info="${k}"]`) === ref.current;
      setMine(first);
      if (first) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(t);
  }, [want, k, step]);
  const touring = want && mine && step != null;
  // The popover is positioned against the viewport (fixed), so a card with overflow hidden cannot clip it and it never runs
  // off an edge: it sits under the icon, clamped to the screen, or above it when there is no room below.
  const popRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = () => {
    const icon = ref.current?.querySelector("button");
    if (!icon) return;
    const r = icon.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 200;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 288));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ top, left });
  };
  useEffect(() => {
    if (!(o || touring)) { setPos(null); return; }
    place();
    const again = () => place();
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    const t = setTimeout(place, 50);
    return () => { window.removeEventListener("scroll", again, true); window.removeEventListener("resize", again); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, touring, step]);
  return (
    <span ref={ref} data-info={k} className={`rv-info${touring ? " is-tour" : ""}`} onMouseLeave={() => setO(false)}>
      <button type="button" className="rv-info-i" aria-label="About this section" onClick={e => { e.stopPropagation(); setO(v => !v); }}>i</button>
      {(o || touring) && (
        <span ref={popRef} className="rv-info-pop" style={pos ? { position: "fixed", top: pos.top, left: pos.left } : { visibility: "hidden" }} onClick={e => e.stopPropagation()}>
          {touring ? <b className="rv-info-step">Tour {step! + 1}/{TOUR.length}</b> : null}
          {INFO[k]}
          {touring ? (
            <span className="rv-tour-nav">
              <button type="button" onClick={() => tourSet(null)}>Skip</button>
              {step! > 0 ? <button type="button" onClick={() => tourSet(step! - 1, -1)}>Back</button> : null}
              <button type="button" className="pri" onClick={() => tourSet(step! + 1 < TOUR.length ? step! + 1 : null)}>{step! + 1 < TOUR.length ? "Next" : "Done"}</button>
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}


/* ── Product Growth pillar (Shyam, 2026-10-06) ─────────────────────────── */
type PGClinic = {
  clinic: string; name: string; win: Record<string, number>; life: Record<string, number>; rev?: Record<string, number>;
  base?: Record<string, number>; baseRev?: Record<string, number>; share?: number; isNew?: boolean; tests?: Array<[string, string]>;
};
const STATUS_RANK = ["STOPPED", "DECLINING", "RESTARTED", "NEW"];
/** Portfolio status of a clinic for one product family. Statuses are per test and test names run longer than the family
 * ("Hormone Zoomer 2.0" for Hormone Zoomer), so a test counts when it starts with the family name. */
function famStatus(c: PGClinic | undefined, family: string): string {
  const f = family.toLowerCase();
  const hit = (c?.tests ?? []).filter(([t]) => t.toLowerCase().startsWith(f)).map(([, s2]) => s2);
  return STATUS_RANK.find(s2 => hit.includes(s2)) ?? "";
}
/** Orders expected of a clinic for a family in this tab: baseline-period orders x the tab's share. Needs 3+ baseline orders;
 * a clinic new this year has none (same rules as the clinic card). */
function famExpected(c: PGClinic | undefined, family: string): number {
  const base = c?.base?.[family] ?? 0;
  return !c || c.isNew || base < 3 ? 0 : base * (c.share ?? 0);
}
type PGStats = {
  addedIds: string[];
  family: string; adoption: number | null; adoptN: number; newN: number; exN: number;
  repeat: number | null; repN: number; pairN: number; wsN: number; eligN: number; wsIds: string[];
  ppc: number | null; ppcRange: string; activeN: number; adoptIds: string[]; repIds: string[]; activeIds: string[]; buyerIds: string[]; xs: XSell[]; xsUp: number;
};
type XSell = { clinic: string; name: string; has: string[]; suggest: string; up: number; rev: number };
function pstat(b: Book): string | null {
  const c: Array<[string, number]> = b.pstatusCounts ?? [];
  return c.length ? c.map(([k2, n]) => `${n} ${k2.toLowerCase()}`).join(" · ") : null;
}
function usePG(sales?: string, periodId?: string) {
  const run = useRcaAction(api.productGrowth.productGrowth);
  const eligQ = useQuery(api.productGrowth.eligible, sales ? { password: pw(), sales } : "skip");
  const [data, setData] = useState<{ clinics: PGClinic[] } | null>(null);
  useEffect(() => {
    if (!sales || !periodId) return;
    let live = true;
    setData(null);
    run({ password: pw(), sales, periodId }).then(r => live && r.ready && setData(r)).catch(() => undefined);
    return () => { live = false; };
  }, [sales, periodId, run]);
  return { data, elig: (eligQ ?? []) as Array<{ clinic: string; family: string }> };
}
const NON_ZOOMER = "Non Zoomer";
function pgStats(b: Book, clinics: PGClinic[], elig: Array<{ clinic: string; family: string }>, family: string): PGStats {
  const newSet = new Set<string>(b.newIds ?? []);
  const fams = (r: Record<string, number>) => Object.keys(r).filter(f => f !== "Unmapped" && r[f] > 0);
  const prod = (r: Record<string, number>) => fams(r).filter(f => f !== NON_ZOOMER);
  // Per selected family (Shyam, 2026-10-06): adoption = new clinics with window
  // orders that ordered this family; repeat = clinics ordering it that did so 2+ times.
  // "Non Zoomer" is not a product family (see products per customer below): a new clinic counts as ordering when it bought a Zoomer.
  const newOrd = clinics.filter(c => newSet.has(c.clinic) && prod(c.win).length > 0);
  const adoptN = newOrd.filter(c => (c.win[family] ?? 0) > 0).length;
  const buyers = clinics.filter(c => (c.win[family] ?? 0) > 0);
  const pairN = buyers.length, repN = buyers.filter(c => c.win[family] >= 2).length;
  // Products per customer: distinct *product* families per clinic ordering in the window. "Non Zoomer" is the
  // catch-all bucket for everything that is not a Zoomer panel, so it is not a product family here (it still
  // counts as ordering for adoption and repeat above). Clinics that only bought Non Zoomer are left out.
  const active = clinics.filter(c => prod(c.win).length > 0);
  const ppc = active.length ? active.reduce((t, c) => t + prod(c.win).length, 0) / active.length : null;
  // Range (Shyam: "2-4", not a decimal): 25th–75th percentile of families per clinic.
  const cnts = active.map(c => prod(c.win).length).sort((a, b2) => a - b2);
  const pct = (q: number) => cnts[Math.min(cnts.length - 1, Math.floor(q * cnts.length))];
  const ppcRange = cnts.length ? (pct(0.25) === pct(0.75) ? String(pct(0.25)) : `${pct(0.25)}–${pct(0.75)}`) : "—";
  const adoptIds = newOrd.filter(c => (c.win[family] ?? 0) > 0).map(c => c.clinic);
  // Existing clinics that added the product: Portfolio Changes says NEW for it (no orders of it in the prior 90 days, fewer than 3 before).
  const addedIds = clinics.filter(c => !newSet.has(c.clinic) && (c.win[family] ?? 0) > 0 && famStatus(c, family) === "NEW").map(c => c.clinic);
  // Existing clinics measured: ordering a product in the window. Added = ordered this family in the window and its status is NEW.
  const exN = clinics.filter(c => !newSet.has(c.clinic) && prod(c.win).length > 0).length;
  const repIds = buyers.filter(c => c.win[family] >= 2).map(c => c.clinic);
  const activeIds = active.map(c => c.clinic);
  // Cross-sell: active clinics on 1–2 families (lifetime). Suggest the family most
  // often bought by book clinics that share all their families; upside = their
  // current window $ per family (one more family at today's per-family spend).
  const xs: XSell[] = [];
  for (const c of active) {
    const has = prod(c.life);
    if (has.length > 2) continue;
    const tally = new Map<string, number>();
    for (const o of clinics) {
      if (o === c) continue;
      const of = prod(o.life);
      if (!has.every(f => of.includes(f))) continue;
      for (const f of of) if (!has.includes(f)) tally.set(f, (tally.get(f) ?? 0) + 1);
    }
    const suggest = [...tally].sort((a, b2) => b2[1] - a[1])[0]?.[0];
    if (!suggest) continue;
    const rev = Object.entries(c.rev ?? {}).filter(([f]) => f !== NON_ZOOMER && f !== "Unmapped").reduce((x, [, y]) => x + y, 0);
    xs.push({ clinic: c.clinic, name: c.name, has, suggest, rev, up: rev / Math.max(1, prod(c.win).length) });
  }
  xs.sort((a, b2) => b2.up - a.up);
  const byId = new Map(clinics.map(c => [c.clinic, c]));
  const el = elig.filter(e => e.family === family);
  const wsIds = el.filter(e => !((byId.get(e.clinic)?.life[family] ?? 0) > 0)).map(e => e.clinic);
  return {
    family, adoption: newOrd.length + exN ? (adoptN + addedIds.length) / (newOrd.length + exN) : null, adoptN, newN: newOrd.length, exN,
    repeat: pairN ? repN / pairN : null, repN, pairN, wsN: wsIds.length, eligN: el.length, wsIds,
    ppc, ppcRange, activeN: active.length, adoptIds, addedIds, repIds, activeIds, buyerIds: buyers.map(c => c.clinic), xs, xsUp: xs.reduce((t, x) => t + x.up, 0),
  };
}
function WhitespacePlanner({ sales, clinics, elig, family, famList, setFamily }: {
  sales?: string; clinics: PGClinic[] | null; elig: Array<{ clinic: string; family: string }>;
  family: string; famList: string[]; setFamily: (f: string) => void;
}) {
  const toggle = useMutation(api.productGrowth.toggleEligible);
  const [q, setQ] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);
  if (!clinics) return <p className="rv-dim rv-small" style={{ marginTop: 16 }}>Loading product mix…</p>;
  const marked = new Set(elig.filter(e => e.family === family).map(e => e.clinic));
  const never = clinics.filter(c => !((c.life[family] ?? 0) > 0));
  const list = never
    .filter(c => !onlyMarked || marked.has(c.clinic))
    .filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(marked.has(b.clinic)) - Number(marked.has(a.clinic)) || Object.values(b.life).reduce((x, y) => x + y, 0) - Object.values(a.life).reduce((x, y) => x + y, 0));
  return (
    <div className="rv-ws">
      <div className="rv-sec-head">
        <h2>Whitespace planner<Info k="ws" /></h2>
        <span>{marked.size} marked eligible · {[...marked].filter(id => never.some(c => c.clinic === id)).length} never ordered {family}</span>
      </div>
      <div className="rv-ws-bar">
        <select value={family} onChange={e => setFamily(e.target.value)}>
          {(famList.includes(family) ? famList : [family, ...famList]).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input placeholder="Search clinic" value={q} onChange={e => setQ(e.target.value)} />
        <label><input type="checkbox" checked={onlyMarked} onChange={e => setOnlyMarked(e.target.checked)} /> Only eligible</label>
      </div>
      <p className="rv-dim rv-small">Clinics in your book that have never ordered {family}. Tick the ones that should — they become your whitespace.</p>
      <div className="rv-ws-list">
        {list.slice(0, 60).map(c => (
          <label className={`rv-ws-row${marked.has(c.clinic) ? " on" : ""}`} key={c.clinic}>
            <input type="checkbox" checked={marked.has(c.clinic)}
              onChange={() => toggle({ password: pw(), sales, clinic: c.clinic, family }).catch(e => toast.error(String(e.message ?? e)))} />
            <b>{c.name}</b>
            <span className="rv-mono rv-dim">{Object.keys(c.life).filter(f => f !== "Unmapped").length} families · {Object.values(c.life).reduce((x, y) => x + y, 0)} orders lifetime</span>
          </label>
        ))}
        {list.length > 60 ? <p className="rv-dim rv-small">Showing 60 of {list.length} — search to narrow.</p> : null}
        {!list.length ? <p className="rv-dim rv-small">No clinics match.</p> : null}
      </div>
    </div>
  );
}

function CrossSellList({ pg }: { pg: PGStats | null }) {
  if (!pg) return <p className="rv-dim rv-small" style={{ marginTop: 16 }}>Loading product mix…</p>;
  return (
    <div className="rv-ws">
      <div className="rv-sec-head">
        <h2>Cross-sell candidates</h2>
        <span>{pg.xs.length} clinics · {K(pg.xsUp)} est. upside</span>
      </div>
      <p className="rv-dim rv-small">Clinics ordering this window that have only ever bought 1–2 product families. Suggested family = what clinics with the same mix buy most. Upside = their current spend per family, i.e. one more family at today's rate (estimate).</p>
      <div className="rv-ws-list">
        {pg.xs.slice(0, 60).map(x => (
          <div className="rv-ws-row" key={x.clinic}>
            <b>{x.name}</b>
            <span className="rv-mono rv-dim">has {x.has.join(" + ")} → pitch <b>{x.suggest}</b> · {K(x.up)} upside</span>
          </div>
        ))}
        {!pg.xs.length ? <p className="rv-dim rv-small">No candidates in this window.</p> : null}
      </div>
    </div>
  );
}


/* ── Dial / progress-bar meters (Shyam, 2026-10-13) ───────────────────── */
type MeterStyle = "dial" | "bar";
const meterStore = { v: ((typeof localStorage !== "undefined" && localStorage.getItem("rv-meter")) || "dial") as MeterStyle, subs: new Set<() => void>() };
function useMeterStyle(): [MeterStyle, (v: MeterStyle) => void] {
  const v = useSyncExternalStore(f => { meterStore.subs.add(f); return () => { meterStore.subs.delete(f); }; }, () => meterStore.v);
  return [v, (n: MeterStyle) => { meterStore.v = n; try { localStorage.setItem("rv-meter", n); } catch { /* ignore */ } meterStore.subs.forEach(f => f()); }];
}
function MeterToggle({ v, set }: { v: MeterStyle; set: (v: MeterStyle) => void }) {
  return (
    <span className="rv-mtoggle" onClick={e => e.stopPropagation()}>
      <button type="button" className={v === "dial" ? "is-on" : ""} onClick={() => set("dial")}>Dial</button>
      <button type="button" className={v === "bar" ? "is-on" : ""} onClick={() => set("bar")}>Bar</button>
    </span>
  );
}
function MiniMeter({ soFar, heading, plan, style, big }: { soFar: number; heading: number; plan: number; style: MeterStyle; big?: boolean }) {
  const hi = Math.max(plan, heading, soFar, 1e-9) * 1.05;
  const tone = plan ? (heading >= plan ? "good" : heading >= plan * 0.95 ? "watch" : "bad") : "na";
  if (style === "bar") {
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / hi) * 100))}%`;
    return (
      <div className={`rv-mbar ${tone}${big ? " big" : ""}`}>
        <i className="fill" style={{ width: pct(soFar) }} />
        <i className="head" style={{ left: pct(heading) }} />
        <i className="plan" style={{ left: pct(plan) }} />
      </div>
    );
  }
  const R = 38, cx = 50, cy = 48;
  const lo = Math.max(0, Math.min(plan, heading, soFar) * 0.6);
  const ang = (n: number) => Math.PI - Math.max(0, Math.min(1, (n - lo) / (hi - lo || 1))) * Math.PI;
  const pt = (n: number, r: number) => ({ x: cx + r * Math.cos(ang(n)), y: cy - r * Math.sin(ang(n)) });
  const sf = pt(soFar, R - 6), hd = pt(heading, R - 6), pl = pt(plan, R);
  return (
    <svg viewBox="0 0 100 56" className={`rv-mdial ${tone}`}>
      <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} className="trk" />
      {plan ? <circle cx={pl.x} cy={pl.y} r={3.5} className="pl" /> : null}
      <line x1={cx} y1={cy} x2={hd.x} y2={hd.y} className="hd" />
      <line x1={cx} y1={cy} x2={sf.x} y2={sf.y} className="sf" />
      <circle cx={cx} cy={cy} r={3} className="hub" />
    </svg>
  );
}

/* ── New-clinic drop-off + touch Sankey (Shyam, 2026-10-13) ─────────────── */
type Touch = { call: number; meeting: number; consult: number; vct: number };
function LeadTable({ leads, onClose }: { leads: { id: string; name: string; date: string; state: string | null; practice: string | null }[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const days = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
  const rows = leads.filter(l => !q || `${l.name} ${l.practice ?? ""} ${l.state ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="rca-card rca-drill rv-focus-table">
      <div className="rca-drill-head">
        <div>
          <div className="rca-eyebrow">Signups behind this number</div>
          <div className="rca-drill-title">Signed up, no order yet · {leads.length} signups</div>
          <div className="rca-sub">Signed up in this window and no order by the window end</div>
        </div>
        <div className="rca-drill-actions"><button type="button" className="rca-tab" onClick={onClose}>close</button></div>
      </div>
      <input className="rca-search-input rca-filter-search" placeholder="Find signup…" value={q} onChange={e => setQ(e.target.value)} />
      <table className="rca-table"><thead><tr><th>Signup</th><th>Practice</th><th>State</th><th>Signed up</th><th>Days since</th></tr></thead>
        <tbody>{rows.slice(0, 300).map(l => (
          <tr key={l.id}><td>{l.name}</td><td>{l.practice ?? "—"}</td><td>{l.state ?? "—"}</td><td>{l.date}</td><td>{days(l.date)}</td></tr>
        ))}</tbody></table>
      {rows.length > 300 ? <p className="rv-dim rv-small">Showing the 300 most recent of {rows.length}.</p> : null}
    </div>
  );
}

function NewClinicFlow({ ids, onList, signups = 0, leadCount, onLeads }: { ids: string[][]; onList: (label: string, ids: string[]) => void; signups?: number; leadCount?: number; onLeads?: () => void }) {
  const run = useRcaAction(api.newClinicTouches.newClinicTouches);
  const seq = useRcaQuery(api.newClinicFunnel.seqFor, ids[0]?.length ? { password: pw(), clinics: ids[0] } : "skip");
  const [touch, setTouch] = useState<Record<string, Touch & { ev?: { d: string; k: string }[] }> | null>(null);
  const key = (ids[0] ?? []).join(",");
  useEffect(() => {
    let live = true;
    setTouch(null);
    if (!ids[0]?.length) { setTouch({}); return; }
    run({ password: pw(), clinics: ids[0] }).then(r => live && setTouch(r)).catch(() => live && setTouch({}));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);
  if (!ids[0]?.length) return null;
  if (!touch || !seq) return <p className="rv-dim rv-small">Loading calls, meetings, consults and VCTs…</p>;
  const reach = (c: string) => (ids[3].includes(c) ? 4 : ids[2].includes(c) ? 3 : ids[1].includes(c) ? 2 : 1);
  const RANK: Record<string, number> = { vct: 4, consult: 3, meeting: 2, call: 1 };
  const LBL = ["No touch", "Call", "Meeting", "Clinical consult", "VCT"];
  // strongest touch in (from, to]; from undefined = open start, to undefined = open end
  const tIn = (c: string, from?: string, to?: string) => {
    let best = 0;
    for (const e of touch[c]?.ev ?? []) if ((!from || e.d > from) && (!to || e.d <= to)) best = Math.max(best, RANK[e.k] ?? 0);
    return LBL[best];
  };
  // columns: Signup | touch | Order 1 | touch | Order 2 | touch | Order 3 | touch | Order 4
  const cols: string[][] = [["Signup"], [...LBL.slice().reverse(), "No order yet"], ["Order 1", "Didn't place order 1"]];
  for (let n = 2; n <= 4; n++) cols.push(LBL.slice().reverse(), [`Order ${n}`, `Didn't place order ${n}`]);
  const paths = new Map<string, (string | null)[]>();
  for (const c of ids[0]) {
    const od = seq[c]?.orders ?? [];
    const r = reach(c);
    const p: (string | null)[] = ["Signup", tIn(c, seq[c]?.signup ? addDaysStr(seq[c]!.signup!, -1) : undefined, od[0]), "Order 1"];
    for (let n = 2; n <= 4; n++) {
      if (r < n - 1) { p.push(null, null); continue; }
      p.push(tIn(c, od[n - 2], r >= n ? od[n - 1] : undefined), r >= n ? `Order ${n}` : `Didn't place order ${n}`);
    }
    paths.set(c, p);
  }
  const leads = Array.from({ length: leadCount ?? Math.max(0, signups - ids[0].length) }, (_, i) => `__lead${i}`);
  for (const c of leads) paths.set(c, ["Signup", "No order yet", "Didn't place order 1", null, null, null, null, null, null]);
  const all = [...ids[0], ...leads];
  const total = all.length;
  const W = 1000, H = 300, nw = 10, gap = 6;
  const colX = (i: number) => 20 + i * ((W - 140) / (cols.length - 1));
  const unit = (H - gap * 5) / total;
  const members = cols.map((col, ci) => col.map(nm => all.filter(c => paths.get(c)![ci] === nm)));
  const real = (l: string[]) => l.filter(c => !c.startsWith("__"));
  const pos = members.map(col => { let y = 0; return col.map(m => { const r = { y, h: m.length * unit }; y += m.length ? m.length * unit + gap : 0; return r; }); });
  const out: React.ReactNode[] = [];
  for (let ci = 0; ci < cols.length - 1; ci++) {
    const sOff = pos[ci].map(n => n.y), tOff = pos[ci + 1].map(n => n.y);
    cols[ci].forEach((sn, si) => cols[ci + 1].forEach((tn, ti) => {
      const list = members[ci][si].filter(c => paths.get(c)![ci + 1] === tn);
      if (!list.length) return;
      const h = list.length * unit, y0 = sOff[si] + h / 2, y1 = tOff[ti] + h / 2;
      sOff[si] += h; tOff[ti] += h;
      const x0 = colX(ci) + nw, x1 = colX(ci + 1);
      const drop = tn.startsWith("Didn't");
      out.push(<path key={`${ci}-${sn}-${tn}`} d={`M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`} className={`rv-sk-link${drop ? " o0" : tn.startsWith("Order") ? " o3" : ""}`} strokeWidth={Math.max(1, h)} onClick={() => real(list).length ? onList(`${sn} → ${tn}`, real(list)) : list.length && onLeads?.()}><title>{`${sn} → ${tn}: ${list.length} clinics`}</title></path>);
    }));
  }
  return (
    <div className="rv-sankey">
      <div className="rv-dim rv-small">Signup → order 1 → order 2 → order 3 → order 4, with the strongest touch (VCT &gt; consult &gt; meeting &gt; call) between each step. Red = didn't place the next order. Click a band or node for the clinics.</div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%">
        {out}
        {cols.map((col, ci) => col.map((nm, i) => members[ci][i].length ? (
          <g key={`${ci}${nm}`} className={`rv-sk-node${nm.startsWith("Didn't") ? " o0" : nm.startsWith("Order") || nm === "Signup" ? " o3" : ""}`} onClick={() => real(members[ci][i]).length ? onList(nm, real(members[ci][i])) : members[ci][i].length && onLeads?.()}>
            <rect x={colX(ci)} y={pos[ci][i].y} width={nw} height={Math.max(2, pos[ci][i].h)} />
            <text x={colX(ci) + nw + 3} y={pos[ci][i].y + pos[ci][i].h / 2 + 4} fontSize="10">{nm.replace("Didn't place order", "Dropped")} ({members[ci][i].length})</text>
          </g>
        ) : null))}
      </svg>
    </div>
  );
}
const addDaysStr = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
