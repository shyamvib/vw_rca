# Clinic lifecycle: churn, new, reactivated, existing, and the new-business goal

Where we are as of 2026-10-18: what is decided, what is live, what is still open.
Numbers are from the live snapshot (window Aug 1 to Oct 17, baseline Feb 20 to May 21 2026, all 15 reps) unless noted.

## 1. Decided

### Churn
- A clinic is **churned** when it has not ordered for **45 or more days**, measured from its last order date to the latest data. It is the same on every tab (week, month, quarter).
- The rule applies to **every** clinic with revenue: existing, new and reactivated.
- A new or reactivated clinic that goes silent is churned, but its revenue stays in the New Business dial (it was real revenue).
- The fixed 45 days is too short for clinics that normally order less often than that. For 18% of clinics with a baseline the typical gap between orders is over 45 days (13% over 60, 7% over 90). **Agreed:** for established clinics use the clinic's own pattern, so a clinic is churned only after an *unusual* gap: at least 45 days **and** at least 3 times its own typical gap. Clinics with no measurable typical gap (too few orders) stay on 45 days. **New signups stay on a plain 45 days.**
  - Effect measured offline on existing clinics: churn falls from 46.6% to 33.3% (663 clinics are no longer churned). 688 clinics have no typical gap and stay on 45.

### Existing vs reactivated (agreed)
> A clinic that ordered in March, was silent through August, and ordered again in September would count as reactivated **and** existing at once, in two dials.

- A clinic with **baseline revenue stays Existing** and is measured against its baseline, even if it lapsed and came back.
- **Reactivated is only for clinics with no baseline revenue.** It is never applied to a clinic that is already Existing.

### Reactivated only counts unusual gaps (agreed)
> A clinic that normally orders every 60 days is "churned" for about 15 days of every cycle and then "reactivated" each time it orders. That inflates the churn rate and the reactivated count together.

- Reactivated counts only when the gap was unusual for that clinic: at least 45 days **and** at least 3 times its own typical gap.
- Churn itself stays at 45 days for new signups and uses the own-pattern rule for established clinics (above).

### New
- **New = a first-ever order in the current year**, wherever it falls relative to the baseline, a month or a quarter.
- **New clinics have no baseline and no clinic-level goal.** All their revenue counts as gain. Under New show a split: **active**, **reactivated**, **churned**.
- **Retention for new clinics** is the New split plus the early-life figure (share of this year's signups still active). The "2026 signups" cut of Revenue Retention / NRR / Expansion has no baseline to compute against, so on that cut the Revenue Retention cell shows the share of new clinics still ordering (31% on the live data: 700 of 2,242, 449 active and 251 reactivated; 1,542 churned) and NRR, Expansion and At-risk read "new clinics have no baseline yet" (built 2026-10-18).
- **No 90-day focus window (dropped 2026-10-18).** The scorecard is already scoped by its tabs (this week, this month, this quarter), so New keeps one definition: a first order in the current year. The tree's Provider Retention Funnel (orders 1 to 5) stays scoped to the selected tab: it counts clinics whose first order falls inside that month or quarter.
- **On the scorecard (per tab), decided 2026-10-18:** the New Revenue cell's headline is **all new clinics' revenue in the tab**, shown as **active + reactivated + churned** lines; new clinics that are churned are also counted in the Churned cell. (For this week, month and quarter the churned line is $0, because a clinic silent 45+ days has no orders there; on older tabs and the whole window it is not: $203K, 11% of new revenue for the whole window.) This keeps New + Existing = Combined. Existing shrinks by the clinics that are now New. The New Business dial reads its clinic count and value from the New Revenue cell, so they always match.
- **Order 1 to 2 conversion, decided 2026-10-18:** uses a **rolling 90 days**: new clinics whose first order is in the last 90 days (and this year). Caveat: the youngest of them cannot have reordered yet, which pulls the rate down a little; leaving out clinics whose first order is under 45 days old would remove that.
- In the lifecycle tree, active new clinics sit under **Active** as a tier named "New", next to "Largest 20%" and "Everyone else". Silent new clinics are Churned; reactivated ones are Reactivated.

### The new-business goal (agreed: a Settings number)
- The annual target (Settings, $130M today) is split into an **existing-business goal** and a **new-business goal**. The new-business goal is a **number in Settings**.
- **Existing clinics** keep goal = baseline x a factor. The factor is now (target minus the new-business goal) divided by the older clinics' baseline pace. The baseline period is fixed, so goals stay stable (no drift).
- **New clinics** get a goal as a group, not one by one. The New Business dial shows a real goal instead of "—", and New + Existing adds up to Combined for goal, heading and plan.
- Company goal still equals the target exactly.
- Settings warns when the new-business number is so large that existing goals fall below their baseline.
- **Decided 2026-10-18 (updated later the same day):**
  - The new-business goal defaults to **last year's new-clinic revenue** (revenue in 2025 from clinics that first ordered in 2025, including ones that have since churned): **$9.48M**, 7.3% of the $130M target. It is still a Settings number and can be overridden. (It started as 5% of the target, $6.5M; that was 31% below last year and made new business look far ahead.)
  - It is **phased by last year's monthly shape** of that revenue (3.2% of the year in January up to 13.2% in October, 10.7% and 10.9% in November and December), spread evenly within a month, instead of evenly through the year.
  - **Reps share it by their existing baseline share** (how goals already split).
  - It **stays at rep and company level**: no goal on individual new clinics (a lump split across clinics that join through the year would dilute every time one joins). New clinic lists show revenue and status, not above/below goal.
  - Goals: existing clinics carry (target minus the new-business goal) over their baseline pace, **but their goal is never below their baseline** (decided 2026-10-18: the factor is floored at 1). The slice that keeps the total on target is $7.77M (the cap). Above it, existing goals are held at baseline and the year's goal totals more than the target: at the $10.0M saved in Settings the year's goal is baseline $122.2M + $10.0M = $132.2M, $2.2M above the $130M target. Settings says so when the slice is above the cap.
  - Attainment on the live data with this setup (new + returning revenue over the phased goal): August 79%, September 82%, October 1 to 17 77%, window 80%: new business is running about 20% behind last year's pace at the same point.
  - The New dial projects its heading with its own factor (full-period phased goal over goal so far); the Existing dial uses the weekday-shaped factor; New + Existing add up to the Combined heading and plan.
- Considered and not chosen: splitting by each rep's new revenue so far (circular: every rep ends at the same % of goal, and a rep with no new revenue gets no goal); splitting by last year's new revenue per rep with a 10% equal share (it differentiates reps, but was not chosen).
- For reference when choosing the Settings number: last year's new-clinic revenue (clinics that first ordered in 2025, including ones that have since churned) was **$9.48M** (8.7% of 2025 revenue of $108.6M), so $6.5M is 31% below it. The most the slice can be while existing goals stay at their baseline is $8.6M. This year's signups are running at about $6.2M annualised ($4.90M so far), which is about 35% below last year; against $6.5M spread evenly, goal to date is $5.17M, so new business reads 95% of goal.

### Why not a baseline for new clinics
A 3-order baseline (first 3 orders' revenue over the days between the first and third order, minimum 28 days) was tested on this year's new clinics that reached 3 orders and had 3+ weeks of data (211 clinics). It sets the bar far too high: after the third order, actual daily revenue is a median 0.15 times the baseline, 87% of clinics fall below it, 73% below half, and 27% never order again. Variants (leaving out order 1, a 56-day minimum) only reached 0.25 to 0.39 times. It would also never expire, so a clinic that stops keeps a baseline all year, and the goal factor would drift as clinics cross the threshold. Dropped in favour of the new-business goal.

### Language and dials
- The word for the revenue target everywhere is **goal**. "Plan" only remains for the rep's to-do schedule ("My week plan").
- Dials must match the matrix cells: a dial's clinic count is read from the cell it stands for. New + Existing dials add up to the Combined dial.
- Goal = the Settings annual target spread over the year by baseline weekday weights. P75 is kept only as a benchmark.
- Baseline period: the best 91 days of data before the analysis window (currently Feb 20 to May 21 2026), selectable in Settings (trailing 13 weeks, best 13 weeks, custom dates).
- Retention and repeat target levels scale with the length of the tab, and differ by tenure cut (all / before 2025 / 2025 / this year's signups).

## 2. Live today (before this build is deployed)

| Item | State |
|---|---|
| Goal from the Settings target; baseline period selectable (default best 91 days) | live |
| Churn = last order 45+ days ago, for existing, new and reactivated (scorecard and lifecycle tree) | live |
| New = a first order inside the analysis window (Aug 1 to Oct 17) | live, **to be replaced** by "current year" |
| Reactivated = first order before the window, no baseline revenue, ordering in the window (no unusual-gap test) | live, **to be replaced** |
| Churn is a flat 45 days for everyone | live, **to be refined** (own-pattern rule for established clinics) |
| Dials use one projection factor; plan = goal; "goal" wording | live |
| At-risk, existing, churned, new and reactivated counts do not change with the tab | live |

## 3. Built (2026-10-18, committed on main, not deployed yet)

Everything in section 1 is built. The rebuild side (`analytics/refresh.ts`, `analytics/lifecycleRules.ts`) has not run against Cube yet because Cube is blocked from the dev machine; the rules and everything downstream were checked offline on a copy of the live snapshot with the real order dates (all tie-outs pass, see below). Verify on the first server rebuild.

1. New = first order in the current year, no baseline; active / reactivated / churned split; Active has a "New" tier in the trees.
2. Churn by the clinic's own threshold (45 days for new clinics, max(45, 3x typical gap) for established ones); reactivated only for no-baseline clinics after an unusual gap; slow buyers with no baseline get their own 12-month history as a baseline.
3. The new-business goal: a Settings number (default: last year's new-clinic revenue), the existing factor from the remainder, rep shares by baseline share, a "New business goal" line in every lens so each lens adds up to the shortfall, and the New and Existing dial plans adding up to the Combined plan.
4. Scorecard: New Revenue cell headline = all new revenue with active / reactivated / churned lines, Existing excludes new clinics, churn base = existing + new + returning, new in a tab = first order on or before the tab's last day, order 1 to 2 conversion on a rolling 90 days.

Offline checks on the live data (15 reps, this week / month / quarter): company, clinics, reps, rep books and cohorts tie to the headline; New + Existing + returning revenue equals the book; (existing goal + new goal) x projection ratio equals the Combined plan; no invariant violations.

Expected live numbers (from the offline run, before the rebuild): this year's signups 1,597 (445 active, 251 reactivated, 901 churned); existing clinics 4,306 (273 of them on their own 12-month baseline); returning no-baseline clinics 378. Company baseline falls from $26.9M to $25.8M over the window, ambition rises, company goal is still the target.

## 4. Consequences to expect

- **The 945 clinics that first ordered this year before Aug 1 and carry a baseline today ($1.33M, 4.9% of the company baseline) lose it** and become New. Existing shrinks by about that many clinics and the older clinics' baseline pace is $121.4M a year.
- **Sizing:** the gap between the target and the older clinics' baseline pace is $8.6M (6.6% of the target). A new-business goal above that pushes existing goals below their baseline; at exactly $8.6M existing ambition is 0. This year's signups have brought $4.90M so far (5.2% of company revenue); an even spread of $8.6M would be $6.84M by day 290.
- **Goals shift between reps** depending on the rep-share rule. With shares by existing baseline, a rep with many early signups gets a smaller existing goal (their baseline share falls), plus a share of the new-business goal.
- **Reactivated shrinks** from 809 clinics to the no-baseline, unusual-gap group; the 103 clinics that signed up after the baseline period ended but more than 90 days ago become New (80 of them still order, 23 are silent).
- **January reset:** on Jan 1 the New group and the new-business goal reset, so early-year New metrics are noisy (a few clinics per rep until about April).
- Reactivated needs each clinic's order dates. The rebuild already pulls them for the buying-rhythm flags; confirm they go far enough back on the first rebuild.

## 5. Still to confirm

- (Decided 2026-10-18) **New in a tab = first order on or before the tab's last day**, so an earlier week or month does not list clinics that had not started yet (42 of 1,597 would be wrongly included for the week of Oct 5, 89 for September).

- (Decided 2026-10-18) **Slow buyers with no baseline** get a baseline from their own longer history: a clinic that is not new, has no revenue in the baseline period and has no unusual gap gets its average daily revenue over the 12 months before the baseline period ended, so it is Existing. Found while preparing the build: 651 older clinics ($648K) have no baseline revenue and ordered in the window; 382 ($330K) typically order less often than every 30 days, so 91 days of silence is not unusual for them (212 are unusual-gap reactivated, 57 have no typical gap and use the 45-day rule). Needs one extra clinic-level revenue pull in the rebuild.

- The reading of the tree and dial: new clinics feed the tree by status (active new under Active, churned under Churned, reactivated under Reactivated) while the New Business dial shows them together with the three-way split. - **confirmed** 
- Reactivated lasting 90 days after the order that ended the gap, then back to active. **confirmed**

## 6. Words used on the dashboard (changed 2026-10-18)

The shortfall against goal is split in two, with plain names:
- **Change vs baseline** (was "real change"): actual minus baseline, what the clinics did compared with what they normally do.
- **Goal stretch** (was "ambition"): how far the goal sits above baseline. With the floor above it is never negative for existing clinics; the new-business goal counts as stretch.
- Shortfall vs goal = change vs baseline plus goal stretch (shown with the stretch as a negative number, so the two add up to the shortfall).
- **Baseline** is what these clinics normally do (their average over the baseline period).

## 7. Clinic card, product families (changed 2026-10-18)

- The card's family table has two windows and now says so. **Orders and expected follow the tab** (expected = the clinic's baseline-period orders in that family scaled to the window; a clinic that is new this year has none expected). **Status** (NEW / DECLINING / STOPPED) is the last 28 days against the prior 90 days up to the latest order, tracked per test, whatever the tab (the Cube model now uses 90 days, as the text always said; it had been inferred as 84, and the average is shown per 28 days). The model also reports the exact date it anchored on, so the card prints exact dates.
- The status model works on 33 tests (Portfolio Changes, `cube/model/cubes/portfolio_changes.yml`), not product families, so a status only attaches to a family row when the names match exactly. Tests with a status but no family row in the tab (for example "Hormone Zoomer 2.0", or a Zoomer ordered only in late September) are listed in a second block, "Other tests with activity in the last 28 days".
- The heading counts families ordered in the tab and how many are product families (Non Zoomer and Unmapped are not), so it reads against Products per customer. Cross-sell candidates use lifetime families (since Jan 2025), a third window.
- Family baselines (rep, lead and clinic card) no longer include what new clinics ordered in the baseline period.

## 8. Parked: portfolio status redesign (decide later)

Idea (2026-10-19): drop the model's "last 28 days vs prior 90 days" status and use one portfolio table scoped to the tab (this month, this quarter, ...) on the clinic's full history, with NEW / RESTARTED / STOPPED / DECLINING. Sketch:
- NEW: ordered in the tab and never before it. RESTARTED: ordered in the tab, ordered before, gap since its previous order of that family 90 days or more. STOPPED: none in the tab although expected is at least 1 and it has ordered before. DECLINING: ordered in the tab at half or less of expected. Expected is the existing baseline-period expectation.
- Open flaws to resolve: short tabs make STOPPED noisy (need expected of at least 1 in the tab and the days since its last order past its own usual gap); clinics new this year have no baseline so no STOPPED / DECLINING; the comparison base (baseline period vs the period before the tab); past tabs must use history only up to the tab's end; use product families, not the model's 33 tests (names do not match families); the "Portfolio status" filter above the clinic lists, the "Portfolio changes" count and some feed alerts are built from the Cube model and would have to be rebuilt per rep and tab from the clinic-by-family order data.
- Until then the card keeps the model's status (last 28 days vs prior 90 days, per test) with NEW relabelled RESTARTED when the clinic ordered that family before the status window; the clinic-list filter still shows the model's labels (NEW, not RESTARTED).

## 9. Family expectations on the clinic card (2026-10-19)

- A family needs **3 or more orders in the baseline period** before anything is expected of it; with fewer (or for a clinic new this year) the card says "nothing expected" and shows no expected, no Order Δ.
- Even with an expectation, the Order Δ is shown only when **expected is 1 or more in the tab**; below that the card reads "vs <1" and a dash.
- These thresholds only affect the Expected and Order Δ columns; the status thresholds in the Cube model (STOPPED 3, DECLINING 6) are separate.
- **RESTARTED needs 3 or more earlier orders** of that test (before the 28 + 90 day status window); with fewer it stays NEW (decided 2026-10-19). Parked with the redesign: a guard for slow rhythms (restarted only when the gap is at least 3x the clinic's usual gap for that test, minimum 90 days) and a cap of about 2 years on how far back "earlier" looks.

## 10. Parked: deploying to the server without the tarball (decide later)

Today a deploy is: build a tarball of `analytics/` and `engine/`, copy it to `/home/shyam/rca-engine`, `docker compose up -d --build`, then trigger `/admin/rebuild`. The user runs the copy and build (the permission check blocks the assistant from running prod deploy commands); the assistant runs the rebuild and the live checks. The Cube model is copied separately (`cube/model-vibrant/cubes/*.yml` to `/home/shyam/cube-rca/model/cubes/`, backup first, restart only `cube-rca-cube-rca-1`; the server runs the vibrant variant, not `cube/model`).

Options discussed:
1. **One deploy script** (tar, copy, compose up, rebuild trigger, health check) for the engine, plus one for the Cube model files with backup and restart. Works today; the assistant can run it if a permission rule allows `ssh` / `scp` to `shyam@10.6.2.34`.
2. **Server pulls from git.** The server (git 2.43, can reach github.com) clones `shyamvib/vw_rca` (project in the `vw-rca-cube` subfolder) with a read-only deploy key that the user adds under Repo, Settings, Deploy keys; compose points at the subfolder and keeps the same `.env`, project name and data volume; a deploy is `git pull`, `docker compose up -d --build`, rebuild trigger; rollback is `git checkout <commit>`. Trade-offs: the server only gets pushed code (the assistant cannot push, so testing new code on the server before the user pushes needs a branch push); keep it a command, not a cron or webhook, so the service deploys before the frontend when order matters; Cube model files stay a separate careful copy (other teams' models sit in the same folder); the permission rule is still needed for the assistant to run it.
3. Auto-deploy on push (GitHub Actions to the server): not recommended, the server would have to be reachable from GitHub.

Next step when resumed: write the scripts (option 1), then set up the clone and deploy key (option 2).

## 11. Product Growth lists (2026-10-19)

- The product family cards are always visible on the scorecard, not only when the Product Growth pillar is clicked.
- **Target Product Orders** list (selected family): pulling down = below expected orders for that family, or Portfolio Changes STOPPED / DECLINING on it; pushing up = above expected, or RESTARTED / NEW with orders. Each line shows orders vs expected and the status. Expected = baseline-period family orders x the tab's share, same thresholds as the clinic card (3+ baseline orders, new clinics none).
- **Product adoption** = (new clinics that ordered the family + existing clinics that added it) / (new clinics ordering + existing clinics ordering in the window). Subtext shows the split (new a/b, existing added c/d). Lists: All / New / Existing.
- **Existing clinic "added" the product** = ordered it in the selected window **and** status NEW. A NEW status alone is not enough: the status looks at the last 28 days and ignores the tab, so a clinic could show as adding a product with 0 orders in "this month" (found with Newu Hydration Lounge, Total Tox). Existing clinics with no orders in the window are not measured.
- Statuses are per test; a test counts for a family when its name starts with the family name ("Hormone Zoomer 2.0" for Hormone Zoomer).
- Open: the card colour thresholds (50% / 30%) were set for new clinics only and read low for the blended rate; re-derive or tie colour to the new-clinic rate. Lines still show window orders only, not the clinic's recent-28-day orders.

## 12. Great Job section follows the lifecycle rules (2026-10-19)

- **Beating goal, Momentum, Bundle gainers, Comebacks**: existing clinics only (not new, has a baseline), each against its own goal. New and returning clinics have no per-clinic goal (they sit under the new-business goal), so their whole revenue no longer counts as "beating goal". The old on-pace check for new clinics is dropped here.
- **New-logo wins**: this year's new clinics plus returning clinics (no baseline, reactivated) that ordered in the window; the card shows the split. Membership is the calendar-year rule, not "first order inside the window".
- **Touch effort** (Great Job line and the Touch effort cards): pool = existing + new + returning (same as the churn base); the team average uses the same pool. The Great Job line's "last N days" follows the Touch effort "Order within" choice (14 when it is "any time"); the choice is shared between the two.

## 13. Rep-view-only logins that see every rep (2026-10-19)

A rep account can carry `allReps: true` (set with `adminUpsert`). It signs in like a rep but is not pinned to one salesperson: scoped data calls pass through with whatever `sales` the page asks for, team-only calls (company dashboard, Business Feed, settings) are refused, and the UI shows only the Rep view with a rep list and a "Switch rep" button. First two: Suzi Hansen, Kristina Banister. Needs the Convex deploy, the engine tarball and the frontend push.

## 14. My week plan refresh (2026-10-19)

- Pools follow the lifecycle rules: Call first = at least 5 days since the last order and not churned by the clinic's own threshold; new-clinic actions use the calendar-year "new" rule; each long pool is capped to the biggest 25 (15 for returning) so the hours are realistic.
- Likelihood starts from the rep's own touched-then-reordered rate over the quarter (shrunk toward 50% over 20 clinics), times a per-action factor, capped at 0.9. Win-backs (churned clinics, stopped / declining products) count half their baseline revenue.
- New actions: win back churned clinics, save new clinics near the churn line (30-44 days), get the second order, make the restart stick (returning clinics), follow up touched-not-reordered, first touch for big idle clinics, close the gap (clinics behind goal), win back STOPPED products, re-engage DECLINING products, lift the target product, introduce it to new clinics, ask for the repeat, whitespace and cross-sell (now ranked).
- The page shows "Gap to goal this week" (heading vs goal, split existing / new business) and how much of the shortfall the planned actions are expected to cover.
- Open: Today's "Call first" list now uses the own-threshold rule while the scorecard At-risk cell keeps its 5-44 day window plus health flags; the target product for the product actions is Hormone Zoomer (the scorecard default).
- Growing clinics are not a plan action (already above baseline, no gap; the upside was an assumption). Expansion is the second-family pitch only.

## 15. Parked: resilience and exposure follow-ups before the sales rollout (2026-10-20)

Done: engine hardening (clean 4xx, 503 when Cube is down, no internal messages in 500s, function-name allowlist, throttle on team-password guesses, trimmed public /health, CORS for this project's per-deployment Vercel URLs, refresh trims the latest day only when it is today in Pacific, scheduler catches a missed 13:00 UTC slot). Tested on a temporary engine copy with Cube unreachable: 29 of 30 checks passed (the one miss, GET /rpc, passes in isolation).

Come back to:
1. **Stop the Cube tunnel** `cube-rca-tunnel-rca-1` (public quick tunnel to Cube; nothing in the app uses it) and remove it from the cube-rca compose file. Blocked for the assistant by the permission check, so the user runs it.
2. **Rotate the Cube API secret** (printed in a session by mistake): new `CUBEJS_API_SECRET` for Cube and `CUBE_API_SECRET` for the engine, restart `cube-rca-cube-rca-1` and `rca-engine`.
3. **Deploy the engine tarball** with the hardening, the Pacific-day trim and the scheduler fix, then trigger one rebuild (data should then run through yesterday).
4. **Named Cloudflare tunnel** for the engine instead of a quick tunnel (random address each restart, no uptime guarantee, no rate limits).
5. **Live chaos run in a quiet window:** restart the engine and time recovery, block Cube for a few minutes, fail a rebuild halfway.
6. **Other ports on the server** (Cube 4000-4003 and 15432, ClickHouse 18123 and 19000, 8080, 8090, 6791 listen on all interfaces): ask whoever manages the firewall whether any is reachable from outside. Other stacks, not ours.
7. **Sign-in rate limiting** on the Convex login and admin password was not tested (Convex, not the engine).
8. The prod Convex deploy key file in the scratchpad is gone; generate a fresh key in the Convex dashboard if the assistant needs to run Convex commands again.

## 16. Business Feed redesign (2026-10-20)

- **Card design (company feed and rep feed):** a soft tinted header with the headline number (dark tone-coloured text), then four labelled steps on a vertical rail with solid colour chips: Fact (blue), Inference (violet), Evidence (teal), Action (amber). Mock-ups: Artifact "Business Feed redesign" (options A-D and the hybrid).
- **Company feed (`InsightCard` in `RcaDashboardPage.tsx`):** restyled; the headline number is read back out of the fact sentence by `src/lib/insightHeadline.ts` (signed dollar figure first, else a count or a percentage, with a per-topic caption). Edit, history, related and status are kept.
- **Rep view:** a dedicated "Business feed" tab (not on Today's agenda) showing the main Business Feed's own questions cut to the rep's clinics, nothing from the action queue. Shortlisted so far: "Is Toxin Zoomer offsetting the Total Tox downfall?" and "Which clinics are ready for the $400 Foundation Zoomer panel?". `feed:repQuestions` builds them with the same functions as the company feed (`analytics/feedItems.ts`: the two item builders plus the Inference / Action / Evidence / Confidence helpers moved out of `insights.ts`), so the wording is identical; a question that does not apply to the rep returns with `applies: false`. Adding a question: build its item in `feedItems.ts`, use it in `build()` and in `repQuestions`. "Open the clinics" on the Toxin Zoomer question opens the main dashboard's own "Who moved from Total Tox to Toxin Zoomer?" list (`SwitchPanel`, cut to the rep with the new `sales` argument of `families:switchClinicsAction`). There is no "Mark done".
- **Open (parked):** the company feed's *text* is still generated by the old run-rate logic in `analytics/feed.ts` ("against the baseline run rate", silent clinics = zero orders in the window, per-rep "% of expected book"). It does not follow the goal / baseline / lifecycle rules used by the scorecard, so its numbers differ from the dials. Regenerating the cards on the current rules (and writing the headline number as data instead of parsing it) is the real content refactor; the warehouse-sink idea is paused.

- **Table view (2026-10-20):** the company feed and the rep feed both have a Cards / Table toggle (`src/pages/FeedViews.tsx`; choice kept in the browser). The table is one row per signal with Fact, Inference, Evidence and Action as coloured column headers (last column: Status on the company feed, Confidence on the rep feed). Both feeds use two columns of cards on wide screens.

## 17. Raise a question -> Jira (2026-10-20)

`feed:raiseQuestion` is now open to team, rep and manager logins, takes the asker's email from the session, rate-limits to 10 an hour per person, and creates a Jira issue (`analytics/jira.ts`: REST API v3, Basic auth with an API token, description in Atlassian Document Format with asker, scope, where raised and, from a card, the card's question, fact and id). A "Raise a question" button is on every Business Feed card (cards and table, company and rep). `POST|GET /admin/jira-check` (admin secret) verifies the credentials without creating anything. Needs the JIRA_* variables in the engine .env (see DEPLOY_VERCEL_CONVEX.md); not yet configured on the server. Tested against a mock Jira server (success, 400, 401, 403, timeout, rate limit, scope text); not yet against the real Jira site.
- Portal mode (same day): `JIRA_SERVICE_DESK_ID` + `JIRA_REQUEST_TYPE_ID` switch the engine to the Jira Service Management request API (`POST /rest/servicedeskapi/request`, optional raise-on-behalf-of); the admin check lists the service desk's request types and the required fields of the chosen one. Tested against a mock service desk API only.
- **Rep view (2026-10-21):** one global "Raise a question" button in the rail (every tab) opens a dialog instead of a button on each card; the tab it was raised from goes in the context, and on the Business feed tab the question can be tied to one of its cards ("About" list). The company feed keeps its per-card buttons.

## 18. Team scope for VPs of sales (2026-10-21)

A manager login (Suzi Hansen, Kristina Banister) can choose "All reps (my team)" in the rep view: the whole view (every tab, scorecard, plan, Business feed, touch effort, funnel, product lists) is cut to the lead plus every rep under them as one combined book. Technically the rep view's `sales` argument is `team:<lead name>` (`analytics/scope.ts`): `drill()` turns it into the team-lead filter, the rep baseline uses the lead's own baseline row, family rows use the lead's family series, and the funnel, VA list, switcher and family lists match by the lead's reps. A rep login is still pinned to its own name by the access wrapper, so it cannot reach a team scope. Checked: the team book's clinics, actual, goal, orders and new-business goal equal the sum of its nine reps. Not covered: per-rep product whitespace marks (hidden in team scope; pick a rep).

## 19. Combining metrics: audit and the scorecard map (2026-10-21)

**Rule:** counts and dollars are summed; ratios (AOV, retention, churn, NRR, repeat and expansion rate, bundle share, days between orders) are always recomputed from the summed numerator and denominator, never averaged or added across reps. A percentile baseline (P75) is not additive, so a rep, a team and the company each read their own baseline row; the clinic rows only feed the lists.
**Audit (team vs sum of its reps, Q4):** clinics, actual, goal, orders and every additive field tie. One fix: the volume / AOV-effect split. Pricing a team's order gap at the blended team AOV moved ~$23K between the two (a mix effect) so the team card did not equal its reps; a team's volume is now the sum of each rep's volume at that rep's own baseline AOV (volume + AOV effect is unchanged = actual - existing goal). Run rate uses the scope's own weekday shape, so it is not the sum of the reps' run rates (0.05% apart); that is intended. The clinic-level volume / AOV sums in the lists still differ from the card (each clinic at its own AOV), as the list note says.
**Scorecard click:** the clinic list opens with a map (US states coloured by the metric's dollar impact, or net clinics for count metrics) and an RSM table (clinics, up, down, impact). Clicking an RSM or a state filters the tabs and the list; the map shows that RSM's footprint and the RSM table shows that state's reps. `src/pages/MetricMap.tsx`; rows from `repView:rowsByFocus` now carry `sales` and `country`. Clinics outside the US are in the list but not drawn.
**Second pass (2026-10-21):** the company dashboard's team-lead filter (`geo:scopeTotals` with a lead) now uses the same sum-of-reps volume (`repsVolume` in `analytics/repView.ts`), so a lead's card there equals the rep view's team scope (Kristina exactly; Suzi 1 order / $513 apart because the dashboard drops a clinic with an order but $0 revenue and no goal). Company vs sum of its two leads: actual and orders tie; clinics differ by 3 and goal by about $5K because 11 clinics (about $4.2K of baseline) have neither a lead nor a rep, so they sit in the company number only; the company volume / AOV split is priced at the company's blended AOV, so it differs from the sum of the leads by the mix effect (-$449.7K vs -$430.8K volume). Within a team book: actual = existing + new + returning exactly; churn + retention = 100%; tenure cuts add up to the all-clinics numbers (clinics, revenue, churn base); the lead's family series equals the sum of its reps' for all 19 families. No rep has clinics under two leads. The Cube-backed product lists (`productGrowth`) cut by the team lead, which is the same clinic set as the union of the reps, but they were not run here (no Cube access from the test snapshot).
**Chaos pass (2026-10-21):** 9 rep-view queries x 11 period ids (including garbage and empty) x 10 scopes (team, rep, unknown, blank, injection-style, doubled prefix): no crash, no NaN or infinity; a rep login stays pinned to its own book whatever scope it sends; empty, forged and wrong credentials are refused; team = sum of reps (actual, orders, clinics, goal, volume) on six periods for both leads, and volume + AOV effect = actual - existing goal. Found and fixed: a scope of "team:" with no name matched every clinic (now treated as an unknown rep, zero clinics), and a rep with no baseline row flipped the whole team's volume to the blended calculation (that rep now falls back to their own clinics' goals; for one rep the two are equal). `MetricMap` rendered with empty data, unknown states, blank reps, NaN, foreign clinics, an unmatched filter and 10,000 clinics. A team-lead login (kind "lead") can pass any team scope, by design: those logins already see every rep.
