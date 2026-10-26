import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import "./exec.css";

/** The slice of a bridge period this view reads. */
export type ExecPeriod = {
  id: string;
  kind: "all" | "quarter" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  actual: number;
  expected: number;
  delta: number;
  baseline?: number;
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
  const last = (k: ExecPeriod["kind"]) => [...periods].reverse().find(p => p.kind === k);
  const tabs = useMemo(
    () =>
      [
        { key: "week", label: "This week", p: last("week") },
        { key: "month", label: "This month", p: last("month") },
        { key: "quarter", label: "This quarter", p: last("quarter") },
        { key: "all", label: "Full window", p: periods.find(p => p.id === "all") },
      ].filter((t): t is { key: string; label: string; p: ExecPeriod } => !!t.p),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periods],
  );
  const [sel, setSel] = useState("all");
  const tab = tabs.find(t => t.key === sel) ?? tabs[tabs.length - 1];
  const p = tab.p;

  const proj = useRcaQuery(api.projection.summary, { password: pw() });
  const reps = useRcaQuery(api.geo.salesReps, { password: pw(), periodId: p.id });
  const feed = useRcaQuery(api.feed.feed, { password: pw() });

  // Headline: the gap, then the two biggest drags across the volume/price and cohort lenses.
  const drags = [...p.lensA, ...p.lensC]
    .filter(r => r.value < 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);
  const behind = p.delta < 0;
  const headline =
    `${tab.label === "Full window" ? "Over the full window" : tab.label}, revenue is ${plain(Math.abs(p.delta))} ${behind ? "below" : "above"} goal` +
    (drags.length ? `, led by ${drags.map(d => `${d.label.toLowerCase()} (${money(d.value)})`).join(" and ")}.` : ".");

  const attain = p.expected ? (p.actual / p.expected) * 100 : 0;
  const newRow = p.lensC.find(r => /new/i.test(r.label) && !/churn/i.test(r.label));
  const newRev = newRow?.real ?? 0;

  const states = new Map(p.topStates.map(s => [s.state, s.value]));
  const otherNet = 0;
  void otherNet;

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
        <h2 className="ev-headline">{headline}</h2>
      </div>

      <div className="ev-periodbar">
        <div className="ev-caption">
          {shortDate(p.start)} – {shortDate(p.end)} · {plain(p.actual)} actual against {plain(p.expected)} goal
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" className="ev-link" onClick={() => onOpenTree(p.id)}>Open root cause for this window</button>
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

      <div className="ev-split">
        <div className="ev-card" style={{ padding: "18px 20px" }}>
          <div className="ev-sectitle">Revenue gap by state</div>
          <div className="ev-secsub" style={{ marginTop: 3 }}>{tab.label}, against goal. The six worst states are shaded.</div>
          <div className="ev-map">
            {Object.entries(TILES).map(([code, [c, r]]) => {
              const v = states.get(code);
              return (
                <div key={code} className="ev-tile" style={{ gridColumn: c + 1, gridRow: r + 1, ...(v !== undefined ? { background: v < 0 ? BAD : GOOD, color: "var(--vw-white)" } : {}) }}>
                  <span className="c">{code}</span>
                  <span className="n">{v !== undefined ? money(v) : ""}</span>
                </div>
              );
            })}
          </div>
          <div className="ev-legend">
            <span><i style={{ background: BAD }} />Behind goal</span>
            <span><i style={{ background: GOOD }} />Ahead of goal</span>
            <span><i style={{ background: "var(--vw-gray-05)", border: "1px solid var(--vw-gray-10)" }} />Other states</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Overall KPIs</div>
          <div className="ev-kpis">
            <Kpi name="Revenue vs goal" value={money(p.delta)} sub={`${pct(attain)} of ${plain(p.expected)}`} color={tone(p.delta)} dot={behind ? BAD : GOOD} />
            <Kpi name="Orders" value={int(p.orders)} sub={`${int(p.expectedOrders)} expected`} color={p.orders < p.expectedOrders ? BAD : undefined} dot={p.orders < p.expectedOrders ? BAD : GOOD} />
            <Kpi name="Avg order value" value={`$${int(p.aov)}`} sub={`baseline $${int(p.baseAov)}`} dot={p.aov >= p.baseAov ? GOOD : WARN} />
            <Kpi name="Patients" value={int(p.patients)} sub={`${int(p.expectedPatients)} expected`} color={p.patients < p.expectedPatients ? BAD : undefined} dot={p.patients < p.expectedPatients ? BAD : GOOD} />
          </div>
        </div>
      </div>

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
