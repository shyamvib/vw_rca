import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/api";
import { useRcaAction, useRcaQuery } from "@/lib/rca";
import {
  DEFAULT_WEIGHTS, DIMENSIONS, annualFactor, MATRIX, PILLARS, STATUSES, THRESHOLD, WEIGHT_KEYS, discover, overlapAdjusted, priority, recommendation, regionSplit, resolve,
  type ClinicLite, type FzLite, type LapsedLite, type ProviderLite, type WhitespaceLite, type Opp, type Pillar, type Saved, type Status, type Weights,
} from "@/lib/growthOpps";
import { geoKeyOf } from "../../analytics/geoKey";
import { pw } from "./gatePw";
import { type ExecPeriod, TILES } from "./ExecutiveView";
import { FocusTable, usePG } from "./RepView";
import "./growth.css";

const COMPANY = "team:*";
const PAGE = 8;
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
const int = (n: number) => Math.round(n).toLocaleString("en-US");

type Row = { opp: Opp; score: number; rec: ReturnType<typeof recommendation> | "Rejected" };

/** The clinics behind one opportunity, in the scorecard's clinic list (same columns, same expandable clinic card). */
function OppClinics({ opp, scope, onClose }: { opp: Opp; scope: string; onClose: () => void }) {
  const q = useRcaQuery(api.repView.rowsByFocus, { password: pw(), periodId: "all", sales: scope, focus: `ids:${opp.clinicIds.slice(0, 1500).join(",")}` });
  return (
    <FocusTable
      key={opp.id}
      label={`${opp.indicator} · ${opp.clinicIds.length.toLocaleString("en-US")} clinics`}
      eyebrow="Clinics behind this opportunity"
      sub={`${opp.indicatorValue}. The same list the scorecard opens, with the expandable clinic card.`}
      rows={q?.ready ? q.rows : null}
      onClose={onClose}
      periodId="all"
      sales={scope}
    />
  );
}

function Num({ value, onSave, disabled, min, max, step = 1, label }: { value: number | null; onSave: (n: number) => void; disabled: boolean; min?: number; max?: number; step?: number; label: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="gr-in" type="number" aria-label={label} disabled={disabled} min={min} max={max} step={step} value={text ?? (value ?? "")} placeholder="—"
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== null && text !== "" && Number.isFinite(Number(text))) onSave(Number(text)); setText(null); }}
    />
  );
}

/** What leadership can do with an opportunity at each stage, and where each choice takes it. */
const DECISIONS: Partial<Record<Status, { text: string; options: Array<{ label: string; to: Status; hint: string }> }>> = {
  Hypothesis: { text: "Not ready for a decision. Size it and gather evidence first.", options: [] },
  Quantified: { text: "Sized, but the target rate is still an assumption. Validate it with history, a pilot or a cohort, then set the status to Validated.", options: [{ label: "Mark validated", to: "Validated", hint: "the assumptions are backed by evidence" }] },
  Validated: { text: "The assumptions are backed by evidence. When the investment and owner are filled in, ask leadership to decide.", options: [{ label: "Ask for an investment decision", to: "Investment decision", hint: "puts it in front of leadership" }] },
  "Investment decision": {
    text: "Leadership decides what happens to this opportunity. Choose one outcome and write the reason.",
    options: [
      { label: "Fund", to: "Approved", hint: "commit the investment; the owner starts delivery" },
      { label: "Test further", to: "Validated", hint: "send it back for a pilot or more evidence; the note says what to test" },
      { label: "Reject", to: "Rejected", hint: "stop here; it stays in the list but leaves the totals" },
    ],
  },
  Approved: { text: "Funded. The owner starts delivery.", options: [{ label: "Start executing", to: "Executing", hint: "delivery is under way" }, { label: "Reject", to: "Rejected", hint: "withdraw the funding" }] },
  Executing: { text: "Under way. When results back the assumption, scale it up.", options: [{ label: "Scale", to: "Scaling", hint: "roll it out beyond the first group" }, { label: "Reject", to: "Rejected", hint: "stop; it did not work" }] },
  Scaling: { text: "Rolled out beyond the first group.", options: [] },
  Rejected: { text: "Rejected. It stays in the list, outside the totals.", options: [{ label: "Reopen", to: "Quantified", hint: "bring it back for another look" }] },
};

function Worksheet({ opp, canEdit, save, scope, weights, score }: { opp: Opp; canEdit: boolean; save: (patch: Saved) => void; scope: string; weights: Weights; score: number }) {
  const [list, setList] = useState(false);
  const [reason, setReason] = useState("");
  const dec = DECISIONS[opp.status];
  const m = MATRIX[opp.pillar];
  const sup = opp.source === "supporting";
  const chain = [
    { col: "Outcome", q: "did it happen?", label: m.out, note: opp.metric === m.out ? "the metric this opportunity moves" : "pillar outcome", cls: opp.metric === m.out ? "hot" : "" },
    { col: "Leading indicator", q: "will it happen?", label: m.lead[0], note: m.lead[1], cls: /needs|no data/.test(m.lead[1]) ? "na" : "" },
    sup ? { col: "Opportunity", q: "where to act", label: m.opp[0], note: `${m.opp[1]} (the pillar's scorecard cell)`, cls: "" } : { col: "Opportunity", q: "where to act", label: opp.indicator, note: opp.indicatorValue, cls: "hot" },
    { col: "Diagnostic", q: "why", label: m.diag[0], note: m.diag[1], cls: /needs|no data/.test(m.diag[1]) ? "na" : "" },
    ...(sup ? [{ col: "Supporting KPI", q: "beyond the scorecard", label: opp.indicator, note: `${opp.indicatorValue} · ${opp.from}`, cls: "sup hot" }] : []),
  ];
  const unit = opp.unit === "pairs" ? "clinic × family pairs" : "clinics";
  const formula = `${int(opp.n)} ${unit} × (${opp.tgtEff}% − ${opp.cur}%) × ${money(opp.value)} a year = ${money(opp.incr)}`;
  return (
    <div className="gr-ws">
      <div>
        <div className="gr-eye">Where this sits on the scorecard · {opp.pillar}</div>
        <div className="gr-chain">
          {chain.map(c => (
            <div key={c.col} className={`gr-cell ${c.cls}`}>
              <div className="gr-cell-h">{c.col} <span>· {c.q}</span></div>
              <b>{c.label}</b>
              <div className="gr-cell-n">{c.note}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="gr-ws-cols">
        <div className="gr-col">
          <div><div className="gr-eye">What the data shows</div><p>{opp.observation}</p></div>
          <div><div className="gr-eye">Proposed intervention</div><p>{opp.intervention}</p></div>
          <div><div className="gr-eye">Evidence</div><p>{opp.evidence}</p></div>
          {sup ? (
            <div className="gr-supbox">
              <div className="gr-eye">Supporting KPI under {opp.pillar}</div>
              <b>{opp.indicator}</b>
              <p>Derived from: {opp.from}. Not a scorecard cell today; shown here as a supporting KPI so the opportunity can be tracked next to the pillar's own indicators.</p>
            </div>
          ) : null}
          <div className="gr-btns">
            <button type="button" className="gr-btn" aria-expanded={list} onClick={() => setList(v => !v)}>{list ? "Hide the clinics" : `Open the ${int(opp.clinicIds.length)} clinics`}</button>
          </div>
        </div>
        <div className="gr-col">
          <div>
            <div className="gr-eye">Quantification</div>
            <div className="gr-formula">
              <div className="mono">{formula}</div>
              <div className="gr-note">Incremental revenue = clinics × (target rate − current rate) × annual value per clinic. The rate is {opp.rateLabel}. Clinics and value are measured from the data; the target rate is an assumption until it is validated.</div>
            </div>
          </div>
          <div className="gr-fields">
            <label>Target rate (%)<Num value={opp.tgtEff} onSave={n => save({ tgt: n })} disabled={!canEdit} min={0} max={100} label="Target rate" /></label>
            <label>Investment ($)<Num value={opp.investment} onSave={n => save({ investment: n })} disabled={!canEdit} min={0} step={1000} label="Investment" /></label>
            <label>Status
              <select className="gr-in" aria-label="Status" disabled={!canEdit} value={opp.status} onChange={e => save({ status: e.target.value as Status })}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>Owner
              <input className="gr-in" aria-label="Owner" disabled={!canEdit} defaultValue={opp.owner} key={opp.owner} onBlur={e => { if (e.target.value.trim() !== opp.owner) save({ owner: e.target.value }); }} />
            </label>
          </div>
          <div className="gr-decision">
            <div className="gr-eye">Investment decision · {opp.status}</div>
            <p>{dec?.text}</p>
            {opp.saved.note ? <div className="gr-note">Last note: {opp.saved.note}</div> : null}
            {canEdit && dec?.options.length ? (
              <>
                <input className="gr-in" aria-label="Reason or next step" placeholder="Reason or next step (saved with the decision)" value={reason} onChange={e => setReason(e.target.value)} />
                <div className="gr-btns">
                  {dec.options.map(o => (
                    <button type="button" key={o.label} className={`gr-btn${o.to === "Rejected" ? " ghost" : ""}`} title={o.hint} onClick={() => { save({ status: o.to, ...(reason.trim() ? { note: reason } : {}) }); setReason(""); }}>{o.label}</button>
                  ))}
                </div>
                <div className="gr-note">{dec.options.map(o => `${o.label}: ${o.hint}`).join(" · ")}</div>
              </>
            ) : null}
          </div>
          <div className="gr-eye">Portfolio bucket</div>
          <p>{opp.bucket}</p>
          {!canEdit ? <div className="gr-note">Read-only: only growth admins can change these.</div> : null}
        </div>
        <div className="gr-col">
          <div className="gr-eye">Priority score {score.toFixed(1)} of 5</div>
          {DIMENSIONS.map(([k, name, src]) => {
            const tot = WEIGHT_KEYS.reduce((t, w) => t + weights[w], 0) || 1;
            const editable = k === "fit" || k === "time" || k === "feas";
            return (
              <div key={k} className="gr-dim">
                <div className="gr-dim-h"><span>{name} <i>· {Math.round((weights[k] / tot) * 100)}%</i></span>
                  {editable && canEdit ? (
                    <select className="gr-in sm" aria-label={`${name} score`} value={opp.scores[k]} onChange={e => save({ [k]: Number(e.target.value) } as Saved)}>
                      {[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}
                    </select>
                  ) : <span className="mono">{opp.scores[k]} / 5</span>}
                </div>
                <div className="gr-bar"><div style={{ width: `${(opp.scores[k] / 5) * 100}%` }} /></div>
                <div className="gr-note">{src}</div>
              </div>
            );
          })}
        </div>
      </div>
      {list ? <OppClinics opp={opp} scope={scope} onClose={() => setList(false)} /> : null}
    </div>
  );
}

/** Where the opportunity is: the list's incremental revenue by US state or country, with a breakdown of the one picked. */
function GeoMap({ items, rows, regionSel, setRegionSel, filterOn, setFilterOn }: { items: Row[]; rows: ClinicLite[]; regionSel: string; setRegionSel: (k: string) => void; filterOn: boolean; setFilterOn: (b: boolean) => void }) {
  const [geo, setGeo] = useState<"us" | "intl">("us");
  const per = useMemo(() => items.map(it => ({ it, m: regionSplit(it.opp, rows) })), [items, rows]);
  const vals = useMemo(() => {
    const v = new Map<string, number>();
    for (const { m } of per) for (const [k, n] of m) v.set(k, (v.get(k) ?? 0) + n);
    return v;
  }, [per]);
  const keys = geo === "us" ? Object.keys(TILES).map(c => `us:${c}`) : [...vals.keys()].filter(k => k.startsWith("intl:")).sort((a, b) => (vals.get(b) ?? 0) - (vals.get(a) ?? 0));
  const max = Math.max(1e-9, ...keys.map(k => vals.get(k) ?? 0));
  const ranked = [...keys].sort((a, b) => (vals.get(b) ?? 0) - (vals.get(a) ?? 0));
  const sel = regionSel && keys.includes(regionSel) ? regionSel : ranked[0];
  const nameOf = (k: string) => {
    const code = k.slice(k.indexOf(":") + 1);
    return k.startsWith("us:") ? geoKeyOf({ state: code, country: "US" }).label : geoKeyOf({ state: "", country: code }).label;
  };
  const total = [...vals].filter(([k]) => k.startsWith(`${geo}:`)).reduce((t, [, n]) => t + n, 0);
  const inSel = per.map(({ it, m }) => ({ it, v: m.get(sel ?? "") ?? 0 })).filter(x => x.v > 0.5).sort((a, b) => b.v - a.v);
  const tileStyle = (k: string, i: number): React.CSSProperties => {
    const v = vals.get(k) ?? 0;
    const t = v / max;
    const pos = geo === "us" ? { gridColumn: TILES[k.slice(3)][0] + 1, gridRow: TILES[k.slice(3)][1] + 1 } : { gridColumn: (i % 8) + 1 };
    return { ...pos, background: v < 0.5 ? "#f1f3f6" : `rgb(${Math.round(234 + (29 - 234) * t)},${Math.round(240 + (78 - 240) * t)},${Math.round(251 + (216 - 251) * t)})`, color: v < 0.5 ? "#64748b" : t > 0.5 ? "#fff" : "#0f172a" };
  };
  if (!keys.length) return <div className="gr-note">No clinics outside the US among these opportunities.</div>;
  return (
    <div className="gr-card" id="map">
      <div className="gr-between">
        <div>
          <div className="gr-h">Where the opportunity is</div>
          <div className="gr-note" style={{ maxWidth: 640 }}>Incremental revenue by {geo === "us" ? "state" : "country"}, summed from the opportunities listed below, each split across its clinics. The map follows the pillar, source and search filters. Click a {geo === "us" ? "state" : "country"} for its breakdown.</div>
        </div>
        <div className="gr-seg" role="group" aria-label="Map">
          <button type="button" className={geo === "us" ? "on" : ""} onClick={() => { setGeo("us"); setRegionSel(""); setFilterOn(false); }}>United States</button>
          <button type="button" className={geo === "intl" ? "on" : ""} onClick={() => { setGeo("intl"); setRegionSel(""); setFilterOn(false); }}>International</button>
        </div>
      </div>
      <div className="gr-map-grid">
        <div>
          <div className={geo === "us" ? "gr-tiles us" : "gr-tiles intl"}>
            {keys.map((k, i) => (
              <button type="button" key={k} className={`gr-tile${k === sel ? " sel" : ""}`} style={tileStyle(k, i)} onClick={() => setRegionSel(k)} aria-label={`${nameOf(k)}: ${money(vals.get(k) ?? 0)}`}>
                <span className="c">{k.slice(k.indexOf(":") + 1)}</span><span className="v">{(vals.get(k) ?? 0) < 0.5 ? "·" : money(vals.get(k) ?? 0)}</span>
              </button>
            ))}
          </div>
          <div className="gr-legend"><span>Lower</span><i /><span>Higher incremental revenue</span></div>
        </div>
        <div>
          <div className="gr-eye">{geo === "us" ? "State" : "Country"}</div>
          <div className="gr-between" style={{ alignItems: "baseline" }}>
            <div className="gr-big">{sel ? nameOf(sel) : "—"}</div>
            <div className="mono">{money(vals.get(sel ?? "") ?? 0)} <span className="gr-note">· {total ? Math.round(((vals.get(sel ?? "") ?? 0) / total) * 100) : 0}% of the listed opportunity · {inSel.length} opportunities</span></div>
          </div>
          <div className="gr-bars">
            {inSel.slice(0, 7).map(({ it, v }) => (
              <div key={it.opp.id}>
                <div className="gr-between"><span>{it.opp.name} <span className={`gr-tag ${it.opp.source === "supporting" ? "sup" : "sc"}`}>{it.opp.pillar}</span></span><span className="mono">{money(v)}</span></div>
                <div className="gr-bar"><div style={{ width: `${(v / (inSel[0]?.v || 1)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          {inSel.length > 7 ? <div className="gr-note">… and {inSel.length - 7} more opportunities here. Filter the table to see them all.</div> : null}
          <div className="gr-btns"><button type="button" className="gr-btn" onClick={() => { if (sel) setRegionSel(sel); setFilterOn(!filterOn); }}>{filterOn ? `Show all ${geo === "us" ? "states" : "countries"}` : `Filter the table to ${sel ? nameOf(sel) : ""}`}</button></div>
          <div className="gr-eye" style={{ marginTop: 16 }}>Top {geo === "us" ? "states" : "countries"}</div>
          {ranked.slice(0, 8).map(k => (
            <button type="button" key={k} className="gr-rk" onClick={() => setRegionSel(k)}>
              <span className="mono">{k.slice(k.indexOf(":") + 1)}</span><span className="gr-bar"><div style={{ width: `${((vals.get(k) ?? 0) / max) * 100}%` }} /></span><span className="mono r">{money(vals.get(k) ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Clinics where providers have gone quiet (the engine's growth:providers). Null until it answers, and if it cannot, the page simply goes without that row. */
function useProviders(): ProviderLite[] | null {
  const run = useRcaAction(api.growth.providers);
  const [rows, setRows] = useState<ProviderLite[] | null>(null);
  useEffect(() => {
    let live = true;
    run({ password: pw() }).then(r => live && setRows(r.rows as ProviderLite[])).catch(() => undefined);
    return () => { live = false; };
  }, [run]);
  return rows;
}

export function GrowthView({ periods, teamLead }: { periods: ExecPeriod[]; teamLead?: string }) {
  const scope = teamLead ? `team:${teamLead}` : COMPANY;
  const all = periods.find(p => p.id === "all");
  const windowDays = all?.days ?? 365;
  const book = useRcaQuery(api.repView.book, { password: pw(), periodId: "all", sales: scope });
  const rowsQ = useRcaQuery(api.repView.rowsByFocus, { password: pw(), periodId: "all", sales: scope, focus: "" });
  const lapsedQ = useRcaQuery(api.growth.lapsed, { password: pw() });
  const st = useQuery(api.growth.state, { password: pw() });
  const eligQ = useQuery(api.growth.eligibleAll, { password: pw() });
  const pgd = usePG(scope, "all");
  const prov = useProviders();
  const fzQ = useRcaQuery(api.fzScores.clinics, { password: pw(), periodId: "all", sales: scope });
  const saveOpp = useMutation(api.growth.saveOpp);
  const saveWeights = useMutation(api.growth.saveWeights);

  const rows = (rowsQ?.ready ? (rowsQ.rows as unknown as ClinicLite[]) : null);
  const canEdit = st?.canEdit === true;
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(st?.weights ?? {}) } as Weights;
  const lapsedRows: LapsedLite[] | null = lapsedQ?.ready ? (lapsedQ.rows as LapsedLite[]) : null;
  const clinicIds = useMemo(() => (rows ? new Set(rows.map(r => r.clinic)) : null), [rows]);

  // Cross-sell candidates and Product whitespace, from the same product-mix data and the same pgStats as the scorecard.
  const pgx = useMemo<{ whitespace: WhitespaceLite | null } | null>(() => {
    if (!book?.ready || !pgd.data) return null;
    const clinics = pgd.data.clinics;
    const A = annualFactor(windowDays);
    const present = new Set(clinics.map(c => c.clinic));
    const pairs = (eligQ ?? []).filter(e => present.has(e.clinic));
    const perFamily = new Map<string, number>();
    for (const f of new Set(pairs.map(p => p.family))) {
      const buyers = clinics.filter(c => (c.win[f] ?? 0) > 0);
      const rev = buyers.reduce((t, c) => t + (c.rev?.[f] ?? 0), 0);
      if (buyers.length) perFamily.set(f, (rev / buyers.length) * A);
    }
    const never = pairs.filter(p => !((clinics.find(c => c.clinic === p.clinic)?.life[p.family] ?? 0) > 0) && perFamily.has(p.family));
    const value = never.length ? never.reduce((t, p) => t + (perFamily.get(p.family) ?? 0), 0) / never.length : 0;
    return {
      whitespace: never.length ? { pairs: never.length, ids: [...new Set(never.map(p => p.clinic))], valuePerPair: value } : null,
    };
  }, [book, pgd.data, eligQ, windowDays]);

  // Foundation Zoomer results per clinic and Zoomer area, from the same query the scorecard uses.
  const fzLite = useMemo<FzLite | null>(() => (fzQ?.ready ? { clinics: fzQ.clinics.map(c => ({ clinic: c.clinic, products: c.products.map(p => ({ area: p.area, open: p.open, low: p.low, high: p.high, likely: p.likely })) })) } : null), [fzQ]);

  const opps = useMemo<Opp[]>(() => {
    if (!book?.ready || !rows) return [];
    const lapsed = lapsedRows && clinicIds ? lapsedRows.filter(l => clinicIds.has(l.clinic) || scope === COMPANY) : lapsedRows;
    const providers = prov && clinicIds ? prov.filter(p => clinicIds.has(p.clinic)) : null;
    return discover({ windowDays, book: book as never, rows, lapsed, fz: fzLite, whitespace: pgx?.whitespace ?? null, providers }).map(d => resolve(d, (st?.opps?.[d.id] ?? {}) as Saved));
  }, [book, rows, lapsedRows, clinicIds, scope, windowDays, st?.opps, pgx, prov, fzLite]);

  const [pillar, setPillar] = useState<"All" | Pillar>("All");
  const [source, setSource] = useState<"all" | "scorecard" | "supporting">("all");
  const [q, setQ] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState("");
  const [regionSel, setRegionSel] = useState("");
  const [regionFilter, setRegionFilter] = useState(false);

  const scored = useMemo<Row[]>(() => opps.map(opp => { const score = priority(opp, weights); return { opp, score, rec: opp.status === "Rejected" ? ("Rejected" as const) : recommendation(score) }; })
    .sort((a, b) => Number(a.opp.status === "Rejected") - Number(b.opp.status === "Rejected") || b.score - a.score), [opps, weights]);
  // Rejected opportunities stay in the table, but are left out of the totals, the pipeline, the map and the balance.
  const live = useMemo(() => scored.filter(r => r.opp.status !== "Rejected"), [scored]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scored.filter(r =>
      (pillar === "All" || r.opp.pillar === pillar) &&
      (source === "all" || r.opp.source === source) &&
      (!needle || [r.opp.name, r.opp.pillar, r.opp.indicator, r.opp.segment, r.opp.owner].join(" ").toLowerCase().includes(needle)));
  }, [scored, pillar, source, q]);
  const regionOpp = (r: Row) => (rows && regionSel ? regionSplit(r.opp, rows).get(regionSel) ?? 0 : 0);
  const shownAll = regionFilter && regionSel ? filtered.filter(r => regionOpp(r) > 0.5) : filtered;
  const shown = grouped ? shownAll : shownAll.slice(0, limit);

  const total = live.reduce((t, r) => t + r.opp.incr, 0);
  const adjusted = overlapAdjusted(live.map(r => r.opp));
  const recs = scored.filter(r => r.rec === "Prioritize");
  const sup = live.filter(r => r.opp.source === "supporting");
  const supMoney = sup.reduce((t, r) => t + r.opp.incr, 0);
  const stageDefs: Array<[string, string, Status[]]> = [
    ["Hypothesis", "Spotted in the data, not yet sized", ["Hypothesis"]],
    ["Quantified", "Population, value and rate estimated", ["Quantified"]],
    ["Validated", "Backed by history, a pilot or a cohort", ["Validated"]],
    ["Investment decision", "Leadership decides: fund, test further or reject. Funded ones are executed and scaled.", ["Investment decision", "Approved", "Executing", "Scaling"]],
  ];
  const invTotal = live.reduce((t, r) => t + (r.opp.investment ?? 0), 0);
  const bucketRows = [["Core growth", 60, "High-confidence opportunities"], ["Growth experiment", 30, "Promising but unvalidated"], ["Strategic bet", 10, "Longer-term, higher-risk"]] as const;
  const loading = !book || !rowsQ;
  const save = (id: string) => (patch: Saved) => { void saveOpp({ password: pw(), id, patch }); };
  const setWeight = (k: (typeof WEIGHT_KEYS)[number], d: number) => { void saveWeights({ password: pw(), weights: { ...weights, [k]: Math.max(0, Math.min(100, weights[k] + d)) } }); };
  const wSum = WEIGHT_KEYS.reduce((t, k) => t + weights[k], 0);

  const renderRow = (r: Row) => {
    const o = r.opp;
    const isOpen = open === o.id;
    const inRegion = regionFilter && regionSel && rows ? regionSplit(o, rows).get(regionSel) ?? 0 : null;
    return (
      <div key={o.id} className="gr-rowwrap">
        <button type="button" className={`gr-row${isOpen ? " open" : ""}${o.status === "Rejected" ? " rej" : ""}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : o.id)}>
          <div><b>{o.name}</b><div className="gr-tags"><span className="gr-tag">{o.pillar}</span><span className={`gr-tag ${o.ready === "ready" ? "ready" : o.ready === "partial" ? "sup" : ""}`}>{o.ready === "ready" ? "Data ready" : o.ready === "partial" ? "Partial data" : "Needs data"}</span><small>{o.segment}</small></div></div>
          <div><b className="gr-ind">{o.indicator}</b><div className="mono">{o.indicatorValue}</div><span className={`gr-tag ${o.source === "supporting" ? "sup" : "sc"}`}>{o.source === "supporting" ? "Supporting KPI" : "Scorecard indicator"}</span></div>
          <div><div>{o.metric}</div><div className="mono">{o.cur}% → {o.tgtEff}%</div></div>
          <div className="r"><div className="mono b">{money(inRegion !== null ? inRegion : o.incr)}</div><small>{inRegion !== null ? `in ${regionSel.slice(regionSel.indexOf(":") + 1)}, of ${money(o.incr)}` : ""}</small></div>
          <div className="r mono">{o.investment ? money(o.investment) : "—"}</div>
          <div className="r mono">{o.ret !== null ? `${o.ret.toFixed(1)}x` : "—"}</div>
          <div>{o.status}<div><span className={`gr-pill ${r.rec === "Prioritize" ? "go" : r.rec === "Validate" ? "mid" : "low"}`}>{r.rec}</span></div></div>
          <div className="r mono big">{r.score.toFixed(1)}</div>
        </button>
        {isOpen ? <Worksheet opp={o} canEdit={canEdit} save={save(o.id)} scope={scope} weights={weights} score={r.score} /> : null}
      </div>
    );
  };

  const body = (() => {
    if (!grouped) return shown.map(renderRow);
    return PILLARS.flatMap(p => {
      const inP = shown.filter(r => r.opp.pillar === p);
      if (!inP.length) return [];
      return [
        <div key={`h-${p}`} className="gr-grouphead"><b>{p} <span className="mono">{inP.length} opportunities</span></b><span className="mono">{money(inP.reduce((t, r) => t + r.opp.incr, 0))} potential</span></div>,
        ...inP.map(renderRow),
      ];
    });
  })();

  return (
    <div className="ev gr" data-tour="growth-page">
      <div className="gr-between" style={{ marginTop: 16 }}>
        <div>
          <div className="gr-eye">Growth · Decision Intelligence &amp; RevOps</div>
          <h1 className="gr-title">Growth opportunities</h1>
          <div className="gr-sub">Of all the ways we could grow revenue, where should we invest our next dollar, and why? Opportunities are grouped by the scorecard's growth pillars. Some are sized from a scorecard opportunity indicator; others come from data the scorecard does not carry and sit under a pillar as a supporting KPI. Every figure is incremental revenue a year, not the total revenue of the group. {teamLead ? `Showing ${teamLead}'s team.` : ""}</div>
        </div>
        <a className="gr-btn ghost" href="#weights" onClick={e => { e.preventDefault(); document.getElementById("weights")?.scrollIntoView({ behavior: "smooth" }); }}>Scoring weights</a>
      </div>

      {loading ? <div className="gr-note" style={{ marginTop: 24 }}>Loading the opportunities…</div> : !opps.length ? <div className="gr-note" style={{ marginTop: 24 }}>No opportunities could be sized from the current data.</div> : (
        <>
          <div className="gr-tiles4">
            <div className="gr-card"><div className="gr-eye">Identified opportunities</div><div className="gr-n">{live.length}</div><div className="gr-note">{live.length - sup.length} on a scorecard indicator · {sup.length} on a supporting KPI</div></div>
            <div className="gr-card"><div className="gr-eye">Qualified</div><div className="gr-n">{live.filter(r => r.opp.status !== "Hypothesis").length}</div><div className="gr-note">quantified or beyond</div></div>
            <div className="gr-card"><div className="gr-eye">Potential incremental revenue</div><div className="gr-n">{money(total)}</div><div className="gr-note">{money(adjusted)} with each clinic counted once, where opportunities overlap</div></div>
            <div className="gr-card amber"><div className="gr-eye">From supporting KPIs</div><div className="gr-n">{money(supMoney)}</div><div className="gr-note">{total ? Math.round((supMoney / total) * 100) : 0}% of the potential, from data the scorecard does not carry</div></div>
            <div className="gr-card green"><div className="gr-eye">Recommended to prioritize</div><div className="gr-n">{recs.length}</div><div className="gr-note">priority {THRESHOLD.toFixed(1)} or higher · {money(recs.reduce((t, r) => t + r.opp.incr, 0))} potential</div></div>
          </div>

          {book?.ready ? (
            <div className="gr-card tint">
              <div className="gr-eye">Combined · Revenue opportunity (scorecard)</div>
              <div className="gr-sub" style={{ margin: "4px 0 0" }}><b className="mono">{money((book.kpi as { opportunity?: number }).opportunity ?? 0)}</b> in the analysis window = At-risk customers {money((book.kpi as { atRiskRev?: number }).atRiskRev ?? 0)} + AOV gap {money((book.kpi as { aovOpp?: number }).aovOpp ?? 0)}. The rows below size opportunity a year and cover more than the scorecard does.</div>
            </div>
          ) : null}

          <div className="gr-card">
            <div className="gr-between"><div className="gr-h">Opportunity pipeline</div><div className="gr-note">Evidence matures left to right. Dollars are incremental revenue per year.</div></div>
            <div className="gr-stages">
              {stageDefs.map(([name, note, sts]) => {
                const rs = live.filter(r => sts.includes(r.opp.status));
                const mny = rs.reduce((t, r) => t + r.opp.incr, 0);
                return (
                  <div key={name} className="gr-stage">
                    <div className="gr-between"><b>{name}</b><span className="mono n">{rs.length}</span></div>
                    <div className="gr-note">{note}</div>
                    <div className="gr-bar"><div style={{ width: `${total ? (mny / total) * 100 : 0}%` }} /></div>
                    <div className="mono">{money(mny)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {rows ? <GeoMap items={filtered.filter(r => r.opp.status !== "Rejected")} rows={rows} regionSel={regionSel} setRegionSel={setRegionSel} filterOn={regionFilter} setFilterOn={b => { setRegionFilter(b); setLimit(PAGE); }} /> : null}

          <div>
            <div className="gr-filters">
              <div className="gr-chips" role="group" aria-label="Growth pillar">
                {(["All", ...PILLARS] as const).map(p => (
                  <button type="button" key={p} className={`gr-chip${pillar === p ? " on" : ""}`} onClick={() => { setPillar(p); setLimit(PAGE); }}>{p} <span className="mono">{p === "All" ? scored.length : scored.filter(r => r.opp.pillar === p).length}</span></button>
                ))}
              </div>
              <div className="gr-chips" role="group" aria-label="Source of the opportunity">
                <span className="gr-note">Source</span>
                {([["all", "All sources"], ["scorecard", "Scorecard indicator"], ["supporting", "Supporting KPI"]] as const).map(([k, n]) => (
                  <button type="button" key={k} className={`gr-chip${source === k ? " on" : ""}`} onClick={() => { setSource(k); setLimit(PAGE); }}>{n} <span className="mono">{k === "all" ? scored.length : scored.filter(r => r.opp.source === k).length}</span></button>
                ))}
              </div>
              <div className="gr-chips">
                <input className="gr-in search" type="search" value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search opportunities, indicators, owners" aria-label="Search opportunities" />
                <div className="gr-seg" role="group" aria-label="Layout">
                  <button type="button" className={!grouped ? "on" : ""} onClick={() => setGrouped(false)}>Ranked list</button>
                  <button type="button" className={grouped ? "on" : ""} onClick={() => setGrouped(true)}>By pillar</button>
                </div>
                <span className="gr-note">Sorted by priority score · click a row for the worksheet</span>
              </div>
            </div>
            <div className="gr-card flush gr-scroll">
              <div className="gr-table">
                <div className="gr-head"><div>Opportunity · pillar</div><div>Opportunity indicator</div><div>Outcome metric</div><div className="r">Incremental</div><div className="r">Investment</div><div className="r">Return</div><div>Status</div><div className="r">Priority</div></div>
                {body.length ? body : <div className="gr-note" style={{ padding: 18 }}>No opportunities match these filters.</div>}
              </div>
            </div>
            <div className="gr-between" style={{ marginTop: 10 }}>
              <div className="gr-note">{grouped ? `Showing all ${shownAll.length} opportunities, grouped by pillar` : `Showing ${shown.length} of ${shownAll.length} opportunities`}{regionFilter && regionSel ? ` with revenue in ${regionSel.slice(regionSel.indexOf(":") + 1)}` : ""}. The list is built to keep growing: search, group by pillar, filter by source, and page through it.</div>
              {!grouped && shownAll.length > shown.length ? (
                <div className="gr-btns" style={{ margin: 0 }}>
                  <button type="button" className="gr-btn ghost" onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, shownAll.length - shown.length)} more</button>
                  <button type="button" className="gr-btn ghost" onClick={() => setLimit(10_000)}>Show all {shownAll.length}</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="gr-two">
            <div className="gr-card">
              <div className="gr-h">Portfolio balance</div>
              <div className="gr-note" style={{ marginBottom: 10 }}>Share of planned investment by bucket, against the 60 / 30 / 10 starting point. It fills in as investments are entered.</div>
              {bucketRows.map(([name, target, note]) => {
                const inv = live.filter(r => r.opp.bucket === name).reduce((t, r) => t + (r.opp.investment ?? 0), 0);
                const share = invTotal ? Math.round((inv / invTotal) * 100) : 0;
                return (
                  <div key={name} style={{ marginBottom: 12 }}>
                    <div className="gr-between"><b>{name}</b><span className="mono">{invTotal ? `${share}%` : "—"} <span className="gr-note">of {target}% target</span></span></div>
                    <div className="gr-bar"><div style={{ width: `${share}%` }} /></div>
                    <div className="gr-note">{note} · {money(inv)} planned</div>
                  </div>
                );
              })}
            </div>
            <div className="gr-card" id="weights">
              <div className="gr-between">
                <div><div className="gr-h">Scoring weights</div><div className="gr-note" style={{ marginBottom: 10 }}>Change a weight and every priority score, the order and the recommendations update. {canEdit ? "You can edit these." : "Read-only: only growth admins can change them."}</div></div>
                {canEdit ? <button type="button" className="gr-btn ghost" onClick={() => { void saveWeights({ password: pw(), weights: DEFAULT_WEIGHTS }); }}>Reset to 30 / 25 / 15 / 15 / 15</button> : null}
              </div>
              {DIMENSIONS.map(([k, name, src]) => (
                <div key={k} className="gr-w">
                  <div><b>{name}</b><div className="gr-note">{src}</div></div>
                  <div><div className="gr-bar"><div style={{ width: `${Math.min(100, weights[k] / 50 * 100)}%` }} /></div><div className="gr-note">counts as {wSum ? Math.round((weights[k] / wSum) * 100) : 0}% of the score</div></div>
                  <div className="gr-step">
                    <button type="button" disabled={!canEdit} aria-label={`Lower ${name} weight`} onClick={() => setWeight(k, -5)}>−</button>
                    <span className="mono">{weights[k]}%</span>
                    <button type="button" disabled={!canEdit} aria-label={`Raise ${name} weight`} onClick={() => setWeight(k, 5)}>+</button>
                  </div>
                </div>
              ))}
              <div className="gr-between gr-sumrow"><span>Weights add up to <b className="mono">{wSum}%</b></span><span className="gr-note">{wSum === 100 ? "Ready: weights add up to 100%." : "Scores use each weight as a share of the total, so they still work."}</span></div>
              <div className="gr-note" style={{ marginTop: 8 }}>A weighted score never overrides the money. The Return column puts incremental revenue next to the investment, so a $2M idea needing $1.8M reads worse than a $500K idea needing $50K, whatever its score.</div>
            </div>
          </div>
        </>
      )}
          </div>
  );
}
