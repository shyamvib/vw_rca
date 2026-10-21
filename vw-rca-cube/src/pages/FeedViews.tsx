import { useState } from "react";
import { RaiseQuestion, type AskCard } from "./RaiseQuestion";

/**
 * Shared pieces of the two Business Feed views (company feed in RcaDashboardPage, rep feed in RepView): the Cards / Table
 * toggle and the table view (one row per signal, Fact / Inference / Evidence / Action as coloured column headers).
 */
export type FeedView = "cards" | "table";
const KEY = "bf-view";

export function useFeedView(): [FeedView, (v: FeedView) => void] {
  const [view, setView] = useState<FeedView>(() => {
    try {
      return localStorage.getItem(KEY) === "table" ? "table" : "cards";
    } catch {
      return "cards";
    }
  });
  const set = (v: FeedView) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  return [view, set];
}

export function ViewToggle({ view, onChange }: { view: FeedView; onChange: (v: FeedView) => void }) {
  return (
    <div className="fv-toggle" role="group" aria-label="Feed layout">
      <button type="button" className={view === "cards" ? "on" : ""} aria-pressed={view === "cards"} onClick={() => onChange("cards")}>Cards</button>
      <button type="button" className={view === "table" ? "on" : ""} aria-pressed={view === "table"} onClick={() => onChange("table")}>Table</button>
    </div>
  );
}

export type FeedRow = {
  id: string;
  tone: string;
  topicLine: string;
  question: string;
  headline?: { value: string; caption: string } | null;
  fact: string;
  inference: string;
  evidence: string[];
  action: string;
  /** last column: status for the company feed, confidence for the rep feed */
  last: string;
  onOpen?: () => void;
  openLabel?: string;
  ask?: AskCard;
};

export function FeedTable({ rows, lastLabel, askContext, sales }: { rows: FeedRow[]; lastLabel: string; askContext?: string; sales?: string }) {
  return (
    <div className="fv-wrap">
      <div className="fv-table" role="table">
        <div className="fv-row fv-hdr" role="row">
          <div className="h-sig" role="columnheader">Signal</div>
          <div className="h-fact" role="columnheader">Fact</div>
          <div className="h-inf" role="columnheader">Inference</div>
          <div className="h-evi" role="columnheader">Evidence</div>
          <div className="h-act" role="columnheader">Action</div>
          <div className="h-st" role="columnheader">{lastLabel}</div>
        </div>
        {rows.map(r => (
          <div className="fv-row" role="row" key={r.id}>
            <div className="fv-sig" role="cell">
              <span className={`dot tone-${r.tone}`} />
              <div>
                {r.headline ? <b className={`fv-num tone-${r.tone}`}>{r.headline.value}<small>{r.headline.caption}</small></b> : null}
                <b className="fv-q">{r.question}</b>
                <span className="fv-tag">{r.topicLine}</span>
              </div>
            </div>
            <div role="cell">{r.fact}</div>
            <div className="inf" role="cell">{r.inference}</div>
            <div role="cell"><div className="fv-chips">{r.evidence.map(e => <span key={e}>{e}</span>)}</div></div>
            <div className="act" role="cell">
              {r.action}
              {r.onOpen ? <button type="button" className="fv-open" onClick={r.onOpen}>{r.openLabel ?? "Open the clinics"}</button> : null}
              {r.ask && askContext ? <RaiseQuestion card={r.ask} context={askContext} sales={sales} /> : null}
            </div>
            <div role="cell"><span className={`fv-st tone-${r.tone}`}>{r.last}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
