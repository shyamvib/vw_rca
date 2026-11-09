# Guided tours (Usertour)

Tours are built in Usertour's own builder, not in code. The app only loads the SDK, says who is signed in (work email and role, never clinic or revenue data), and exposes stable hooks for the builder to point at.

## Turn it on
Set these in Vercel (Production and Preview), then redeploy:

| Variable | Value |
| --- | --- |
| `VITE_USERTOUR_TOKEN` | Environment token from Usertour (Settings > Environments). Public by design. |
| `VITE_USERTOUR_OVERVIEW_FLOW` | Id of the Overview flow (the segment after `/flows/` in the flow's detail URL). Enables the "Take a tour" link on the Overview. |
| `VITE_USERTOUR_FZ_FLOW` | Id of the Foundation Zoomer cross-sell flow (cmw8uvl8e0h3mw9w5vsz6ia7n). Enables the "Tour: Foundation Zoomer cross-sell" link in the Opportunity agenda's header (shown only when the agenda has a cross-sell list). |
| `VITE_USERTOUR_GZ_REP_FLOW` | Id of the rep view's Gut Zoomer flow (cmw1lznay05gow9w5x0dgyhro). Enables "Find Gut Zoomer clinics" on the rep Business feed card. |
| `VITE_USERTOUR_GZ_FLOW` | Id of the Gut Zoomer clinic list flow. Enables the "Find Gut Zoomer clinics" button on the Business Feed card. |

With no token the SDK is never loaded and nothing is sent.

## Targeting elements
Flows point at `data-tour` attributes. They are a contract with the markup: do not rename or remove one without updating the flow. In the Usertour picker extension, set the attribute anchor to allow `^data-tour$` and turn off id, class and tag.

| `data-tour` | Where |
| --- | --- |
| `nav-overview`, `nav-teams`, `nav-root-cause`, `nav-rep-view`, `nav-feed` | Top bar view tabs |
| `ov-lead-filter` | Top bar team lead filter |
| `ov-headline` | Overview headline |
| `ov-take-tour` | "Take a tour" link |
| `ov-compare` | vs goal / vs baseline switch |
| `ov-basis` | To date / To period end switch (only when the period is unfinished) |
| `ov-period` | Week / month / quarter / full window tabs |
| `ov-outlook` | Year-end outlook card |
| `ov-pillars`, `ov-design` | Pillar dials or cards, and the Dials / Cards switch |
| `ov-kpis` | Overall KPIs |
| `ov-map`, `ov-team` | State map, Team performance |
| `ov-families` | Product family cards |
| `ov-scorecard` | Scorecard |
| `ov-funnel` | New business funnel |
| `ov-signals` | Growth signals (only when there are any) |
| `ov-fam-<family>` (e.g. `ov-fam-gut-zoomer`) | Product family cards |
| `sc-<metric>` (e.g. `sc-target-product-orders`) | Scorecard cells |
| `ov-cell-list` | Clinic list opened from a scorecard cell |
| `rv-nav-<tab>` (e.g. `rv-nav-custom`) | Rep view left-rail tabs |
| `rv-fam-<family>`, `rv-sc-<metric>`, `rv-sc-list` | Rep view scorecard: family cards, cells (e.g. `rv-sc-target-product-orders`), and the clinic list a cell opens |
| `opp-grid`, `opp-<card>`, `opp-<card>-list`, `opp-<card>-scorecard`, `opp-crosssell-get`, `opp-crosssell-trio`, `opp-<card>-fold` (the Hide / Show clinics toggle) | Rep view Today's agenda, Opportunity agenda: the card grid, each card (`opp-crosssell`, `opp-whitespace`, `opp-atRisk`, `opp-lowAov`, `opp-prospects`), the number button that opens its clinic list, its "See in scorecard" button (the Cross-sell card has "Get clinics", `opp-crosssell-get`, instead, and no list or scorecard button). Cross-sell and Whitespace are Foundation Zoomer only; the Cross-sell card shows Low, High and Likely revenue (`opp-crosssell-trio`). |
| `opp-grain`, `opp-grain-week`, `opp-grain-month`, `opp-grain-quarter`, `opp-grain-custom` | The agenda's window switch (This week / This month / This quarter / Custom window) and its four buttons |
| `news-banner`, `news-banner-cta`, `news-page`, `news-<id>` | Rep view "What's new": the Foundation Zoomer banner at the top of Today's agenda and its Get clinics button (shown only when the rep has FZ results), the page, and each announcement on it. The rail entry is `rv-nav-news`. |
| `rv-nav` | The rep view's left rail list (Today's agenda, My week plan, Business feed, the window tabs, Scorecard guide); the window tabs also have `rv-nav-<tab>` and carry `is-on` when open |
| `fz-kpis`, `fz-zoomers`, `fz-top20`, `fz-list-say`, `fz-breakdown`, `list-col-<key>` (`list-col-fzOpen`, `list-col-fzStake`), `list-first-row` | Inside the FZ clinic list: the KPI strip, the Zoomer filter chips, the Top 20% button, the plain-words summary, a clinic's expanded breakdown, the FZ columns' headings, and the first row of any clinic list table. The Foundation Zoomer cross-sell cell also carries `data-fz="ready"` once its list can open |

## Suggested Overview tour
1. `ov-headline`: the one-sentence read of where revenue stands.
2. `ov-period`: pick the window; everything below follows it.
3. `ov-compare`: judge against the goal or against the baseline.
4. `ov-basis`: to date, or the whole period.
5. `ov-lead-filter`: narrow the page to one lead's team.
6. `ov-outlook`: where the year is heading against the target.
7. `ov-pillars` and `ov-design`: the five pillars, as dials or cards; click one for its clinics.
8. `ov-kpis`: the headline numbers behind them.
9. `ov-map` and `ov-team`: where the gap is, and who owns it.
10. `ov-families`: click a family to rescope the dials and scorecard.
11. `ov-scorecard`: every metric by pillar; blue bars mark cells that follow the family.
12. `ov-funnel`: new clinics from signup to order 5.

Start rule: Overview URL path, "Element is present" on `ov-headline`, shown once per user. The tabs are in-app state (no URL change), so keep the flow on the Overview itself.

## Gut Zoomer clinic list tour
Started by the "Find Gut Zoomer clinics" button on the Business Feed's Gut Zoomer card (`gz-loss`, in place of "Open the clinics"), which switches to the Overview and waits for the family card to be on the page before starting. The flow has no start rule. Steps advance when the person clicks the real element: the Gut Zoomer family card (`ov-fam-gut-zoomer`, scopes the scorecard to it), then the Target Product Orders cell (`sc-target-product-orders`, opens the clinic list), then a closing tooltip on `ov-cell-list`. Clicking a family card that is already selected clears it, so the first step assumes the scorecard is not already scoped to Gut Zoomer.

## Gut Zoomer tour, rep view
Same idea, started by "Find Gut Zoomer clinics" on the rep Business feed's `gz-loss` card. The rep feed question quotes the **whole analysis window** (period "all"), not this week, so the button switches to the **Custom** tab (`rv-nav-custom`), which shows that window, makes sure the scorecard is expanded, and starts the flow once the family cards have loaded. Steps: the Custom tab (why this window), the Gut Zoomer family card (`rv-fam-gut-zoomer`), the Target Product Orders cell (`rv-sc-target-product-orders`), the clinic list (`rv-sc-list`). If a team lead has picked a different window in the top bar, the Custom tab shows that window and its numbers will differ from the question.

## Opportunity agenda: window switch, and Cross-sell / Whitespace are Foundation Zoomer only
On the rep view's Today's agenda, a switch above the Opportunity agenda picks its window: **This week** (the default), **This month**, **This quarter** or **Custom window**. Every card follows it, including the FZ numbers, so the agenda and the scorecard tab behind it always show the same window.

- **Cross-sell candidates** lists the clinics whose Foundation Zoomer (FZ) results, from the chosen window, point to a Zoomer they have not ordered and that no order has followed, biggest likely revenue first, each with the Zoomer to pitch. The custom window counts every FZ result on file.
- **Product whitespace** is the clinics the rep marked eligible for Foundation Zoomer that have never ordered it (lifetime, so it does not change with the window).
- Only **This week** can **Add to today**, because My week plan is this week's plan; the other windows are for looking. My week plan ranks the same two lists, with this week's FZ numbers.
- **See in scorecard** opens the matching tab (Week / Month / Quarter / Custom), set to "This ...", with the same window; on the two FZ cards the scorecard is also scoped to Foundation Zoomer, so the Cross-sell cell shows the same number. Clicking that cell opens the FZ clinic list (`rv-sc-list`).

A tour that goes agenda -> scorecard -> list: `opp-grain-<window>` (pick a window), `opp-crosssell` (explain), `opp-crosssell-scorecard` (click; the page changes tab), `rv-sc-cross-sell-candidates` (click; opens the list), `rv-sc-list` (explain). The step after the tab change must wait for its target, because a tooltip step whose target is missing ends the whole flow.

### The Foundation Zoomer cross-sell flow
Flow "Foundation Zoomer cross-sell list (rep view)" (id `cmw8uvl8e0h3mw9w5vsz6ia7n`). Started by **Get clinics** on the Opportunity agenda's Cross-sell card (`startFzTour`); with no flow configured the button opens the scorecard on Foundation Zoomer instead. No start rule.

1. **Pick a window** on the left rail (`rv-nav`). Advances when any window tab (`rv-nav-week|month|quarter|custom`) is open (`.is-on`).
2. [hidden wait: the Foundation Zoomer card exists] -> **click the Foundation Zoomer card** (`rv-fam-foundation-zoomer`).
3. [hidden wait: the cross-sell cell is `data-fz="ready"`] -> **click Cross-sell candidates** (`rv-sc-cross-sell-candidates`).
4. [hidden wait: the list exists] -> the list (`rv-sc-list`) -> the numbers (`fz-kpis`) -> Zoomer filter (`fz-zoomers`) -> plain words (`fz-list-say`) -> FZ open column (`list-col-fzOpen`) -> At stake column (`list-col-fzStake`).
5. **Click the first clinic** (`list-first-row`) -> [hidden wait: `fz-breakdown`] -> the breakdown -> Done.

The hidden wait steps use the element condition "unclicked", which only needs the element in the page: the "present" condition also needs it inside the viewport, and several targets are below the fold until the tooltip scrolls to them. The waits also carry the tour across tab changes and the list opening, because a tooltip step whose target is missing ends the whole flow. A rep with no open FZ results never gets the `data-fz="ready"` cell, so the tour waits invisibly at step 3: the Cross-sell card shows "no open FZ results in this window" and no Get clinics button in that case.

## What's new (announcements)
The rep view's rail has a "What's new" page listing every feature update, newest first, each with the day it shipped, plus a blue dot on the rail entry until the newest one has been opened (kept per browser). The newest announcement about Foundation Zoomer cross-sell also shows as a dismissible banner at the top of Today's agenda; its **Get clinics** button starts the Foundation Zoomer cross-sell tour (the same one the Cross-sell card starts), and is shown only when the rep has FZ results. The list lives in `src/lib/announcements.ts`: to announce something, add an entry at the top with the day it reached production. The page, the banner and the dot all read from that one list.
