import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useRcaAction, useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import { ProviderRetentionFunnel, useExecScorecard, usePillarStatus } from "./RepView";
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

/** Semicircle dial: filled to the heading as a share of goal (scale 60% to 110%), tick at 100%. */
function Dial({ name, pct, sub }: { name: string; pct: number | null; sub: string }) {
  const status = pct === null ? null : pct >= 100 ? "good" : pct >= 95 ? "watch" : "bad";
  const color = status === "good" ? GOOD : status === "watch" ? WARN : BAD;
  const label = status === "good" ? "On track" : status === "watch" ? "Watch" : status === "bad" ? "Behind" : "No goal set";
  const f = pct === null ? 0 : Math.max(0, Math.min(1, (pct - 60) / 50));
  const th = Math.PI * (1 - 0.8);
  const x = (r: number) => (80 + r * Math.cos(th)).toFixed(1);
  const y = (r: number) => (80 - r * Math.sin(th)).toFixed(1);
  return (
    <div className="ev-card ev-dial">
      <div className="nm">{name}</div>
      <svg width="150" height="90" viewBox="0 0 160 96">
        <path d="M 20 80 A 60 60 0 0 1 140 80" fill="none" stroke="var(--vw-gray-10)" strokeWidth="12" />
        <path d="M 20 80 A 60 60 0 0 1 140 80" fill="none" stroke={color} strokeWidth="12" strokeDasharray={`${(Math.PI * 60 * f).toFixed(1)} 400`} />
        <line x1={x(48)} y1={y(48)} x2={x(72)} y2={y(72)} stroke="var(--vw-ink)" strokeWidth="2" />
        <text x="80" y="76" textAnchor="middle" fontSize="22" fontFamily="var(--font-mono)" fill="var(--vw-ink)">{pct === null ? "—" : `${Math.round(pct)}%`}</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 500, color }}>{label}</div>
      <div className="sub">{sub}</div>
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

function Kpi({ name, value, sub, color, dot }: { name: string; value: string; sub: string; color?: string; dot: string }) {
  return (
    <div className="ev-card ev-kpi">
      <div className="top"><span>{name}</span><i className="dot" style={{ background: dot }} /></div>
      <div className="val" style={{ color: color ?? "var(--text-primary)" }}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

export function ExecutiveView({
  periods,
  windowLabel,
  onOpenFeed,
  onOpenTree,
}: {
  periods: ExecPeriod[];
  windowLabel: string;
  onOpenFeed: () => void;
  onOpenTree: (periodId: string) => void;
}) {
  const { tabs, tab, setSel } = usePeriodTabs(periods);
  const p = tab.p;
  const [cmp, setCmp] = useState<"goal" | "baseline" | "prev">("goal");
  // The period before this one of the same kind (last week for this week, and so on); none for the full window.
  const sameKind = periods.filter(x => x.kind === p.kind);
  const at = sameKind.findIndex(x => x.id === p.id);
  const prevP = tab.key !== "all" && at > 0 ? sameKind[at - 1] : null;
  const PREV = ({ week: ["WoW", "last week"], month: ["MoM", "last month"], quarter: ["QoQ", "last quarter"] } as Record<string, [string, string]>)[tab.key];
  const cmpOn = cmp === "prev" && !!prevP && !!PREV;
  const baseOn = cmp === "baseline" && p.baseline !== undefined && p.baseline > 0;
  const real = p.realChange ?? (p.baseline !== undefined ? p.actual - p.baseline : 0);
  const runRepeat = useRcaAction(api.newClinicFunnel.repeatPatients);
  const [rp, setRp] = useState<{ ready: boolean; window?: number; repeat?: number } | null>(null);
  useEffect(() => {
    let live = true;
    setRp(null);
    runRepeat({ password: pw(), periodId: p.id }).then(r => live && setRp(r)).catch(() => live && setRp({ ready: false }));
    return () => { live = false; };
  }, [p.id, runRepeat]);
  const fun = useRcaQuery(api.newClinicFunnel.orderRetentionFunnel, { password: pw(), periodId: p.id, sales: COMPANY });
  const order3 = fun?.ready ? fun.stages.find(x => x.n === 3) : undefined;

  const proj = useRcaQuery(api.projection.summary, { password: pw() });
  const reps = useRcaQuery(api.geo.salesReps, { password: pw(), periodId: p.id });
  const feed = useRcaQuery(api.feed.feed, { password: pw() });
  const geo = useRcaQuery(api.geo.geoSummary, { password: pw(), periodId: p.id });
  const sc = useExecScorecard(COMPANY, p.id);

  // Headline: the gap, then the two biggest drags across the volume/price and cohort lenses.
  const drags = [...p.lensA, ...p.lensC]
    .filter(r => r.value < 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);
  const behind = p.delta < 0;
  const headline =
    `${tab.label === "Full window" ? "Over the full window" : tab.label}, revenue is ${plain(Math.abs(p.delta))} ${behind ? "below" : "above"} goal` +
    (drags.length ? `, led by ${drags.map(d => `${d.label.toLowerCase()} (${money(d.value)})`).join(" and ")}.` : ".");

  // Per day, this window against the one before it (windows differ in length, so totals are not comparable).
  const perDay = (v: number, x: ExecPeriod) => v / Math.max(1, x.days);
  const chg = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
  const revChg = prevP ? chg(perDay(p.actual, p), perDay(prevP.actual, prevP)) : null;
  const headlineShown =
    baseOn
      ? `${tab.label === "Full window" ? "Over the full window" : tab.label}, revenue is ${plain(Math.abs(real))} ${real >= 0 ? "above" : "below"} its baseline run rate` + (p.ambition ? `; the goal asks for ${plain(p.ambition)} more than baseline.` : ".")
      : cmpOn && revChg !== null && PREV
      ? `Per day, revenue is ${Math.abs(revChg).toFixed(0)}% ${revChg >= 0 ? "above" : "below"} ${PREV[1]}, at ${plain(perDay(p.actual, p))} a day against ${plain(perDay(prevP!.actual, prevP!))}.`
      : headline;
  const chgTxt = (c: number | null) => (c === null ? "" : ` · ${c >= 0 ? "+" : "-"}${Math.abs(c).toFixed(0)}%`);

  const attain = p.expected ? (p.actual / p.expected) * 100 : 0;
  const newRow = p.lensC.find(r => /new/i.test(r.label) && !/churn/i.test(r.label));
  const newRev = newRow?.real ?? 0;

  // Every state's gap, from the geography query; the six worst from the bridge are the fallback while it loads.
  const geoRows = ((geo?.rows ?? []) as Array<{ code: string; kind: string; delta: number }>).filter(r => r.kind === "state");
  const states = new Map<string, number>(geoRows.length ? geoRows.map(r => [r.code, r.delta]) : p.topStates.map(s => [s.state, s.value]));
  const worst = [...states.values()].reduce((m, v) => Math.min(m, v), 0);
  const best = [...states.values()].reduce((m, v) => Math.max(m, v), 0);
  // Shade by size of the gap: deeper red for bigger shortfalls, deeper green for bigger leads.
  const tileColor = (v: number) => {
    const share = v < 0 ? v / (worst || -1) : v / (best || 1);
    const a = 0.25 + 0.75 * Math.min(1, Math.sqrt(share));
    return { background: `color-mix(in srgb, ${v < 0 ? BAD : GOOD} ${Math.round(a * 100)}%, var(--vw-white))`, color: a > 0.55 ? "var(--vw-white)" : "var(--text-primary)" };
  };

  const repRows = ((reps ?? []) as Array<{ name: string; actual: number; expected: number; delta: number; clinics: number }>)
    .filter(r => r.expected > 0)
    .map(r => ({ ...r, pc: (r.delta / r.expected) * 100 }))
    .sort((a, b) => b.pc - a.pc);

  const signals = ((feed?.items ?? []) as Feed[])
    .filter(i => i.tone === "alert" || i.tone === "good")
    .slice(0, 3);

  const projReady = proj && proj.ready ? proj : null;

  return (
    <div className="ev">
      <div>
        <div className="ev-eyebrow">Overview · {windowLabel}</div>
        <h2 className="ev-headline">{headlineShown}</h2>
      </div>

      <div className="ev-periodbar">
        <div className="ev-caption">
          {shortDate(p.start)} – {shortDate(p.end)} · {plain(p.actual)} actual against {plain(p.expected)} goal
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" className="ev-link" onClick={() => onOpenTree(p.id)}>Open root cause for this window</button>
          <div className="ev-seg">
            <button type="button" className={cmp === "goal" || (cmp === "prev" && !cmpOn) || (cmp === "baseline" && !baseOn) ? "is-on" : ""} onClick={() => setCmp("goal")}>vs goal</button>
            {p.baseline !== undefined ? <button type="button" className={baseOn ? "is-on" : ""} onClick={() => setCmp("baseline")}>vs baseline</button> : null}
            {prevP && PREV ? <button type="button" className={cmpOn ? "is-on" : ""} onClick={() => setCmp("prev")}>vs previous · {PREV[0]}</button> : null}
          </div>
          <div className="ev-seg">
            {tabs.map(t => (
              <button key={t.key} type="button" className={t.key === tab.key ? "is-on" : ""} onClick={() => setSel(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <section>
        <div className="ev-sechead">
          <div className="ev-sectitle">Outlook</div>
          <div className="ev-secsub">Company-wide, through {projReady ? shortDate(projReady.ytd.end) : shortDate(p.end)}.</div>
        </div>
        <div className="ev-grid3">
          {projReady ? (
            <div className="ev-card ev-outlook">
              <div className="ev-eyebrow">Year-end outlook</div>
              <div className="ev-big"><b style={{ color: projReady.gap > 0 ? BAD : GOOD }}>{plain(projReady.projected.close)}</b><span>projected close</span></div>
              <div className="ev-track"><i style={{ width: `${Math.min(100, (projReady.projected.close / projReady.target) * 100)}%`, background: "var(--vw-blue)" }} /></div>
              <div className="ev-row">
                <span>{Math.round((projReady.projected.close / projReady.target) * 100)}% of the {plain(projReady.target)} target</span>
                <span className="mono" style={{ color: projReady.gap > 0 ? BAD : GOOD }}>{projReady.gap > 0 ? `-${plain(projReady.gap)} short` : `+${plain(-projReady.gap)} ahead`}</span>
              </div>
              <div className="ev-trio">
                <div><div className="k">Booked so far</div><div className="v">{plain(projReady.ytd.revenue)}</div></div>
                <div><div className="k">Still needed</div><div className="v" style={{ color: BAD }}>{plain(projReady.neededRemaining)}</div></div>
                <div><div className="k">Per weekday</div><div className="v">{plain(projReady.pace.workdayNeeded)}</div></div>
              </div>
              <div className="ev-note">{int(projReady.pace.remainingDays)} days left. At the current run rate a trading weekday brings {plain(projReady.pace.workdayProjected)} against the {plain(projReady.pace.workdayNeeded)} needed.</div>
            </div>
          ) : null}

          {baseOn && p.baseline ? (
            <div className="ev-card ev-outlook">
              <div className="ev-eyebrow">{tab.label} vs baseline</div>
              <div className="ev-big"><b style={{ color: tone(real) }}>{plain(p.actual)}</b><span>against a {plain(p.baseline)} baseline</span></div>
              <div className="ev-track"><i style={{ width: `${Math.min(100, (p.actual / p.baseline) * 100)}%`, background: p.actual >= p.baseline ? GOOD : WARN }} /></div>
              <div className="ev-row"><span>{Math.round((p.actual / p.baseline) * 100)}% of baseline</span><span className="mono" style={{ color: tone(real) }}>{money(real)} vs baseline</span></div>
              <div className="ev-trio">
                <div><div className="k">Goal</div><div className="v">{plain(p.expected)}</div></div>
                <div><div className="k">Goal stretch</div><div className="v">{p.ambition !== undefined ? plain(p.ambition) : "—"}</div></div>
                <div><div className="k">Avg order</div><div className="v">${int(p.aov)}</div></div>
              </div>
              <div className="ev-note">Baseline is the mean run rate of the baseline period, scaled to this window. The goal is the baseline plus the stretch needed to reach the annual target, so beating the baseline is real growth and beating the goal is the plan.</div>
            </div>
          ) : cmpOn && prevP && PREV ? (
            <div className="ev-card ev-outlook">
              <div className="ev-eyebrow">{tab.label} vs {PREV[1]} · per day</div>
              <div className="ev-big"><b style={{ color: tone(revChg ?? 0) }}>{plain(perDay(p.actual, p))}</b><span>a day, against {plain(perDay(prevP.actual, prevP))}</span></div>
              <div className="ev-row"><span>{revChg === null ? "" : `${Math.abs(revChg).toFixed(0)}% ${revChg >= 0 ? "above" : "below"} ${PREV[1]}`}</span><span className="mono">{p.days} days vs {prevP.days}</span></div>
              <div className="ev-trio">
                <div><div className="k">Orders / day</div><div className="v">{perDay(p.orders, p).toFixed(0)}</div></div>
                <div><div className="k">{PREV[1]}</div><div className="v">{perDay(prevP.orders, prevP).toFixed(0)}</div></div>
                <div><div className="k">Avg order</div><div className="v">${int(p.aov)}</div></div>
              </div>
              <div className="ev-note">Windows are different lengths, so everything here is per day. Order value was ${int(prevP.aov)} {PREV[1]}.</div>
            </div>
          ) : (
          <div className="ev-card ev-outlook">
            <div className="ev-eyebrow">{tab.label} vs goal</div>
            <div className="ev-big"><b style={{ color: behind ? BAD : GOOD }}>{plain(p.actual)}</b><span>of {plain(p.expected)} goal</span></div>
            <div className="ev-track"><i style={{ width: `${Math.min(100, attain)}%`, background: attain >= 95 ? GOOD : WARN }} /></div>
            <div className="ev-row"><span>{Math.round(attain)}% of goal</span><span className="mono" style={{ color: tone(p.delta) }}>{money(p.delta)} vs goal</span></div>
            <div className="ev-trio">
              <div><div className="k">Baseline</div><div className="v">{p.baseline !== undefined ? plain(p.baseline) : "—"}</div></div>
              <div><div className="k">Orders</div><div className="v">{int(p.orders)}</div></div>
              <div><div className="k">Avg order</div><div className="v">${int(p.aov)}</div></div>
            </div>
            <div className="ev-note">Orders are {pct(Math.abs((p.orders / (p.expectedOrders || 1) - 1) * 100))} {p.orders < p.expectedOrders ? "under" : "over"} what the goal implies ({int(p.expectedOrders)} expected). Order value is {p.aov >= p.baseAov ? "above" : "below"} baseline (${int(p.baseAov)}).</div>
          </div>
          )}

          <div className="ev-card ev-outlook">
            <div className="ev-eyebrow">New business</div>
            <div className="ev-big"><b style={{ color: p.newGoal && newRev < p.newGoal ? "#795b35" : GOOD }}>{plain(newRev)}</b><span>{p.newGoal ? `of ${plain(p.newGoal)} goal` : "from new clinics"}</span></div>
            <div className="ev-track"><i style={{ width: `${p.newGoal ? Math.min(100, (newRev / p.newGoal) * 100) : 0}%`, background: p.newGoal && newRev >= p.newGoal ? GOOD : WARN }} /></div>
            <div className="ev-row">
              <span>{p.newGoal ? `${Math.round((newRev / p.newGoal) * 100)}% of the new-business goal` : "No new-business goal set"}</span>
              {p.newGoal ? <span className="mono" style={{ color: newRev >= p.newGoal ? GOOD : "#795b35" }}>{newRev >= p.newGoal ? `+${plain(newRev - p.newGoal)} ahead` : `-${plain(p.newGoal - newRev)} to go`}</span> : null}
            </div>
            <div className="ev-note">Revenue from clinics with no baseline: first order this year or returning after a long gap. Churn on existing clinics is in the root cause view.</div>
          </div>
        </div>
      </section>


      {sc.ready ? (
        <section>
          <div className="ev-sechead">
            <div className="ev-sectitle">Pillar health</div>
            <div className="ev-secsub">{tab.label}, {shortDate(p.start)} – {shortDate(p.end)}. The tick marks 100% of goal.</div>
          </div>
          <div className="ev-dials">
            {sc.dials.map(d => <Dial key={d.name} {...d} />)}
          </div>
        </section>
      ) : null}

      <section>
        <div className="ev-sechead">
          <div className="ev-sectitle">Overall KPIs</div>
          <div className="ev-secsub">{tab.label}, {shortDate(p.start)} – {shortDate(p.end)}. Counts of clinics are as of the latest data.</div>
        </div>
        <div className="ev-grid3">
          <Kpi
            name={cmpOn ? "Revenue per day" : baseOn ? "Revenue vs baseline" : "Revenue vs goal"}
            value={cmpOn ? plain(perDay(p.actual, p)) : baseOn ? money(real) : money(p.delta)}
            sub={cmpOn && prevP && PREV ? `was ${plain(perDay(prevP.actual, prevP))} a day ${PREV[1]}${chgTxt(revChg)}` : baseOn ? `${pct((p.actual / (p.baseline || 1)) * 100)} of a ${plain(p.baseline ?? 0)} baseline` : `${pct(attain)} of ${plain(p.expected)}`}
            color={cmpOn ? tone(revChg ?? 0) : baseOn ? tone(real) : tone(p.delta)}
            dot={(cmpOn ? (revChg ?? 0) >= 0 : baseOn ? real >= 0 : !behind) ? GOOD : BAD}
          />
          <Kpi
            name={cmpOn ? "Orders per day" : "Orders"}
            value={cmpOn ? perDay(p.orders, p).toFixed(0) : int(p.orders)}
            sub={cmpOn && prevP && PREV ? `was ${perDay(prevP.orders, prevP).toFixed(0)} a day ${PREV[1]}${chgTxt(chg(perDay(p.orders, p), perDay(prevP.orders, prevP)))}` : `${int(p.expectedOrders)} expected`}
            color={p.orders < p.expectedOrders ? BAD : undefined}
            dot={p.orders < p.expectedOrders ? BAD : GOOD}
          />
          <Kpi
            name="Avg order value"
            value={`$${int(p.aov)}`}
            sub={cmpOn && prevP && PREV ? `was $${int(prevP.aov)} ${PREV[1]}${chgTxt(chg(p.aov, prevP.aov))}` : `baseline $${int(p.baseAov)}`}
            dot={p.aov >= (cmpOn && prevP ? prevP.aov : p.baseAov) ? GOOD : WARN}
          />
          <Kpi
            name="Repeat patients"
            value={rp?.ready && rp.repeat !== undefined ? int(rp.repeat) : "—"}
            sub={rp?.ready && rp.window ? `of ${int(rp.window)} patients had ordered before ${shortDate(p.start)} · ${Math.round(((rp.repeat ?? 0) / rp.window) * 100)}%` : rp === null ? "loading" : "not available"}
            dot={rp?.ready && rp.window ? ((rp.repeat ?? 0) / rp.window >= 0.5 ? GOOD : WARN) : "var(--vw-gray-10)"}
          />
          <Kpi
            name="Buying clinics overdue"
            value={sc.overdue !== null ? int(sc.overdue) : "—"}
            sub="past their usual reorder, not yet churned"
            color={sc.overdue ? BAD : undefined}
            dot={sc.overdue ? BAD : GOOD}
          />
          <Kpi
            name="New clinics reaching order 3"
            value={order3 ? int(order3.clinics) : "—"}
            sub={order3 && fun?.ready ? `of ${int(fun.clinics)} new clinics${fun.clinics ? ` · ${Math.round((order3.clinics / fun.clinics) * 100)}%` : ""}` : "loading"}
            dot={!order3 || !fun?.ready || !fun.clinics ? "var(--vw-gray-10)" : order3.clinics / fun.clinics >= 0.28 ? GOOD : WARN}
          />
        </div>
        {sc.families.length ? (
          <>
            <div className="ev-sechead" style={{ marginTop: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Product families</div>
              <div className="ev-secsub">Orders against expected, by family</div>
            </div>
            <div className="ev-fams">
              {sc.families.filter(x => !x.isNew).map(x => {
                const g = x.expectedOrders ? x.orders / x.expectedOrders - 1 : null;
                return (
                  <Kpi
                    key={x.family}
                    name={x.family}
                    value={`${int(x.orders)} orders`}
                    sub={`${int(x.expectedOrders)} expected · ${g === null ? "—" : `${g >= 0 ? "+" : "-"}${Math.abs(g * 100).toFixed(1)}%`} vs expected`}
                    color={g !== null && g < -0.05 ? BAD : undefined}
                    dot={g === null ? "var(--vw-gray-10)" : g >= 0 ? GOOD : g > -0.05 ? WARN : BAD}
                  />
                );
              })}
            </div>
            {sc.families.some(x => x.isNew) ? (
              <>
                <div className="ev-secsub" style={{ margin: "14px 0 8px" }}>New releases: no fair baseline yet, so no expected orders or colour.</div>
                <div className="ev-fams">
                  {sc.families.filter(x => x.isNew).map(x => (
                    <Kpi key={x.family} name={x.family} value={`${int(x.orders)} orders`} sub={x.daysLive !== undefined ? `${x.daysLive} days live` : "new release"} dot="var(--vw-gray-30)" />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      <section>
        <div className="ev-sechead">
          <div className="ev-sectitle">New business funnel</div>
          <div className="ev-secsub">New clinics this window, signup to order 5, with the touches between each step.</div>
        </div>
        <div className="ev-funnel"><ProviderRetentionFunnel periodId={p.id} sales={COMPANY} /></div>
      </section>

      <div className="ev-split">
        <div className="ev-card" style={{ padding: "18px 20px" }}>
          <div className="ev-sectitle">Revenue gap by state</div>
          <div className="ev-secsub" style={{ marginTop: 3 }}>{tab.label}, against goal. Darker means a bigger gap.</div>
          <div className="ev-map">
            {Object.entries(TILES).map(([code, [c, r]]) => {
              const v = states.get(code);
              return (
                <div key={code} className="ev-tile" style={{ gridColumn: c + 1, gridRow: r + 1, ...(v !== undefined ? tileColor(v) : {}) }}>
                  <span className="c">{code}</span>
                  <span className="n">{v !== undefined ? money(v) : ""}</span>
                </div>
              );
            })}
          </div>
          <div className="ev-legend">
            <span><i style={{ background: BAD }} />Behind goal</span>
            <span><i style={{ background: GOOD }} />Ahead of goal</span>
            <span><i style={{ background: "var(--vw-gray-05)", border: "1px solid var(--vw-gray-10)" }} />No orders</span>
          </div>
        </div>
        <div className="ev-card" style={{ padding: "18px 20px" }}>
          <div className="ev-sectitle">Biggest gaps by state</div>
          <div className="ev-secsub" style={{ marginTop: 3 }}>Largest shortfalls and leads, {tab.label.toLowerCase()}.</div>
          <div className="ev-statelist">
            {[...states.entries()].sort((a, b2) => a[1] - b2[1]).slice(0, 8).map(([code, v]) => (
              <div className="row" key={code}>
                <span>{code}</span>
                <span className="ev-bar"><span className="mid" /><span className="fill" style={{ left: v < 0 ? `${50 - (Math.abs(v) / (Math.abs(worst) || 1)) * 50}%` : "50%", width: `${(Math.abs(v) / (Math.abs(worst) || 1)) * 50}%`, background: tone(v) }} /></span>
                <span className="ev-mono" style={{ color: tone(v) }}>{money(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sc.ready ? (
        <div className="ev-card" style={{ overflow: "hidden" }}>
          <div className="ev-sc-head">
            <div>
              <div className="ev-sectitle">Scorecard</div>
              <div className="ev-secsub" style={{ marginTop: 3 }}>Every pillar and metric for the whole company, {tab.label.toLowerCase()}.</div>
            </div>
            <div className="ev-legend" style={{ margin: 0 }}>
              <span><i style={{ background: GOOD, borderRadius: "50%" }} />On track</span>
              <span><i style={{ background: WARN, borderRadius: "50%" }} />Watch</span>
              <span><i style={{ background: BAD, borderRadius: "50%" }} />Behind</span>
              <span><i style={{ background: "var(--vw-gray-30)", borderRadius: "50%" }} />Where to act</span>
            </div>
          </div>
          {sc.rows.map(r => (
            <div className="ev-sc-row" key={r.pillar}>
              <div className="ev-sc-pillar">{r.pillar === "Bundle growth" ? "AOV" : r.pillar}</div>
              {r.cells.map(c => (
                <div className="ev-sc-cell" key={c.label}>
                  <div className="top"><span>{c.label}</span><i className="dot" style={{ background: TONE_DOT[c.tone] }} /></div>
                  <div className="val">{c.value}</div>
                  <div className="sub" style={{ color: c.tone === "bad" ? BAD : undefined }} title={c.sub}>{c.sub}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {repRows.length ? (
        <div className="ev-card ev-team">
          <div className="ev-sectitle">Team performance</div>
          <div className="ev-note" style={{ marginTop: 4, maxWidth: 640 }}>Revenue against each rep's own goal, {tab.label.toLowerCase()} ({shortDate(p.start)} – {shortDate(p.end)}). Bars run to ±50%.</div>
          <div className="ev-team-head"><div>Rep</div><div style={{ textAlign: "right" }}>Clinics</div><div>Against goal</div><div style={{ textAlign: "right" }}>% to goal</div></div>
          {repRows.map(r => {
            const w = (Math.min(Math.abs(r.pc), 50) / 50) * 50;
            const pos = r.pc >= 0;
            return (
              <div className="ev-team-row" key={r.name}>
                <div className="nm">{r.name}</div>
                <div className="cl">{int(r.clinics)}</div>
                <div className="ev-bar"><div className="mid" /><div className="fill" style={{ left: `${pos ? 50 : 50 - w}%`, width: `${w}%`, background: tone(r.pc) }} /></div>
                <div className="pc" style={{ color: tone(r.pc) }}>{pos ? "+" : "-"}{Math.abs(r.pc).toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      ) : null}

      {signals.length ? (
        <section>
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
