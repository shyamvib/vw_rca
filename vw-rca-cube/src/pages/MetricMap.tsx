import { geoAlbersUsa, geoPath } from "d3-geo";
import { useMemo, useState } from "react";
import { feature } from "topojson-client";
import usTopo from "us-atlas/states-10m.json";
import { geoKeyOf } from "../../analytics/geoKey";

/**
 * Map + RSM breakdown behind a scorecard metric (2026-10-21). Takes the same per-clinic values the clinic list is built from,
 * so the map, the RSM table and the list always add up to each other. Both the states and the RSM rows filter the list.
 */
export type MetricPoint = { clinic: string; state: string; country?: string; sales?: string; c: number; amount: number };
type Feat = { type: string; id?: string | number; properties: { name?: string }; geometry: unknown };

// biome-ignore lint/suspicious/noExplicitAny: topojson types are structural
const usFeatures = (feature(usTopo as any, (usTopo as any).objects.states) as any).features as Feat[];
const usPath = geoPath(geoAlbersUsa().fitSize([860, 500], { type: "FeatureCollection", features: usFeatures } as never));

const fmt = (n: number, money: boolean) => {
  const a = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  if (!money) return `${sign}${a.toLocaleString("en-US")}`;
  return `${sign}$${a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : Math.round(a)}`;
};
const shade = (v: number, max: number) => {
  if (!max || !v) return "var(--vw-gray-10)";
  const a = 0.15 + Math.min(1, Math.abs(v) / max) * 0.7;
  return v < 0 ? `rgba(200, 42, 42, ${a})` : `rgba(23, 128, 96, ${a})`;
};

export function MetricMap({ points, money, rsm, state, onRsm, onState }: {
  points: MetricPoint[];
  /** true: values are dollars; false: they are a net clinic count (still ordering minus lost, etc.). */
  money: boolean;
  rsm: string | null;
  state: string | null;
  onRsm: (r: string | null) => void;
  onState: (s: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  // The map reacts to the RSM pick (that rep's footprint) and the RSM table reacts to the state pick, so each shows the other's cut.
  const byState = useMemo(() => {
    const m = new Map<string, { v: number; n: number; up: number; down: number }>();
    for (const p of points) {
      if (rsm && p.sales !== rsm) continue;
      const g = geoKeyOf({ state: p.state, country: p.country ?? "" });
      if (g.kind !== "state") continue;
      const e = m.get(g.label.toLowerCase()) ?? { v: 0, n: 0, up: 0, down: 0 };
      e.v += p.amount; e.n += 1; if (p.c > 0) e.up += 1; else if (p.c < 0) e.down += 1;
      m.set(g.label.toLowerCase(), e);
    }
    return m;
  }, [points, rsm]);
  const max = Math.max(0, ...[...byState.values()].map(e => Math.abs(e.v)));
  const reps = useMemo(() => {
    const m = new Map<string, { v: number; n: number; up: number; down: number }>();
    for (const p of points) {
      if (state) {
        const g = geoKeyOf({ state: p.state, country: p.country ?? "" });
        if (g.label !== state) continue;
      }
      const k = p.sales ?? "—";
      const e = m.get(k) ?? { v: 0, n: 0, up: 0, down: 0 };
      e.v += p.amount; e.n += 1; if (p.c > 0) e.up += 1; else if (p.c < 0) e.down += 1;
      m.set(k, e);
    }
    return [...m].map(([name, e]) => ({ name, ...e })).sort((a, b) => a.v - b.v);
  }, [points, state]);
  const total = reps.reduce((t, r) => t + r.v, 0);
  const abroad = points.filter(p => (!rsm || p.sales === rsm) && geoKeyOf({ state: p.state, country: p.country ?? "" }).kind !== "state").length;
  const hv = hover ? byState.get(hover.toLowerCase()) : null;

  return (
    <div className="rv-mm">
      <div className="rv-mm-map">
        <svg viewBox="0 0 860 500" role="img" aria-label="Metric by state">
          <title>Metric by state</title>
          {usFeatures.map(f => {
            const name = f.properties.name ?? "";
            const e = byState.get(name.toLowerCase());
            return (
              <path
                key={String(f.id ?? name)}
                d={usPath(f as never) ?? ""}
                className={`rca-geo-shape${e ? " is-live" : ""}${state === name ? " is-selected" : ""}`}
                fill={e ? shade(e.v, max) : "var(--vw-gray-08, #f0f0f0)"}
                onMouseEnter={() => setHover(name)}
                onMouseLeave={() => setHover(null)}
                onClick={() => e && onState(state === name ? null : name)}
              />
            );
          })}
        </svg>
        <div className="rv-mm-legend"><i style={{ background: shade(-1, 1) }} /> worse <i style={{ background: "var(--vw-gray-10)" }} /> flat <i style={{ background: shade(1, 1) }} /> better</div>
        {hover && hv ? <div className="rv-mm-tip"><b>{hover}</b> {fmt(hv.v, money)} · {hv.n} clinics ({hv.up} up, {hv.down} down)</div> : null}
        {abroad ? <div className="rv-mm-note">{abroad} clinics outside the US are in the list but not drawn.</div> : null}
      </div>
      <div className="rv-mm-rsm">
        <div className="rv-mm-head">
          <span>By RSM{state ? ` · ${state}` : ""}</span>
          {rsm || state ? <button type="button" onClick={() => { onRsm(null); onState(null); }}>Clear filters</button> : null}
        </div>
        {points.length > 0 && points.every(p => !p.sales) ? <div className="rv-mm-note">RSM names are not in this data yet: the analytics service needs the latest update.</div> : null}
        <table>
          <thead><tr><th>RSM</th><th>Clinics</th><th>Up</th><th>Down</th><th>{money ? "Impact" : "Net clinics"}</th></tr></thead>
          <tbody>
            {reps.map(r => (
              <tr key={r.name} className={rsm === r.name ? "on" : ""} onClick={() => onRsm(rsm === r.name ? null : r.name)}>
                <td>{r.name}</td><td>{r.n}</td><td>{r.up}</td><td>{r.down}</td>
                <td className={r.v < 0 ? "neg" : r.v > 0 ? "pos" : ""}>{fmt(r.v, money)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total</td><td>{reps.reduce((t, r) => t + r.n, 0)}</td><td>{reps.reduce((t, r) => t + r.up, 0)}</td><td>{reps.reduce((t, r) => t + r.down, 0)}</td><td>{fmt(total, money)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
