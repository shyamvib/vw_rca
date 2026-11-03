# Guided tours (Usertour)

Tours are built in Usertour's own builder, not in code. The app only loads the SDK, says who is signed in (work email and role, never clinic or revenue data), and exposes stable hooks for the builder to point at.

## Turn it on
Set these in Vercel (Production and Preview), then redeploy:

| Variable | Value |
| --- | --- |
| `VITE_USERTOUR_TOKEN` | Environment token from Usertour (Settings > Environments). Public by design. |
| `VITE_USERTOUR_OVERVIEW_FLOW` | Id of the Overview flow (the segment after `/flows/` in the flow's detail URL). Enables the "Take a tour" link on the Overview. |
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
