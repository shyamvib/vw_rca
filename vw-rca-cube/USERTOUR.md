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
| `opp-grid`, `opp-<card>`, `opp-<card>-list`, `opp-<card>-scorecard` | Rep view Today's agenda, Opportunity agenda: the card grid, each card (`opp-crosssell`, `opp-whitespace`, `opp-atRisk`, `opp-lowAov`, `opp-prospects`), the number button that opens its clinic list, and its "See in scorecard" button. Cross-sell and Whitespace are Foundation Zoomer only. |
| `opp-grain`, `opp-grain-week`, `opp-grain-month`, `opp-grain-quarter`, `opp-grain-custom` | The agenda's window switch (This week / This month / This quarter / Custom window) and its four buttons |
| `opp-take-tour` | The "Tour: Foundation Zoomer cross-sell" link in the agenda header |
| `fz-zoomers`, `fz-top20`, `fz-list-say`, `fz-breakdown`, `list-first-row` | Inside the FZ clinic list: the Zoomer filter chips (and Top 20% only), the Top 20% button, the plain-words summary, a clinic's expanded breakdown, and the first row of any clinic list table |

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

### The Foundation Zoomer cross-sell flow (draft)
Flow "Foundation Zoomer cross-sell list (rep view)": Pick a window (`opp-grain`) -> Cross-sell card (`opp-crosssell`) -> **click** See in scorecard (`opp-crosssell-scorecard`) -> [hidden wait: `rv-sc-cross-sell-candidates` present] -> **click** the scorecard cell -> [hidden wait: `rv-sc-list` present] -> the list -> Zoomer filter (`fz-zoomers`) -> plain words (`fz-list-say`) -> **click** the first clinic (`list-first-row`) -> [hidden wait: `fz-breakdown` present] -> the breakdown -> Done. No start rule: the app starts it (`startFzTour`) from the agenda link. The hidden "wait" steps are what carry the tour across the tab change and the list opening: a tooltip step whose target is missing ends the whole flow, and these steps only move on once the next target is on the page (the page scrolls both the cell and the list into view, which "present" requires). The link is shown only when the agenda has a cross-sell list, because a rep with no open FZ results has no See in scorecard button on that card.
