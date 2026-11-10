import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useRcaAction, useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import { isFzFamily } from "@/lib/fzAgenda";
import { cellDelta, ExecClinicList, type ExecSel, MiniMeter, ProviderRetentionFunnel, useExecScorecard, usePillarStatus } from "./RepView";
import { overviewTourAvailable, startOverviewTour } from "@/lib/usertour";
import "./exec.css";

/** The slice of a bridge period this view reads. */
export type ExecPeriod = {
  id: string;
  kind: "all" | "quarter" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  days: number;
  actual: number;
  expected: number;
  delta: number;
  baseline?: number;
  realChange?: number;
  ambition?: number;
  newGoal?: number;
  orders: number;
  expectedOrders: number;
  baselineOrders?: number;
  aov: number;
  baseAov: number;
  patients: number;
  expectedPatients: number;
  lensA: Array<{ label: string; value: number }>;
  lensB: Array<{ label: string; value: number }>;
  lensC: Array<{ label: string; value: number; key: string; real?: number }>;
  topStates: Array<{ state: string; value: number }>;
};

const COMPANY = "team:*";
const COHORTS: Record<string, string> = {
  churned: "Churned clinics",
  new: "New clinics (active)",
  retained_top20: "Active — top 20%",
  retained_rest: "Active — remaining 80%",
  reactivated: "Reactivated clinics",
};

/** The company period re-expressed through one team lead's clinics (the same scopeTotals the root cause tree uses).
 * Until the lead's numbers arrive `ready` is false, so the page never shows company figures under a lead's name. */
function useScopedPeriod(base: ExecPeriod | null | undefined, lead?: string): { p: ExecPeriod | null | undefined; ready: boolean } {
  const st = useRcaQuery(api.geo.scopeTotals, lead && base ? { password: pw(), periodId: base.id, teamLead: lead } : "skip");
  return useMemo(() => {
    if (!lead || !base) return { p: base, ready: true };
    if (!st || !st.ready) return { p: base, ready: false };
    return {
      ready: true,
      p: {
        ...base,
        actual: st.actual, expected: st.expected, delta: st.delta,
        baseline: st.baseline, realChange: st.realChange, ambition: st.ambition, newGoal: st.newGoal,
        orders: st.orders, expectedOrders: st.expectedOrders, baselineOrders: st.baselineOrders,
        aov: st.aov, baseAov: st.baseAov, patients: st.patients, expectedPatients: st.expectedPatients,
        lensA: [
          { label: "Order volume", value: st.volume },
          { label: "Average order value", value: st.aovEffect },
          { label: "Patient traffic", value: st.patients - st.expectedPatients },
        ],
        lensC: (st.cohorts ?? []).map(c => ({ label: COHORTS[c.cohort] ?? c.cohort, value: c.delta, key: c.cohort, real: c.real })),
        topStates: [],
      },
    };
  }, [st, base, lead]);
}
const GOOD = "var(--vw-success)";
const BAD = "var(--vw-error)";
const WARN = "var(--vw-warning)";

const money = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "+";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
};
const plain = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number, d = 0) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(d)}%`;
const shortDate = (s: string) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tone = (n: number) => (n >= 0 ? GOOD : BAD);

/** US tile map: [column, row] on an 11 x 8 grid. */
const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [10, 0], VT: [9, 1], NH: [10, 1], WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3], CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5], OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6], HI: [0, 7], TX: [3, 7], FL: [8, 7],
};


const TONE_DOT: Record<string, string> = { good: GOOD, watch: WARN, bad: BAD, act: "var(--vw-gray-30)", na: "var(--vw-gray-10)" };

type MeterData = ReturnType<typeof useExecScorecard>["meters"][number];
type Trend = { tag: string; txt: string; good: boolean | null; perDay?: boolean };
type ViewMeter = MeterData & { elapsed: boolean; refText: string; vs: string; trend?: Trend | null };
type ViewOpts = {
  mode: "goal" | "baseline";
  elapsed: boolean;
  scale: number;
};

/** The change against the same measure a period earlier ("QoQ ▲4.1% /day"), where it can be told. */
const Delta = ({ t }: { t?: Trend | null }) =>
  t ? <div className={`ev-delta ${t.good === null ? "" : t.good ? "up" : "dn"}`}>{t.tag} {t.txt}{t.perDay ? " /day" : ""}</div> : null;

/** A dial against the goal or the baseline, for the days elapsed (so far against it) or for the whole period (heading against it).
 * The whole-period baseline is the baseline so far scaled by the goal's weekday shape. AOV is a rate, so it is never stretched. */
function viewOf(m: MeterData, o: ViewOpts, trend?: Trend | null): ViewMeter {
  const rate = m.pillar === "Bundle growth";
  let plan = o.elapsed ? m.planTo : m.plan;
  let lbl = o.elapsed && m.planTo && m.planTo !== m.plan ? `${m.planLbl} to date` : m.planLbl;
  let vs = "goal";
  let refText = o.elapsed ? "goal to date" : "the period goal";
  if (o.mode === "baseline") {
    plan = m.baseTo ? (rate || o.elapsed ? m.baseTo : m.baseTo * o.scale) : 0;
    lbl = plan ? (rate ? "baseline AOV" : o.elapsed ? "baseline to date" : "baseline for the period") : "no baseline";
    vs = "baseline";
    refText = o.elapsed ? "baseline to date" : "the period baseline";
  }
  const heading = o.elapsed ? m.soFar : m.heading;
  return { ...m, heading, headingT: m.fmt(heading), plan, planT: plan ? m.fmt(plan) : "—", planLbl: lbl, elapsed: o.elapsed, refText, vs, trend };
}

/** One outcome dial, the same as the rep view: so far, heading and what it is compared to, and the clinics it is measured over. */
function Meter({ m, hero, on, onPick }: { m: ViewMeter; hero?: boolean; on?: boolean; onPick: () => void }) {
  const tone = m.plan ? (m.heading >= m.plan ? "good" : m.heading >= m.plan * 0.95 ? "watch" : "bad") : "na";
  return (
    <button type="button" className={`rv-outm${hero ? " rv-outm-hero" : ""}${on ? " is-sel" : ""} ev-t-${tone}`} onClick={onPick} title="Click for the clinics behind this dial">
      <div className="rv-eyebrow">{m.pillar}{m.tag ? <em className="rv-allp"> · {m.tag}</em> : null}</div>
      <b>{m.label}</b>
      <MiniMeter soFar={m.soFar} heading={m.heading} plan={m.plan} style="dial" big={hero} />
      <div className="rv-outm-nums">
        <span><i className="sw sofar" />So far <b>{m.soFarT}</b></span>
        {m.elapsed ? null : <span><i className="sw heading" />Projected <b>{m.headingT}</b></span>}
        <span><i className="sw plan" />{m.planLbl} <b>{m.planT}</b></span>
      </div>
      <Delta t={m.trend} />
      <ClinicsLine m={m} />
    </button>
  );
}

function ClinicsLine({ m }: { m: MeterData }) {
  return (
    <div className="rv-outm-clin" title={`Clinics this dial is measured over: ${m.clinics.why}`}>
      <b>{m.clinics.ordered !== undefined ? `${m.clinics.ordered} of ${m.clinics.n}` : (m.clinics.n ?? "…")}</b> {m.clinics.ordered !== undefined ? "clinics ordered" : "clinics"}
      <span>{m.clinics.why} · of {m.bookClinics} in the book</span>
    </div>
  );
}

/** The same dial as a card: the number so far, how far it is to what it is compared to, and the clinics behind it. */
function MeterCard({ m, hero, on, onPick }: { m: ViewMeter; hero?: boolean; on?: boolean; onPick: () => void }) {
  const tone = m.plan ? (m.heading >= m.plan ? "good" : m.heading >= m.plan * 0.95 ? "watch" : "bad") : "na";
  const color = tone === "good" ? GOOD : tone === "bad" ? BAD : tone === "watch" ? "#795b35" : "var(--text-primary)";
  const attain = m.plan ? (m.soFar / m.plan) * 100 : null;
  const off = m.plan ? (m.heading / m.plan - 1) * 100 : null;
  const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(0)}%`;
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } };
  return (
    <div className={`ev-card ev-outlook ev-click ev-t-${tone}${hero ? " ev-outlook-hero" : ""}${on ? " is-on" : ""}`} onClick={onPick} onKeyDown={key} role="button" tabIndex={0} title="Click for the clinics behind this card">
      <div className="ev-eyebrow">{m.pillar}{m.tag ? ` · ${m.tag}` : ""}</div>
      <div className="ev-note" style={{ marginTop: -6 }}>{m.label}</div>
      <div className="ev-big"><b style={{ color }}>{m.soFarT}</b><span>{m.plan ? `of ${m.planT} ${m.planLbl}` : m.planLbl}</span></div>
      <div className="ev-track">
        <i style={{ width: `${attain === null ? 0 : Math.min(100, attain)}%`, background: tone === "good" ? GOOD : tone === "bad" ? BAD : WARN }} />
      </div>
      <div className="ev-row">
        <span>{attain === null ? `No ${m.vs} to compare` : `${Math.round(attain)}% of ${m.refText}`}</span>
        {off !== null ? <span className="mono" style={{ color }}>{m.elapsed ? "" : "projected "}{signed(off)} vs {m.vs}</span> : null}
      </div>
      <div className="ev-trio">
        <div><div className="k">So far</div><div className="v">{m.soFarT}</div></div>
        {m.elapsed ? null : <div><div className="k">Projected</div><div className="v">{m.headingT}</div></div>}
        <div><div className="k">{m.planLbl}</div><div className="v">{m.planT}</div></div>
      </div>
      <Delta t={m.trend} />
      <ClinicsLine m={m} />
    </div>
  );
}

/** This week / month / quarter / full window, taken from the bridge periods. */
function usePeriodTabs(periods: ExecPeriod[]) {
  const tabs = useMemo(() => {
    const last = (k: ExecPeriod["kind"]) => [...periods].reverse().find(x => x.kind === k);
    return [
      { key: "week", label: "This week", p: last("week") },
      { key: "month", label: "This month", p: last("month") },
      { key: "quarter", label: "This quarter", p: last("quarter") },
      { key: "all", label: "Full window", p: periods.find(x => x.id === "all") },
    ].filter((t): t is { key: string; label: string; p: ExecPeriod } => !!t.p);
  }, [periods]);
  const [sel, setSel] = useState("all");
  const tab = tabs.find(t => t.key === sel) ?? tabs[tabs.length - 1];
  return { tabs, tab, setSel };
}

const PILLARS: Array<[string, string]> = [["New Business", "New Biz"], ["Bundle growth", "AOV"], ["Product Growth", "Product"], ["Retention", "Retention"], ["Expansion", "Expansion"], ["Combined", "Combined"]];
const STATUS_CHIP = {
  good: { bg: "var(--vw-success-bg)", color: "var(--vw-success)", label: "On track" },
  watch: { bg: "var(--vw-warning-bg)", color: "#795b35", label: "Watch" },
  behind: { bg: "var(--vw-error-bg)", color: "var(--vw-error)", label: "Behind" },
};

function HeatRow({ name, scope, periodId, bold }: { name: string; scope: string; periodId: string; bold?: boolean }) {
  const st = usePillarStatus(scope, periodId);
  const behind = st ? PILLARS.filter(([k]) => st[k] === "behind").length : null;
  return (
    <div className="ev-heat-row" style={bold ? { background: "var(--vw-gray-02)" } : undefined}>
      <div style={{ textAlign: "left", fontSize: 14, fontWeight: bold ? 600 : 500 }}>{name}</div>
      {PILLARS.map(([k]) => {
        const c = st?.[k] ? STATUS_CHIP[st[k]] : null;
        return (
          <div key={k}>
            {c ? <span className="ev-chip" style={{ background: c.bg, color: c.color }}>{c.label}</span> : <span className="ev-chip" style={{ color: "var(--text-disabled)" }}>…</span>}
          </div>
        );
      })}
      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: behind !== null && behind >= 3 ? BAD : "var(--text-secondary)" }}>{behind === null ? "" : `${behind} of 6`}</div>
    </div>
  );
}

/** Status per pillar for every rep, each from that rep's own scorecard, with the two teams and the company underneath. */
export function TeamsView({ periods, windowLabel }: { periods: ExecPeriod[]; windowLabel: string }) {
  const { tabs, tab, setSel } = usePeriodTabs(periods);
  const p = tab.p;
  const reps = useRcaQuery(api.geo.salesReps, { password: pw(), periodId: p.id });
  const leads = useRcaQuery(api.geo.teamLeads, { password: pw() });
  const names = ((reps ?? []) as Array<{ name: string; expected: number; delta: number }>)
    .filter(r => r.expected > 0)
    .sort((a, b) => a.delta / a.expected - b.delta / b.expected)
    .map(r => r.name);
  return (
    <div className="ev">
      <div>
        <div className="ev-eyebrow">Teams · {windowLabel}</div>
        <h2 className="ev-headline">Where each rep and team stands on every pillar.</h2>
      </div>
      <div className="ev-periodbar">
        <div className="ev-caption">{shortDate(p.start)} – {shortDate(p.end)} · reps listed from furthest behind goal to furthest ahead</div>
        <div className="ev-seg">
          {tabs.map(t => (
            <button key={t.key} type="button" className={t.key === tab.key ? "is-on" : ""} onClick={() => setSel(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="ev-banner"><b>Work in progress.</b> This tab is still being built: it judges each pillar by the rep scorecard's own rules and does not follow the goal / baseline or To date / To period end switches yet.</div>
      <div className="ev-card ev-heat">
        <div className="ev-heat-row hd">
          <div style={{ textAlign: "left" }}>Rep</div>
          {PILLARS.map(([k, short]) => <div key={k}>{short}</div>)}
          <div style={{ textAlign: "right" }}>Behind</div>
        </div>
        {names.map(n => <HeatRow key={`${p.id}|${n}`} name={n} scope={n} periodId={p.id} />)}
        {((leads ?? []) as string[]).map(l => <HeatRow key={`${p.id}|team|${l}`} name={`${l}'s team`} scope={`team:${l}`} periodId={p.id} bold />)}
        <HeatRow key={`${p.id}|all`} name="Company" scope={COMPANY} periodId={p.id} bold />
      </div>
      <div className="ev-secsub">Status per pillar from each rep's own scorecard: any red metric makes the pillar Behind, any amber makes it Watch. Team rows treat the whole book as one.</div>
    </div>
  );
}


type Feed = { id: string; tag: string; tone: "alert" | "watch" | "good" | "info"; q: string; a: string };

/** Same fills as the rep view: green on track, amber watch, red behind, blue where to act, dashed white for new releases. */
const dotTone = (dot: string) => (dot === GOOD ? "good" : dot === WARN ? "watch" : dot === BAD ? "bad" : dot === "var(--vw-gray-30)" ? "act" : "na");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Kpi({ name, value, sub, color, dot, fill, onClick, on, trend, rule, tour }: { tour?: string; name: string; value: string; sub: string; color?: string; dot: string; fill?: string; onClick?: () => void; on?: boolean; trend?: Trend | null; rule?: boolean }) {
  return (
    <div data-tour={tour} className={`ev-card ev-kpi ev-t-${fill ?? dotTone(dot)}${onClick ? " ev-click" : ""}${on ? " is-on" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}>
      <div className="top"><span>{name}{rule ? <em className="ev-rule">own rule</em> : null}</span><i className="dot" style={{ background: dot }} /></div>
      <div className="val" style={{ color: color ?? "var(--text-primary)" }}>{value}</div>
      <div className="sub">{sub}</div>
      <Delta t={trend} />
    </div>
  );
}

export function ExecutiveView({
  periods,
  windowLabel,
  onOpenFeed,
  onOpenTree,
  teamLead,
}: {
  periods: ExecPeriod[];
  windowLabel: string;
  /** The top bar's team lead filter: the whole page is then that lead's team (the lead and every rep under them). */
  teamLead?: string;
  onOpenFeed: () => void;
  onOpenTree: (periodId: string) => void;
}) {
  const { tabs, tab, setSel } = usePeriodTabs(periods);
  const scope = teamLead ? `team:${teamLead}` : COMPANY;
  const scopeName = teamLead ? `${teamLead}'s team` : "the whole company";
  const sp = useScopedPeriod(tab.p, teamLead);
  const p = sp.p!;
  const [cmp, setCmp] = useState<"goal" | "baseline">("goal");
  // How the pillar KPIs are drawn, and which goal they are measured against.
  const [design, setDesign] = useState<"dials" | "cards">("dials");
  const [basis, setBasis] = useState<"window" | "elapsed">("elapsed");
  // The period before this one of the same kind (last week for this week, and so on); none for the full window.
  const sameKind = periods.filter(x => x.kind === p.kind);
  const at = sameKind.findIndex(x => x.id === p.id);
  const prevP0 = tab.key !== "all" && at > 0 ? sameKind[at - 1] : null;
  const prevScoped = useScopedPeriod(prevP0, teamLead);
  const prevP = prevScoped.ready ? prevScoped.p ?? null : null;
  const PREV = ({ week: ["WoW", "last week"], month: ["MoM", "last month"], quarter: ["QoQ", "last quarter"] } as Record<string, [string, string]>)[tab.key];
  const baseOn = cmp === "baseline" && p.baseline !== undefined && p.baseline > 0;
  const runRepeat = useRcaAction(api.newClinicFunnel.repeatPatients);
  const [rp, setRp] = useState<{ ready: boolean; window?: number; repeat?: number } | null>(null);
  useEffect(() => {
    let live = true;
    setRp(null);
    if (teamLead) { setRp({ ready: false }); return () => { live = false; }; }
    runRepeat({ password: pw(), periodId: p.id }).then(r => live && setRp(r)).catch(() => live && setRp({ ready: false }));
    return () => { live = false; };
  }, [p.id, runRepeat, teamLead]);
  const fun = useRcaQuery(api.newClinicFunnel.orderRetentionFunnel, { password: pw(), periodId: p.id, sales: scope });
  const order3 = fun?.ready ? fun.stages.find(x => x.n === 3) : undefined;
  // Order 3 is judged like for like: of the new clinics old enough to have had `days` since order 1, the share that got
  // there in that time, against the same share for the baseline period's new clinics. Heading-vs-goal colours (95% = watch).
  const o3 = (() => {
    const g = fun?.ready ? fun.order3 : undefined;
    if (!order3 || !fun?.ready || !g) return { sub: "loading", dot: "var(--vw-gray-10)" };
    const rate = (x: { n: number; of: number }) => (x.of ? x.n / x.of : null);
    const cur = rate(g.cur);
    const base = g.base ? rate(g.base) : null;
    const lead = `${int(fun.clinics)} new clinics, ${int(order3.clinics)} reached order 3`;
    if (g.cur.of < 10) return { sub: `${lead}. Too early to judge: only ${g.cur.of} are ${g.days}+ days past order 1`, dot: "var(--vw-gray-30)" };
    const mine = `${g.cur.n} of ${g.cur.of} clinics ${g.days}+ days in got there within ${g.days} days (${Math.round((cur ?? 0) * 100)}%)`;
    if (base === null || !g.base || g.base.of < 10) return { sub: `${mine}. No baseline rate to compare`, dot: "var(--vw-gray-30)" };
    const ratio = (cur ?? 0) / (base || 1);
    return { sub: `${mine} vs ${Math.round(base * 100)}% in the baseline`, dot: ratio >= 1 ? GOOD : ratio >= 0.95 ? WARN : BAD };
  })();

  const proj = useRcaQuery(api.projection.summary, { password: pw(), teamLead: teamLead || undefined });
  const reps = useRcaQuery(api.geo.salesReps, { password: pw(), periodId: p.id, teamLead: teamLead || undefined });
  const feed = useRcaQuery(api.feed.feed, { password: pw(), teamLead: teamLead || undefined });
  const geo = useRcaQuery(api.geo.geoSummary, { password: pw(), periodId: p.id, teamLead: teamLead || undefined });
  const [fam, setFam] = useState("");
  const mode: "goal" | "baseline" = baseOn ? "baseline" : "goal";
  const refName = baseOn ? "baseline" : "goal";
  const sc = useExecScorecard(scope, p.id, fam, { mode, elapsed: basis === "elapsed" });
  // The same scorecard a period earlier, for the WoW / MoM / QoQ chips (the same switches, so a chip compares like with like).
  const prevSc = useExecScorecard(scope, prevP?.id, fam, { mode, elapsed: basis === "elapsed" });
  // One basis for the whole page: the days elapsed so far, or the whole period.
  const canBasis = !!sc.total && sc.windowDays > sc.elapsedDays;
  const el = basis === "elapsed" || !canBasis;
  const T = sc.total;
  const daysLeft = Math.max(0, sc.windowDays - sc.elapsedDays);
  // The goal for the whole period is the goal itself; the baseline for it is the baseline so far scaled by the goal's weekday shape.
  const wScale = el || !T ? 1 : sc.scale;
  const goalPlan = el || !T ? p.expected : T.plan;
  const basePlan = (p.baseline ?? 0) * wScale;
  const planNow = baseOn ? basePlan : goalPlan;
  // Colour and sign always come from the days elapsed (are we on pace); the period-end view only restates the target.
  const goalDelta = p.actual - p.expected;
  const baseDelta = p.actual - (p.baseline ?? 0);
  const ordRef = baseOn && p.baselineOrders ? p.baselineOrders : p.expectedOrders;
  const behindNow = (baseOn ? baseDelta : goalDelta) < 0;
  const attain = planNow ? (p.actual / planNow) * 100 : 0;
  // The clinic list behind a dial or a scorecard cell, shown under whichever was clicked.
  const [open, setOpen] = useState<{ from: "dial" | "cell"; sel: ExecSel } | null>(null);
  useEffect(() => setOpen(null), [p.id, fam]);
  const openList = (from: "dial" | "cell", cell: string) => {
    const sel = sc.pick(cell);
    setOpen(o => (!sel || (o && o.sel.key === sel.key && o.from === from) ? null : { from, sel }));
  };

  // Per day, this window against the one before it (windows differ in length, so totals are not comparable).
  const perDay = (v: number, x: ExecPeriod) => v / Math.max(1, x.days);
  const tag = PREV?.[0];
  const trendOf = (cur: number | null | undefined, prv: number | null | undefined, perDayChip = false): Trend | null => {
    if (!tag || !prevP || !cur || !prv) return null;
    const d = cur / prv - 1;
    return { tag, txt: `${d >= 0 ? "▲" : "▼"}${Math.abs(d * 100).toFixed(1)}%`, good: d >= 0, perDay: perDayChip };
  };

  // Headline: the gap, then the two biggest drags across the volume/price and cohort lenses.
  const drags = [...p.lensA, ...p.lensC]
    .filter(r => r.value < 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);
  const lead = tab.label === "Full window" ? "Over the full window" : tab.label;
  const headline = !el
    ? `${lead}, revenue has reached ${pct(attain)} of the ${plain(planNow)} ${refName} for the whole period, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`
    : baseOn
    ? `${lead}, revenue is ${plain(Math.abs(baseDelta))} ${baseDelta >= 0 ? "above" : "below"} its baseline run rate` + (p.ambition ? `; the goal asks for ${plain(p.ambition)} more than baseline.` : ".")
    : `${lead}, revenue is ${plain(Math.abs(goalDelta))} ${goalDelta < 0 ? "below" : "above"} goal` +
      (drags.length ? `, led by ${drags.map(d => `${d.label.toLowerCase()} (${money(d.value)})`).join(" and ")}.` : ".");
  const caption = el
    ? `${plain(p.actual)} actual against ${plain(planNow)} ${refName} to date`
    : `${plain(p.actual)} booked against ${plain(planNow)} ${refName} for the whole period${baseOn ? " (scaled by the weekday shape)" : ""}`;

  // Every state's gap, from the geography query; the six worst from the bridge are the fallback while it loads.
  // Against the goal or the baseline (whichever the switch says), to date: the gap sets the colour. In the period-end view the tile
  // shows the share of the whole period's reference reached instead, since a gap to a target that is still ahead is not a gap yet.
  const refOf = (r: { expected: number; baseline: number }) => (baseOn ? r.baseline : r.expected);
  const geoRows = ((geo?.rows ?? []) as Array<{ code: string; kind: string; actual: number; expected: number; baseline: number; delta: number }>).filter(r => r.kind === "state");
  const states = new Map<string, number>(
    geoRows.length ? geoRows.map(r => [r.code, r.actual - refOf(r)]) : baseOn ? [] : p.topStates.map(s => [s.state, s.value]),
  );
  const reached = new Map<string, number>(geoRows.filter(r => refOf(r) > 0).map(r => [r.code, (r.actual / (refOf(r) * wScale)) * 100]));
  const worst = [...states.values()].reduce((m, v) => Math.min(m, v), 0);
  const best = [...states.values()].reduce((m, v) => Math.max(m, v), 0);
  // Shade by size of the gap: deeper red for bigger shortfalls, deeper green for bigger leads.
  const tileColor = (v: number) => {
    const share = v < 0 ? v / (worst || -1) : v / (best || 1);
    const a = 0.25 + 0.75 * Math.min(1, Math.sqrt(share));
    return { background: `color-mix(in srgb, ${v < 0 ? BAD : GOOD} ${Math.round(a * 100)}%, var(--vw-white))`, color: a > 0.55 ? "var(--vw-white)" : "var(--text-primary)" };
  };

  const repRows = ((reps ?? []) as Array<{ name: string; actual: number; expected: number; baseline: number; delta: number; clinics: number }>)
    .filter(r => refOf(r) > 0)
    .map(r => ({ ...r, pc: ((r.actual - refOf(r)) / refOf(r)) * 100, reached: (r.actual / (refOf(r) * wScale)) * 100 }))
    .sort((a, b) => b.pc - a.pc);

  const signals = ((feed?.items ?? []) as Feed[])
    .filter(i => i.tone === "alert" || i.tone === "good")
    .slice(0, 3);

  const projReady = proj && proj.ready ? proj : null;

  return (
    <div className="ev" style={sp.ready ? undefined : { opacity: 0.45 }} aria-busy={!sp.ready}>
      {teamLead ? <div className="ev-banner" style={{ borderStyle: "solid" }}>Showing <b>{teamLead}</b>'s team (the lead and every rep under them){sp.ready ? "" : ": loading, the figures below are still the company's"}. Repeat patients is company-wide only for now.</div> : null}
      <div>
        <div className="ev-eyebrow">Overview · {windowLabel}</div>
        <h2 className="ev-headline" data-tour="ov-headline">{headline}</h2>
      </div>

      <div className="ev-periodbar">
        <div className="ev-caption">
          {shortDate(p.start)} – {shortDate(p.end)} · {caption}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {overviewTourAvailable ? <button type="button" className="ev-link" data-tour="ov-take-tour" onClick={startOverviewTour}>Take a tour</button> : null}
          <button type="button" className="ev-link" onClick={() => onOpenTree(p.id)}>Open root cause for this window</button>
          <div className="ev-seg" data-tour="ov-compare">
            <button type="button" className={!baseOn ? "is-on" : ""} onClick={() => setCmp("goal")}>vs goal</button>
            {p.baseline !== undefined ? <button type="button" className={baseOn ? "is-on" : ""} onClick={() => setCmp("baseline")}>vs baseline</button> : null}
          </div>
          {canBasis ? (
            <div className="ev-seg" data-tour="ov-basis" title="Measure the whole page over the days elapsed, or over the whole period">
              <button type="button" className={el ? "is-on" : ""} onClick={() => setBasis("elapsed")}>To date</button>
              <button type="button" className={!el ? "is-on" : ""} onClick={() => setBasis("window")}>To period end</button>
            </div>
          ) : null}
          <div className="ev-seg" data-tour="ov-period">
            {tabs.map(t => (
              <button key={t.key} type="button" className={t.key === tab.key ? "is-on" : ""} onClick={() => setSel(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {projReady ? (
        <section>
          <div className="ev-sechead">
            <div className="ev-sectitle">Outlook</div>
            <div className="ev-secsub">{teamLead ? `${teamLead}'s team` : "Company-wide"}, through {shortDate(projReady.ytd.end)}.</div>
          </div>
          <div className="ev-card ev-outlook ev-outlook-wide" data-tour="ov-outlook">
            <div className="ev-outlook">
              <div className="ev-eyebrow">Year-end outlook</div>
              <div className="ev-big"><b style={{ color: projReady.gap > 0 ? BAD : GOOD }}>{plain(projReady.projected.close)}</b><span>projected close</span></div>
              <div className="ev-track"><i style={{ width: `${Math.min(100, (projReady.projected.close / projReady.target) * 100)}%`, background: "var(--vw-blue)" }} /></div>
              <div className="ev-row">
                <span>{Math.round((projReady.projected.close / projReady.target) * 100)}% of the {plain(projReady.target)} target</span>
                <span className="mono" style={{ color: projReady.gap > 0 ? BAD : GOOD }}>{projReady.gap > 0 ? `-${plain(projReady.gap)} short` : `+${plain(-projReady.gap)} ahead`}</span>
              </div>
            </div>
            <div className="ev-outlook">
              <div className="ev-trio" style={{ borderTop: 0, paddingTop: 0 }}>
                <div><div className="k">Booked so far</div><div className="v">{plain(projReady.ytd.revenue)}</div></div>
                <div><div className="k">Still needed</div><div className="v" style={{ color: BAD }}>{plain(projReady.neededRemaining)}</div></div>
                <div><div className="k">Per weekday</div><div className="v">{plain(projReady.pace.workdayNeeded)}</div></div>
              </div>
              <div className="ev-note">{int(projReady.pace.remainingDays)} days left. At the current run rate a trading weekday brings {plain(projReady.pace.workdayProjected)} against the {plain(projReady.pace.workdayNeeded)} needed.</div>
            </div>
          </div>
        </section>
      ) : null}

      {sc.ready ? (
        <section data-tour="ov-pillars">
          <div className="ev-sechead">
            <div className="ev-sectitle">Pillar health</div>
            <div className="ev-secsub">
              {tab.label}, {shortDate(p.start)} – {shortDate(p.end)}.{" "}
              {el
                ? `Booked so far against the ${refName} for the days elapsed, through ${shortDate(p.end)}.`
                : `Projected is where the period is on course to finish (the dial's own projection), against the ${refName} for the whole period.${baseOn ? " The baseline for the whole period is the baseline so far, scaled by the goal's weekday shape." : ""}${design === "dials" ? " Solid needle is booked so far, dotted is projected, and the marker is the " + refName + "." : ""}`}
              {tag ? ` ${tag} is the change against the previous ${PREV?.[1].replace("last ", "")}, per day for amounts.` : ""}
            </div>
          </div>
          <div className="ev-ctrls">
            <div className="ev-seg" data-tour="ov-design">
              <button type="button" className={design === "dials" ? "is-on" : ""} onClick={() => setDesign("dials")}>Dials</button>
              <button type="button" className={design === "cards" ? "is-on" : ""} onClick={() => setDesign("cards")}>Cards</button>
            </div>
          </div>
          {sc.scoped ? (
            <div className="rv-scope" style={{ marginBottom: 12 }}>
              <span>Dials and scorecard are scoped to <b>{sc.family}</b>. Retention and expansion are not family-specific yet, so they stay on all products.</span>
              <button type="button" onClick={() => setFam("")}>Back to all products</button>
            </div>
          ) : null}
          {(() => {
            const Item = design === "dials" ? Meter : MeterCard;
            const one = (m: MeterData, hero?: boolean) => {
              const rate = m.pillar === "Bundle growth";
              const pm = prevSc.meters.find(x => x.pillar === m.pillar);
              const trend = trendOf(rate ? m.soFar : m.soFar / Math.max(1, sc.elapsedDays), pm ? (rate ? pm.soFar : pm.soFar / Math.max(1, prevSc.elapsedDays)) : null, !rate);
              return (
                <Item
                  key={m.pillar}
                  m={viewOf(!sc.scoped && m.pillar === "Combined" ? { ...m, baseTo: p.baseline ?? 0 } : m, { mode, elapsed: el, scale: sc.scale }, trend)}
                  hero={hero}
                  on={open?.from === "dial" && open.sel.key === m.cell}
                  onPick={() => openList("dial", m.cell)}
                />
              );
            };
            const hero = sc.meters.filter(m => m.pillar === "Combined");
            return (
              <>
                {hero.length ? <div className={design === "dials" ? "rv-outhero" : "ev-hero"}>{hero.map(m => one(m, true))}</div> : null}
                <div className={design === "dials" ? "rv-outmeters" : "ev-grid4"}>{sc.meters.filter(m => m.pillar !== "Combined").map(m => one(m))}</div>
              </>
            );
          })()}
          {open?.from === "dial" ? <div className="ev-list"><ExecClinicList sel={open.sel} sales={scope} periodId={p.id} onClose={() => setOpen(null)} /></div> : null}
        </section>
      ) : null}

      <section data-tour="ov-kpis">
        <div className="ev-sechead">
          <div className="ev-sectitle">Overall KPIs</div>
          <div className="ev-secsub">{tab.label}, {shortDate(p.start)} – {shortDate(p.end)}. Counts of clinics are as of the latest data. Tagged "own rule" use their own benchmark, whatever the switches say.</div>
        </div>
        <div className="ev-grid3">
          <Kpi
            name={el ? `Revenue vs ${refName}` : `Revenue, share of the ${refName} for the period`}
            value={el ? money(baseOn ? baseDelta : goalDelta) : pct(attain)}
            sub={el ? `${pct(attain)} of ${plain(planNow)}${baseOn ? " baseline" : ""}` : `${plain(p.actual)} of ${plain(planNow)} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            color={behindNow ? BAD : GOOD}
            dot={behindNow ? BAD : GOOD}
            trend={prevP ? trendOf(perDay(p.actual, p), perDay(prevP.actual, prevP), true) : null}
          />
          <Kpi
            name="Orders"
            value={int(p.orders)}
            sub={`${int(ordRef * wScale)} ${refName}${el ? "" : " for the period"}`}
            color={p.orders < ordRef ? BAD : undefined}
            dot={p.orders < ordRef ? BAD : GOOD}
            trend={prevP ? trendOf(perDay(p.orders, p), perDay(prevP.orders, prevP), true) : null}
          />
          {(() => {
            const ref = baseOn ? sc.aov.base : sc.aov.goal;
            const bp = baseOn ? sc.bundle.base : sc.bundle.goal;
            return (
              <Kpi
                name="Avg order value"
                value={`$${int(p.aov)}`}
                sub={ref ? `${refName} AOV $${int(ref)}${sc.bundle.cur !== null && bp !== null ? ` · bundles ${pct(sc.bundle.cur * 100, 1)} vs ${pct(bp * 100, 1)}` : ""}` : baseOn ? "no baseline AOV" : "no goal set: add the bundle penetration goal in Settings"}
                dot={ref ? (p.aov >= ref ? GOOD : WARN) : "var(--vw-gray-10)"}
                trend={prevP ? trendOf(p.aov, prevP.aov) : null}
              />
            );
          })()}
          <Kpi
            rule
            name="Repeat patients"
            value={rp?.ready && rp.repeat !== undefined ? int(rp.repeat) : "—"}
            sub={teamLead ? "company-wide only for now" : rp?.ready && rp.window ? `of ${int(rp.window)} patients had ordered before ${shortDate(p.start)} · ${Math.round(((rp.repeat ?? 0) / rp.window) * 100)}%` : rp === null ? "loading" : "not available"}
            dot={rp?.ready && rp.window ? ((rp.repeat ?? 0) / rp.window >= 0.5 ? GOOD : WARN) : "var(--vw-gray-10)"}
          />
          <Kpi
            rule
            name="Buying clinics overdue"
            value={sc.overdue !== null ? int(sc.overdue) : "—"}
            sub="past their usual reorder, not yet churned"
            color={sc.overdue ? BAD : undefined}
            dot={sc.overdue ? BAD : GOOD}
          />
          <Kpi
            rule
            name="New clinics reaching order 3"
            value={order3 ? int(order3.clinics) : "—"}
            sub={o3.sub}
            dot={o3.dot}
          />
        </div>
      </section>

      <div className="ev-split">
        <div className="ev-card" style={{ padding: "18px 20px" }} data-tour="ov-map">
          <div className="ev-sectitle">Revenue gap by state</div>
          <div className="ev-secsub" style={{ marginTop: 3 }}>{tab.label}, against {refName}{el ? " to date" : ": share of the whole period's " + refName + " reached, coloured by the gap to date"}. Darker means a bigger gap.</div>
          <div className="ev-map">
            {Object.entries(TILES).map(([code, [c, r]]) => {
              const v = states.get(code);
              return (
                <div key={code} className="ev-tile" style={{ gridColumn: c + 1, gridRow: r + 1, ...(v !== undefined ? tileColor(v) : {}) }}>
                  <span className="c">{code}</span>
                  <span className="n">{v === undefined ? "" : el || !reached.has(code) ? money(v) : pct(reached.get(code)!)}</span>
                </div>
              );
            })}
          </div>
          <div className="ev-legend">
            <span><i style={{ background: BAD }} />Behind {refName}</span>
            <span><i style={{ background: GOOD }} />Ahead of {refName}</span>
            <span><i style={{ background: "var(--vw-gray-05)", border: "1px solid var(--vw-gray-10)" }} />No orders</span>
          </div>
        </div>
        {repRows.length ? (
          <div className="ev-card ev-team" data-tour="ov-team">
            <div className="ev-sectitle">Team performance</div>
            <div className="ev-note" style={{ marginTop: 4, maxWidth: 640 }}>Revenue against each rep's own {refName}, {tab.label.toLowerCase()} ({shortDate(p.start)} – {shortDate(p.end)}). Bars run to ±50% of the {refName} to date{el ? "" : "; the figure is the share of the whole period's " + refName + " reached"}.</div>
            <div className="ev-team-head"><div>Rep</div><div style={{ textAlign: "right" }}>Clinics</div><div>Against {refName}</div><div style={{ textAlign: "right" }}>{el ? `vs ${refName}` : "of period"}</div></div>
            {repRows.map(r => {
              const w = (Math.min(Math.abs(r.pc), 50) / 50) * 50;
              const pos = r.pc >= 0;
              return (
                <div className="ev-team-row" key={r.name}>
                  <div className="nm">{r.name}</div>
                  <div className="cl">{int(r.clinics)}</div>
                  <div className="ev-bar"><div className="mid" /><div className="fill" style={{ left: `${pos ? 50 : 50 - w}%`, width: `${w}%`, background: tone(r.pc) }} /></div>
                  <div className="pc" style={{ color: tone(r.pc) }}>{el ? `${pos ? "+" : "-"}${Math.abs(r.pc).toFixed(1)}%` : pct(r.reached)}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {sc.families.length ? (
        <section data-tour="ov-families">
          <>
            <div className="ev-sechead">
              <div style={{ fontSize: 15, fontWeight: 500 }}>Product families</div>
              <div className="ev-secsub">Orders against the {refName}, by family. Click one to scope the dials and scorecard to it.</div>
            </div>
            <div className="ev-fams">
              {sc.families.filter(x => !x.isNew).map(x => {
                const toDate = baseOn ? x.baselineOrders : x.expectedOrders;
                const shown = el ? toDate : toDate * sc.scale;
                const g = toDate ? x.orders / toDate - 1 : null;
                const pf = prevSc.families.find(y => y.family === x.family);
                return (
                  <Kpi
                    key={x.family}
                    tour={`ov-fam-${slug(x.family)}`}
                    onClick={() => setFam(f => (f === x.family ? "" : x.family))}
                    on={sc.scoped && sc.family === x.family}
                    name={x.family}
                    value={`${int(x.orders)} orders`}
                    sub={!toDate ? `no ${refName}` : el ? `${int(shown)} ${refName} · ${g === null ? "—" : `${g >= 0 ? "+" : "-"}${Math.abs(g * 100).toFixed(1)}%`} vs ${refName}` : `${int(shown)} ${refName} for the period · ${pct((x.orders / (shown || 1)) * 100)} reached`}
                    color={g !== null && g < -0.05 ? BAD : undefined}
                    dot={g === null ? "var(--vw-gray-10)" : g >= 0 ? GOOD : g > -0.05 ? WARN : BAD}
                    trend={trendOf(x.orders / Math.max(1, sc.days), pf ? pf.orders / Math.max(1, prevSc.days) : null, true)}
                  />
                );
              })}
            </div>
            {sc.families.some(x => x.isNew) ? (
              <>
                <div className="ev-secsub" style={{ margin: "14px 0 8px" }}>New releases: no fair baseline yet, so no goal or colour.</div>
                <div className="ev-fams">
                  {sc.families.filter(x => x.isNew).map(x => (
                    <Kpi key={x.family} tour={`ov-fam-${slug(x.family)}`} onClick={() => setFam(f => (f === x.family ? "" : x.family))} on={sc.scoped && sc.family === x.family} name={x.family} value={`${int(x.orders)} orders`} sub={x.daysLive !== undefined ? `${x.daysLive} days live` : "new release"} dot="var(--vw-gray-30)" fill="new" />
                  ))}
                </div>
              </>
            ) : null}
          </>
        </section>
      ) : null}

      {sc.ready ? (
        <div className="ev-card" style={{ overflow: "hidden" }} data-tour="ov-scorecard">
          <div className="ev-sc-head">
            <div>
              <div className="ev-sectitle">Scorecard</div>
              <div className="ev-secsub" style={{ marginTop: 3 }}>Every pillar and metric for {scopeName}, {tab.label.toLowerCase()}. Cells that are a goal or baseline comparison follow the switches above; the ones tagged fixed keep their own rule.</div>
            </div>
            <div className="ev-legend" style={{ margin: 0 }}>
              <span><i style={{ background: GOOD, borderRadius: "50%" }} />On track</span>
              <span><i style={{ background: WARN, borderRadius: "50%" }} />Watch</span>
              <span><i style={{ background: BAD, borderRadius: "50%" }} />Behind</span>
              <span><i style={{ background: "var(--vw-gray-30)", borderRadius: "50%" }} />Where to act</span>
            </div>
          </div>
          {sc.scoped ? (
            <div className="ev-scope">
              <span>Scorecard scoped to <b>{sc.family}</b>. <i className="ev-famkey" /> Blue bar = follows {sc.family}; "all products" = not family-specific yet (retention and expansion).</span>
              <button type="button" className="ev-link" onClick={() => setFam("")}>Back to all products</button>
            </div>
          ) : null}
          {sc.rows.map(r => (
            <div className="ev-sc-row" key={r.pillar}>
              <div className="ev-sc-pillar">{r.pillar}</div>
              {r.cells.map(c => (
                <div className={`ev-sc-cell ev-t-${c.tone}${c.famScoped ? " is-fam" : ""}${c.ids?.length ? " ev-click" : ""}${open?.from === "cell" && open.sel.key === c.label ? " is-on" : ""}`} key={c.label} data-tour={`sc-${slug(c.label)}`} data-fz={sc.scoped && isFzFamily(sc.family) && c.label === "Cross-sell candidates" && c.ids?.length ? "ready" : undefined} onClick={c.ids?.length ? () => openList("cell", c.label) : undefined} title={c.ids?.length ? "Click for the clinics behind this number" : undefined}>
                  <div className="top"><span>{c.label}{sc.scoped && c.allProducts ? <em className="ev-rule">all products</em> : null}</span><i className="dot" style={{ background: TONE_DOT[c.tone] }} /></div>
                  <div className="val">{c.value}</div>
                  <div className="sub" style={{ color: c.tone === "bad" ? BAD : undefined }} title={c.sub}>{c.sub}</div>
                  {c.ref ? <div className={`ev-ref${c.ref.startsWith("fixed") ? " fixed" : ""}`}>{c.ref}</div> : null}
                  <Delta t={(() => {
                    const d = tag && prevSc.ready ? cellDelta(c, prevSc.rows.flatMap(r => r.cells).find(x => x.label === c.label), sc.days, prevSc.days) : null;
                    return d && tag ? { tag, txt: d.txt, good: d.good, perDay: c.flow } : null;
                  })()} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {open?.from === "cell" ? <div className="ev-list" data-tour="ov-cell-list"><ExecClinicList sel={open.sel} sales={scope} periodId={p.id} onClose={() => setOpen(null)} /></div> : null}

      <section data-tour="ov-funnel">
        <div className="ev-sechead">
          <div className="ev-sectitle">New business funnel</div>
          <div className="ev-secsub">New clinics this window, signup to order 5, with the touches between each step.</div>
        </div>
        <div className="ev-funnel"><ProviderRetentionFunnel periodId={p.id} sales={scope} /></div>
      </section>

      {signals.length ? (
        <section data-tour="ov-signals">
          <div className="ev-sechead">
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <div className="ev-sectitle">Growth signals</div>
              <div className="ev-secsub">From the Business Feed</div>
            </div>
            <button type="button" className="ev-link" onClick={onOpenFeed}>Open the Business Feed</button>
          </div>
          <div className="ev-grid3">
            {signals.map(s => (
              <div className="ev-sig" key={s.id}>
                <div className="hd" style={{ background: s.tone === "alert" ? "#fbf1f0" : "#eff7f1" }}>
                  <div className="tag">{s.tag}</div>
                  <div className="q">{s.q}</div>
                </div>
                <div className="a">{s.a}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
