/**
 * Usertour (in-app guided tours). Inert until VITE_USERTOUR_TOKEN is set, so nothing loads and nothing is sent without it.
 *
 *   VITE_USERTOUR_TOKEN          the environment token from Usertour (Settings > Environments); it is public by design
 *   VITE_USERTOUR_OVERVIEW_FLOW  the id of the Overview tour flow (the segment after /flows/ in its detail URL)
 *   VITE_USERTOUR_GZ_FLOW        the id of the Gut Zoomer clinic list tour (Overview family card, then the Target Product Orders cell)
 *   VITE_USERTOUR_GZ_REP_FLOW    the same tour for the rep view (Custom window tab: family card, then the Target Product Orders cell)
 *   VITE_USERTOUR_FZ_FLOW        the Foundation Zoomer cross-sell tour on the rep view's Today's agenda (agenda -> scorecard -> FZ clinic list)
 *   VITE_USERTOUR_FZ_OVERVIEW_FLOW  the same on the Overview (scope and window -> Foundation Zoomer card -> Cross-sell cell -> FZ clinic list)
 *
 * Flows are built in Usertour's own builder. They point at elements by `data-tour` attributes, which are a contract with
 * the markup: do not rename or remove them without updating the flow.
 */
import usertour from "usertour.js";

const TOKEN = import.meta.env.VITE_USERTOUR_TOKEN as string | undefined;
const OVERVIEW_FLOW = import.meta.env.VITE_USERTOUR_OVERVIEW_FLOW as string | undefined;
const GZ_FLOW = import.meta.env.VITE_USERTOUR_GZ_FLOW as string | undefined;
const GZ_REP_FLOW = import.meta.env.VITE_USERTOUR_GZ_REP_FLOW as string | undefined;
const FZ_FLOW = import.meta.env.VITE_USERTOUR_FZ_FLOW as string | undefined;
const FZ_OVERVIEW_FLOW = import.meta.env.VITE_USERTOUR_FZ_OVERVIEW_FLOW as string | undefined;

let ready = false;

/** Start the SDK and tell it who is signed in: work email and role only, never clinic or revenue data. */
export function startUsertour(user: { email: string; role: "team" | "lead" | "rep" | "cam" }) {
  if (!TOKEN || ready || !user.email) return;
  ready = true;
  try {
    usertour.init(TOKEN);
    void usertour.identify(user.email, { email: user.email, role: user.role }).catch(() => undefined);
  } catch {
    /* a blocked script or an ad blocker must never break the dashboard */
  }
}

/** True once the tour is configured, so the button only shows when it can do something. */
export const overviewTourAvailable = !!(TOKEN && OVERVIEW_FLOW);

/** Run the Overview tour from the start, even if the person has seen it before. */
export function startOverviewTour() {
  if (!TOKEN || !OVERVIEW_FLOW || !ready) return;
  expandRail();
  void usertour.start(OVERVIEW_FLOW).catch(() => undefined);
}

/** True once the Gut Zoomer tour is configured, so its link only shows when it can do something. */
export const gzTourAvailable = !!(TOKEN && GZ_FLOW);

/** The Overview's controls (team lead filter, window) live in the left sidebar, which starts collapsed; a tour that points at them asks it to open first. */
export const EXPAND_RAIL_EVENT = "rca:expand-rail";
const expandRail = () => window.dispatchEvent(new Event(EXPAND_RAIL_EVENT));

/** Start `flow` once its first target is on the page, waiting up to `waitMs`; a flow whose target is missing ends silently. */
function startWhenReady(flow: string, selector: string, waitMs: number) {
  const t0 = Date.now();
  const tick = () => {
    if (document.querySelector(selector)) void usertour.start(flow).catch(() => undefined);
    else if (Date.now() - t0 < waitMs) window.setTimeout(tick, 250);
  };
  tick();
}

/**
 * Walk the person from the Overview to the Gut Zoomer clinic list: the family card, then the Target Product Orders cell.
 * Called from the Business Feed card right after it switches to the Overview, so it waits (up to 10 s) for the first target.
 */
export function startGzTour() {
  if (!TOKEN || !GZ_FLOW || !ready) return;
  expandRail();
  startWhenReady(GZ_FLOW, '[data-tour="ov-fam-gut-zoomer"]', 10000);
}

/** True once the rep view's Gut Zoomer tour is configured. */
export const gzRepTourAvailable = !!(TOKEN && GZ_REP_FLOW);

/** Rep view version: called right after the rep view switches to its Custom (whole analysis window) tab. Family cards load after the book, so it waits longer. */
export function startGzRepTour() {
  if (!TOKEN || !GZ_REP_FLOW || !ready) return;
  startWhenReady(GZ_REP_FLOW, '[data-tour="rv-fam-gut-zoomer"]', 15000);
}

/** True once the Foundation Zoomer cross-sell tour is configured. */
export const fzTourAvailable = !!(TOKEN && FZ_FLOW);

/** Start the Foundation Zoomer cross-sell tour from the Opportunity agenda's "Get clinics": its first target is the window list in the left rail. */
export function startFzTour() {
  if (!TOKEN || !FZ_FLOW || !ready) return;
  startWhenReady(FZ_FLOW, '[data-tour="rv-nav"]', 10000);
}

/** True once the Overview's Foundation Zoomer cross-sell tour is configured. */
export const fzOverviewTourAvailable = !!(TOKEN && FZ_OVERVIEW_FLOW);

/** Start the Overview's Foundation Zoomer cross-sell tour: waits for the Overview's headline, which is on the page whenever the Overview is. */
export function startFzOverviewTour() {
  if (!TOKEN || !FZ_OVERVIEW_FLOW || !ready) return;
  expandRail();
  startWhenReady(FZ_OVERVIEW_FLOW, '[data-tour="ov-headline"]', 10000);
}
