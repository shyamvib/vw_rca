/**
 * Usertour (in-app guided tours). Inert until VITE_USERTOUR_TOKEN is set, so nothing loads and nothing is sent without it.
 *
 *   VITE_USERTOUR_TOKEN          the environment token from Usertour (Settings > Environments); it is public by design
 *   VITE_USERTOUR_OVERVIEW_FLOW  the id of the Overview tour flow (the segment after /flows/ in its detail URL)
 *   VITE_USERTOUR_GZ_FLOW        the id of the Gut Zoomer clinic list tour (Overview family card, then the Target Product Orders cell)
 *
 * Flows are built in Usertour's own builder. They point at elements by `data-tour` attributes, which are a contract with
 * the markup: do not rename or remove them without updating the flow.
 */
import usertour from "usertour.js";

const TOKEN = import.meta.env.VITE_USERTOUR_TOKEN as string | undefined;
const OVERVIEW_FLOW = import.meta.env.VITE_USERTOUR_OVERVIEW_FLOW as string | undefined;
const GZ_FLOW = import.meta.env.VITE_USERTOUR_GZ_FLOW as string | undefined;

let ready = false;

/** Start the SDK and tell it who is signed in: work email and role only, never clinic or revenue data. */
export function startUsertour(user: { email: string; role: "team" | "lead" | "rep" }) {
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
  void usertour.start(OVERVIEW_FLOW).catch(() => undefined);
}

/** True once the Gut Zoomer tour is configured, so its link only shows when it can do something. */
export const gzTourAvailable = !!(TOKEN && GZ_FLOW);

/**
 * Walk the person from the Overview to the Gut Zoomer clinic list: the family card, then the Target Product Orders cell.
 * Called from the Overview link, and from the Business Feed card right after it switches to the Overview, so it waits
 * (up to 10 s) for the first target to be on the page; a flow whose target is missing would end silently.
 */
export function startGzTour() {
  if (!TOKEN || !GZ_FLOW || !ready) return;
  const flow = GZ_FLOW;
  const t0 = Date.now();
  const tick = () => {
    if (document.querySelector('[data-tour="ov-fam-gut-zoomer"]')) void usertour.start(flow).catch(() => undefined);
    else if (Date.now() - t0 < 10000) window.setTimeout(tick, 250);
  };
  tick();
}
