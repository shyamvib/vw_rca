import { api } from "@/lib/api";
import { useRcaQuery } from "@/lib/rca";
import { pw } from "./gatePw";
import { type ExecPeriod, LastSwitch, usePeriodTabs } from "./ExecutiveView";
import { FocusTable } from "./RepView";
import "./exec.css";

const COMPANY = "team:*";
const shortDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Clinic health: every clinic in one list, with the same columns and the same expanded clinic card as the list behind a scorecard
 * metric. It has its own Week / Month / Quarter / Full window buttons (with This / Last), kept apart from the Overview's, and the
 * window picked here is the one the list and every expanded card are measured in. It follows the team lead filter in the left rail.
 */
export function ClinicHealthView({ periods, teamLead }: { periods: ExecPeriod[]; teamLead?: string }) {
  const { tabs, tab, setSel, setLast } = usePeriodTabs(periods, "ch-last-window");
  const scope = teamLead ? `team:${teamLead}` : COMPANY;
  const p = tab.p;
  const q = useRcaQuery(api.repView.rowsByFocus, { password: pw(), periodId: p.id, sales: scope, focus: "" });
  const win = `${tab.label} (${shortDate(p.start)} – ${shortDate(p.end)})`;
  return (
    <div className="ev" data-tour="ch-page">
      <div className="ev-sechead" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>Clinic health</div>
        <div className="ev-secsub">Every clinic {teamLead ? `in ${teamLead}'s team` : "in the company"}, measured in the window below. Click a clinic to open its full card; the card uses the same window.</div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <div className="ev-seg" data-tour="ch-period" role="group" aria-label="Window">
          {tabs.map(t => (
            <button type="button" key={t.key} className={t.key === tab.key ? "is-on" : ""} onClick={() => setSel(t.key)}>{t.label}</button>
          ))}
        </div>
        <LastSwitch tab={tab} setLast={setLast} />
        <span className="ev-note" style={{ margin: 0 }}>{win}</span>
      </div>
      <FocusTable
        key={`${scope}|${p.id}`}
        label="All clinics"
        eyebrow="Clinic health"
        winLabel={win}
        hideClose
        rows={q?.ready ? q.rows : q ? [] : null}
        onClose={() => undefined}
        periodId={p.id}
        sales={scope}
      />
    </div>
  );
}
