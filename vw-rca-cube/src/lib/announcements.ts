/**
 * Feature announcements shown on the rep view's "What's new" page and, for the newest one, as a banner on Today's agenda.
 *
 * To announce something: add an entry at the TOP of ANNOUNCEMENTS (newest first) with the date it shipped (YYYY-MM-DD). The page lists them in
 * this order, and the unread dot on the rail shows while the newest id is not the one the person last opened. Dates are written by hand, so
 * set the date to the day the change reached production.
 */
export type AnnouncementAction =
  | { kind: "tab"; label: string; tab: "today" | "feed" | "week" | "month" | "quarter" }
  | { kind: "fzTour"; label: string };

export type Announcement = {
  id: string;
  /** The day it shipped, YYYY-MM-DD. */
  date: string;
  title: string;
  summary: string;
  points: string[];
  action?: AnnouncementAction;
};

/** The id the Today's agenda banner announces. */
export const FZ_ANNOUNCEMENT_ID = "fz-cross-sell";

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: FZ_ANNOUNCEMENT_ID,
    date: "2026-11-09",
    title: "Gut Baseline and Gut Zoomer: find the clinics to pitch",
    summary:
      "Gut Baseline is new and leads into Gut Zoomer. Today's agenda has a Cross-sell card built from Foundation Zoomer results: the clinics whose gut results point to Gut Baseline or Gut Zoomer, with the low, high and likely revenue. The same list also covers the other Zoomers.",
    points: [
      "Pick This week, This month, This quarter or Custom window above the agenda cards; every card follows it.",
      "Get clinics walks you from the window list to the Foundation Zoomer card, the Cross-sell metric and the clinic list, then explains each number and column.",
      "In the list, choose the Gut Zoomer filter to see only the clinics whose gut results point to Gut Baseline or Gut Zoomer. Low is the revenue if every one orders Gut Baseline (the lower price), High if every one orders Gut Zoomer, and Likely is what usually converts.",
      "Open a clinic to see why to call, what to suggest and what to ask the provider.",
    ],
    action: { kind: "fzTour", label: "Get clinics" },
  },
  {
    id: "this-last-toggle",
    date: "2026-11-08",
    title: "This / Last toggle on the Week, Month and Quarter tabs",
    summary: "Each window tab now has a This / Last switch, so you can look back at last week, last month or last quarter with the same scorecard.",
    points: [
      "Press Last on the Week, Month or Quarter tab; the scorecard, the leaderboard and the thermometer follow it.",
      "Last quarter needs an earlier quarter inside the analysis window; if there isn't one, the button is greyed out.",
      "Today's agenda, My week plan and the Business feed stay on this week.",
    ],
    action: { kind: "tab", label: "Open the Month tab", tab: "month" },
  },
  {
    id: "gz-find-clinics",
    date: "2026-11-03",
    title: "Find Gut Zoomer clinics: a guided tour from the Business Feed",
    summary: "The Gut Zoomer question in the Business Feed has a Find Gut Zoomer clinics button that walks you, step by step, to the clinics losing Gut Zoomer orders.",
    points: [
      "On the Business feed card, press Find Gut Zoomer clinics.",
      "The tour opens the matching window, then asks you to click the Gut Zoomer card and the Target Product Orders cell to open the list.",
      "The list splits the clinics into those below expected (including stopped and declining) and those above.",
    ],
    action: { kind: "tab", label: "Open the Business feed", tab: "feed" },
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-09" -> "Nov 9, 2026" (read as a plain date, so no time zone can move it a day). */
export function formatAnnouncementDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The newest announcement's id (the list is newest first). */
export const latestAnnouncementId = (list: Announcement[] = ANNOUNCEMENTS): string | null => list[0]?.id ?? null;

/** Is there something the person has not opened? `seenId` is the newest id they have seen. */
export const hasUnseenAnnouncement = (seenId: string | null, list: Announcement[] = ANNOUNCEMENTS): boolean =>
  list.length > 0 && seenId !== list[0].id;
