import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/api";
import { announcementsFor, formatAnnouncementDate, offersAction, PAGE_LABEL, type Announcement, type Audience } from "@/lib/announcements";
import { pw } from "@/pages/gatePw";
import { QuietBoundary } from "./QuietBoundary";

/**
 * The announcement banner and the What's new page, shared by the rep view (reps, managers, account managers) and the Overview (team logins).
 * Styles are in src/pages/repview.css.
 *
 * A banner keeps showing for everyone until a banner admin (an email listed in convex/banners.ts) dismisses it, and the dismissal is shared, not
 * saved per browser. Whether the buttons show comes from the server (api.banners.canManage), so the list lives in one place.
 */

export function NewsBanner({ announcement: a, audienceLabel, showCta, onCta, onOpenNews }: {
  announcement: Announcement;
  /** Who it is hidden for when dismissed: "every rep", "everyone on the Overview". */
  audienceLabel: string;
  /** Show the button that starts the tour (off when there is nothing to tour, or no tour set up). */
  showCta: boolean;
  onCta: () => void;
  onOpenNews: () => void;
}) {
  const dismissed = useQuery(api.banners.dismissed, { password: pw() });
  const dismiss = useMutation(api.banners.dismiss);
  const isAdmin = useQuery(api.banners.canManage, { password: pw() }) === true;
  // Until the list of dismissed banners has loaded, show nothing, so a dismissed banner does not flash up.
  if (dismissed === undefined || dismissed.includes(a.id)) return null;
  const hideForAll = () => {
    if (window.confirm(`Hide this banner for ${audienceLabel}? You can show it again from What's new.`)) void dismiss({ password: pw(), bannerId: a.id });
  };
  return (
    <div className="rv-banner" role="region" aria-label={`New: ${a.title}`} data-tour="news-banner">
      <div className="rv-banner-tag">New · {formatAnnouncementDate(a.date)}</div>
      <div className="rv-banner-body">
        <b>{a.title}</b>
        <span>{a.summary}</span>
      </div>
      <div className="rv-banner-btns">
        {showCta && a.action ? <button type="button" className="rv-banner-go" data-tour="news-banner-cta" onClick={onCta}>{a.action.label}</button> : null}
        <button type="button" className="rv-opp-link" onClick={onOpenNews}>See what's new</button>
        {isAdmin ? <button type="button" className="rv-opp-link" data-tour="news-banner-dismiss" title={`Banner admins only: hides the banner for ${audienceLabel}`} onClick={hideForAll}>Dismiss for everyone</button> : null}
      </div>
    </div>
  );
}

/** Admins only: says the banner is hidden for everyone and lets them show it again. */
function BannerRestore({ bannerId, where }: { bannerId: string; where: string }) {
  const isAdmin = useQuery(api.banners.canManage, { password: pw() }) === true;
  const dismissed = useQuery(api.banners.dismissed, { password: pw() });
  const restore = useMutation(api.banners.restore);
  if (!isAdmin || !dismissed?.includes(bannerId)) return null;
  return (
    <p className="rv-dim rv-small">
      The banner {where} is hidden for everyone.{" "}
      <button type="button" className="rv-opp-link" onClick={() => void restore({ password: pw(), bannerId })}>Show it again</button>
    </p>
  );
}

/** The What's new page: every feature update for this place, newest first, each with the day it shipped. */
export function NewsPage({ audience, bannerId, where, intro, onTab, onTour }: {
  audience: Audience;
  /** The banner an admin can bring back from this page. */
  bannerId: string;
  where: string;
  intro: string;
  /** Rep view only: open one of its tabs (the entries' buttons that point into it). */
  onTab?: (t: "today" | "feed" | "week" | "month" | "quarter") => void;
  onTour: () => void;
}) {
  const run = (a: NonNullable<Announcement["action"]>) => (a.kind === "tab" ? onTab?.(a.tab) : onTour());
  return (
    <div className="rv-news" data-tour="news-page">
      <div className="rv-eyebrow">What's new</div>
      <h1 className="rv-h1">Feature updates</h1>
      <p className="rv-dim rv-small">{intro}</p>
      <QuietBoundary><BannerRestore bannerId={bannerId} where={where} /></QuietBoundary>
      {announcementsFor(audience).map(a => (
        <article className="rv-news-item" key={a.id} data-tour={`news-${a.id}`}>
          <div className="rv-news-date">
            {formatAnnouncementDate(a.date)}
            <span className="rv-news-pages">{a.pages.map(p => <span key={p} className="rv-news-page" data-page={p}>{PAGE_LABEL[p]}</span>)}</span>
          </div>
          <div className="rv-news-body">
            <h2>{a.title}</h2>
            <p>{a.summary}</p>
            <ul>{a.points.map(x => <li key={x}>{x}</li>)}</ul>
            {a.action && offersAction(a, audience) ? <button type="button" className="rv-banner-go" onClick={() => run(a.action!)}>{a.action.label}</button> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
