import { geoAlbersUsa, geoNaturalEarth1, geoPath } from "d3-geo";
import { useMemo, useState } from "react";
import { feature } from "topojson-client";
import usTopo from "us-atlas/states-10m.json";
import worldTopo from "world-atlas/countries-110m.json";

/**
 * Geography of the shortfall: a US state choropleth plus a world map for the
 * international book. Colour encodes the revenue delta vs the run-rate
 * baseline (red = behind, green = ahead); clicking a shape selects it and the
 * clinic list below re-scopes to that geography.
 */

export type GeoRow = {
  key: string;
  code: string;
  kind: "state" | "country";
  label: string;
  actual: number;
  expected: number;
  delta: number;
  orders: number;
  expectedOrders: number;
  clinics: number;
  ytdRevenue: number;
  projectedClose: number;
  target: number;
  neededRemaining: number;
  rsms: Array<{
    name: string;
    delta: number;
    clinics: number;
    actual: number;
    ytdRevenue: number;
    projectedClose: number;
    target: number;
    neededRemaining: number;
  }>;
};

type Feat = {
  type: string;
  id?: string | number;
  properties: { name?: string };
  geometry: unknown;
};

// biome-ignore lint/suspicious/noExplicitAny: topojson types are structural
const usFeatures = (feature(usTopo as any, (usTopo as any).objects.states) as any)
  .features as Feat[];
// biome-ignore lint/suspicious/noExplicitAny: topojson types are structural
const worldFeatures = (
  feature(worldTopo as any, (worldTopo as any).objects.countries) as any
).features as Feat[];

const MONEY = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** Diverging scale anchored on the biggest absolute delta on the map. */
function fill(delta: number, max: number): string {
  if (!max) return "var(--vw-gray-10)";
  const t = Math.min(1, Math.abs(delta) / max);
  const a = 0.12 + t * 0.72;
  return delta < 0
    ? `rgba(200, 42, 42, ${a})`
    : `rgba(23, 128, 96, ${a})`;
}

export function GeoMap({
  rows,
  selected,
  onSelect,
}: {
  rows: GeoRow[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [view, setView] = useState<"us" | "world">("us");
  const [hover, setHover] = useState<GeoRow | null>(null);

  // The two views are scaled independently: the US book dwarfs the
  // international one, and a shared scale would render every country flat.
  const viewRows = useMemo(() => {
    if (view === "us") return rows.filter(r => r.kind === "state");
    const intlRows = rows.filter(r => r.kind === "country");
    const us = rows.filter(r => r.kind === "state");
    if (us.length === 0) return intlRows;
    const usTotal: GeoRow = {
      key: "us:all",
      code: "US",
      kind: "country",
      label: "United States",
      actual: us.reduce((s, r) => s + r.actual, 0),
      expected: us.reduce((s, r) => s + r.expected, 0),
      delta: us.reduce((s, r) => s + r.delta, 0),
      orders: us.reduce((s, r) => s + r.orders, 0),
      expectedOrders: us.reduce((s, r) => s + r.expectedOrders, 0),
      clinics: us.reduce((s, r) => s + r.clinics, 0),
      ytdRevenue: us.reduce((s, r) => s + r.ytdRevenue, 0),
      projectedClose: us.reduce((s, r) => s + r.projectedClose, 0),
      target: us.reduce((s, r) => s + r.target, 0),
      neededRemaining: us.reduce((s, r) => s + r.neededRemaining, 0),
      rsms: [],
    };
    return [...intlRows, usTotal];
  }, [rows, view]);

  const byLabel = useMemo(() => {
    const m = new Map<string, GeoRow>();
    for (const r of viewRows) m.set(r.label.toLowerCase(), r);
    return m;
  }, [viewRows]);
  const max = useMemo(
    () =>
      Math.max(
        0,
        ...viewRows
          .filter(r => r.key !== "us:all")
          .map(r => Math.abs(r.delta)),
      ),
    [viewRows],
  );

  const usPath = useMemo(
    () => geoPath(geoAlbersUsa().fitSize([860, 500], { type: "FeatureCollection", features: usFeatures } as never)),
    [],
  );
  const worldPath = useMemo(
    () =>
      geoPath(
        geoNaturalEarth1().fitSize([860, 460], {
          type: "FeatureCollection",
          features: worldFeatures,
        } as never),
      ),
    [],
  );

  const feats = view === "us" ? usFeatures : worldFeatures;
  const path = view === "us" ? usPath : worldPath;
  const intl = useMemo(() => rows.filter(r => r.kind === "country"), [rows]);
  const unplotted = useMemo(
    () =>
      intl.filter(
        r =>
          !worldFeatures.some(
            f => (f.properties.name ?? "").toLowerCase() === r.label.toLowerCase(),
          ),
      ),
    [intl],
  );

  return (
    <section className="rca-card rca-geo-card">
      <div className="rca-strip-head">
        <div>
          <div className="rca-eyebrow">Geography of the gap</div>
          <div className="rca-sub">
            Colour is revenue vs the run-rate baseline. Click a{" "}
            {view === "us" ? "state" : "country"} to scope the RSM table and the
            clinic list below.
          </div>
        </div>
        <div className="rca-tabs">
          {(["us", "world"] as const).map(v => (
            <button
              key={v}
              type="button"
              className={`rca-tab${view === v ? " is-active" : ""}`}
              onClick={() => setView(v)}
            >
              {v === "us" ? "United States" : "International"}
            </button>
          ))}
          {selected ? (
            <button
              type="button"
              className="rca-tab"
              onClick={() => onSelect(null)}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="rca-geo-map">
        <svg
          viewBox={view === "us" ? "0 0 860 500" : "0 0 860 460"}
          role="img"
          aria-label={
            view === "us" ? "US states shortfall map" : "World shortfall map"
          }
        >
          <title>
            {view === "us" ? "US states shortfall" : "International shortfall"}
          </title>
          {feats.map(f => {
            const name = (f.properties.name ?? "").toLowerCase();
            const row = byLabel.get(name);
            const isSel = row ? row.key === selected : false;
            return (
              <path
                key={String(f.id ?? name)}
                d={path(f as never) ?? ""}
                className={`rca-geo-shape${isSel ? " is-selected" : ""}${row ? " is-live" : ""}`}
                fill={row ? fill(row.delta, max) : "var(--vw-gray-08, #f0f0f0)"}
                onMouseEnter={() => setHover(row ?? null)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!row) return;
                  // The US shape on the world map is a rollup: drop into the
                  // state view instead of selecting a non-existent geography.
                  if (row.key === "us:all") {
                    setView("us");
                    return;
                  }
                  onSelect(row.key === selected ? null : row.key);
                }}
              />
            );
          })}
        </svg>
        <div className="rca-geo-legend">
          <span className="rca-geo-swatch" style={{ background: fill(-max, max) }} />
          <span className="rca-mono rca-dim">behind</span>
          <span className="rca-geo-swatch" style={{ background: "var(--vw-gray-10)" }} />
          <span className="rca-mono rca-dim">flat</span>
          <span className="rca-geo-swatch" style={{ background: fill(max, max) }} />
          <span className="rca-mono rca-dim">ahead</span>
        </div>
        {hover ? (
          <div className="rca-geo-tip">
            <strong>{hover.label}</strong>
            <span className="rca-mono">{MONEY(hover.delta)}</span>
            <span className="rca-dim2">
              {hover.orders.toLocaleString("en-US")} orders ·{" "}
              {hover.clinics.toLocaleString("en-US")} clinics
            </span>
            <span className="rca-dim2">
              Run-rate close {MONEY(hover.projectedClose)} · needed{" "}
              {MONEY(hover.neededRemaining)} of {MONEY(hover.target)}
            </span>
          </div>
        ) : null}
      </div>

      {view === "world" && unplotted.length > 0 ? (
        <div className="rca-lens-note">
          Not drawn on the map (small territories):{" "}
          {unplotted.map(r => `${r.label} ${MONEY(r.delta)}`).join(" · ")}
        </div>
      ) : null}
    </section>
  );
}

/** Regional sales managers owning the clinics in the selected geography. */
export function GeoRsmTable({
  rows,
  selected,
  onPickGeo,
}: {
  rows: GeoRow[];
  selected: string | null;
  onPickGeo: (key: string) => void;
}) {
  const scope = selected ? rows.filter(r => r.key === selected) : rows;
  const byRsm = useMemo(() => {
    const m = new Map<
      string,
      {
        delta: number;
        clinics: number;
        geos: Set<string>;
        projectedClose: number;
        neededRemaining: number;
        target: number;
      }
    >();
    for (const g of scope) {
      for (const r of g.rsms) {
        const cur = m.get(r.name) ?? {
          delta: 0,
          clinics: 0,
          geos: new Set<string>(),
          projectedClose: 0,
          neededRemaining: 0,
          target: 0,
        };
        cur.delta += r.delta;
        cur.clinics += r.clinics;
        cur.geos.add(g.label);
        cur.projectedClose += r.projectedClose;
        cur.neededRemaining += r.neededRemaining;
        cur.target += r.target;
        m.set(r.name, cur);
      }
    }
    return [...m]
      .map(([name, x]) => ({ name, ...x, geos: [...x.geos] }))
      .sort((a, b) => a.delta - b.delta);
  }, [scope]);

  const geoRows = useMemo(
    () => [...rows].sort((a, b) => a.delta - b.delta).slice(0, 15),
    [rows],
  );

  return (
    <div className="rca-geo-tables">
      <div className="rca-table-wrap">
        <div className="rca-eyebrow">
          {selected ? "Geographies" : "Biggest gaps by geography"}
        </div>
        <table className="rca-table">
          <thead>
            <tr>
              <th>Geography</th>
              <th className="rca-num">Actual</th>
              <th className="rca-num">Expected</th>
              <th className="rca-num">Δ</th>
              <th className="rca-num">Clinics</th>
              <th className="rca-num">Run-rate close</th>
              <th className="rca-num">Needed rest of year</th>
            </tr>
          </thead>
          <tbody>
            {geoRows.map(r => (
              <tr
                key={r.key}
                className={r.key === selected ? "is-selected" : ""}
                onClick={() => onPickGeo(r.key)}
              >
                <td>
                  {r.label}{" "}
                  <span className="rca-dim2">
                    {r.kind === "country" ? "intl" : ""}
                  </span>
                </td>
                <td className="rca-num">{MONEY(r.actual)}</td>
                <td className="rca-num">{MONEY(r.expected)}</td>
                <td className={`rca-num ${r.delta < 0 ? "rca-neg" : "rca-pos"}`}>
                  {MONEY(r.delta)}
                </td>
                <td className="rca-num">{r.clinics.toLocaleString("en-US")}</td>
                <td className="rca-num">{MONEY(r.projectedClose)}</td>
                <td className="rca-num">
                  {MONEY(r.neededRemaining)}
                  <span className="rca-dim2"> / {MONEY(r.target)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rca-table-wrap">
        <div className="rca-eyebrow">
          RSM contribution{selected ? " — selected geography" : ""}
        </div>
        <table className="rca-table">
          <thead>
            <tr>
              <th>Regional sales manager</th>
              <th>Territory</th>
              <th className="rca-num">Clinics</th>
              <th className="rca-num">Δ</th>
              <th className="rca-num">Run-rate close</th>
              <th className="rca-num">Needed rest of year</th>
            </tr>
          </thead>
          <tbody>
            {byRsm.slice(0, 25).map(r => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="rca-dim2">
                  {r.geos.slice(0, 4).join(", ")}
                  {r.geos.length > 4 ? ` +${r.geos.length - 4}` : ""}
                </td>
                <td className="rca-num">{r.clinics.toLocaleString("en-US")}</td>
                <td className={`rca-num ${r.delta < 0 ? "rca-neg" : "rca-pos"}`}>
                  {MONEY(r.delta)}
                </td>
                <td className="rca-num">{MONEY(r.projectedClose)}</td>
                <td className="rca-num">
                  {MONEY(r.neededRemaining)}
                  <span className="rca-dim2"> / {MONEY(r.target)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rca-lens-note">
        Run-rate close = this geography's/rep's own year-to-date revenue plus
        its share of the trailing-13-week company run rate applied to the
        rest of the year. Needed rest of year = its pro-rata slice of the
        annual target minus what it has already booked.
      </div>
    </div>
  );
}
