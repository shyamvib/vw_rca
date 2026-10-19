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
- **Retention for new clinics** is the New split plus the early-life figure (share of this year's signups still active). The "2026 signups" cut of Revenue Retention / NRR / Expansion has no baseline to compute against.
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
  - Goals: existing clinics carry (target minus the new-business goal) over their baseline pace, so at $9.48M the existing factor is 0.986 (existing goals 1.4% under baseline; the cap that keeps them at baseline is $7.77M). Existing revenue is only about 88% of that goal, so existing still reads behind. Settings shows a warning when the slice is above the cap.
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
