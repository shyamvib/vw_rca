/**
 * Scorecard guide (2026-10-19). The scorecard now sits inside every window tab (This week, This month, This quarter), so
 * the dedicated page became a plain-English guide: what every dial and every cell means, how it is worked out, which clinics
 * it counts, and a small made-up example with a picture. Nothing here loads data; the numbers in the examples are invented
 * to make the arithmetic easy to follow.
 */
import React, { useEffect, useState } from "react";

type Go = (t: "week" | "month" | "quarter") => void;

/** The actual scorecard links here ("Explain this metric"): the app registers `go` to switch to the guide tab; the guide scrolls to `target` when it opens. */
export const guideNav = { target: null as string | null, go: (_id: string) => {} };
export function openGuide(id: string) {
  guideNav.target = id;
  guideNav.go(id);
}

/** Scorecard cell label to guide section id (family-scoped cells keep the same labels). */
const GUIDE_ID: Record<string, string> = {
  "New Revenue": "new-revenue",
  AOV: "aov",
  "Low-AOV customers": "low-aov",
  "Target Product Orders": "target-product-orders",
  "Product adoption": "product-adoption",
  "Product whitespace": "product-whitespace",
  "Repeat product rate": "repeat-product-rate",
  "Revenue Retention": "revenue-retention",
  "Repeat ordering": "repeat-ordering",
  "At-risk customers": "at-risk",
  "Customer churn": "churn",
  "Expansion Revenue": "expansion-revenue",
  "Products per customer": "products-per-customer",
  "Cross-sell candidates": "cross-sell",
  NRR: "nrr",
  "Net Revenue Growth": "net-growth",
  "Growth run-rate": "run-rate",
  "Revenue opportunity": "opportunity",
  "Growth decomposition": "decomposition",
};
export const guideIdFor = (label: string): string => GUIDE_ID[label] ?? "notyet";

/* ───────────── small pictures ───────────── */

/** A row of clinics, filled when the clinic counts (ordered, kept, etc.). */
function Dots({ total, on, onLabel, offLabel }: { total: number; on: number; onLabel: string; offLabel: string }) {
  return (
    <div className="gd-viz">
      <div className="gd-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < on ? "on" : "off"} />
        ))}
      </div>
      <div className="gd-legend">
        <span><i className="on" />{onLabel}</span>
        <span><i className="off" />{offLabel}</span>
      </div>
    </div>
  );
}

/** One column per clinic: the outline is its baseline, the fill is what it did. */
function Cols({ clinics, cap, unit = "K" }: { clinics: Array<{ n: string; base: number; actual: number }>; cap?: boolean; unit?: string }) {
  const max = Math.max(...clinics.map(c => Math.max(c.base, c.actual)), 1);
  return (
    <div className="gd-viz">
      <div className="gd-cols">
        {clinics.map(c => {
          const shown = cap ? Math.min(c.actual, c.base) : c.actual;
          const over = c.actual > c.base;
          return (
            <div className="gd-col" key={c.n}>
              <div className="gd-col-box" style={{ height: `${(c.base / max) * 100}%` }} title={`baseline ${c.base}${unit}`} />
              <div className={`gd-col-fill${over && !cap ? " up" : ""}`} style={{ height: `${(shown / max) * 100}%` }} />
              {cap && over ? <div className="gd-col-extra" style={{ height: `${((c.actual - c.base) / max) * 100}%`, bottom: `${(c.base / max) * 100}%` }} /> : null}
              <span>{c.n}</span>
              <b>{c.actual}{unit}</b>
            </div>
          );
        })}
      </div>
      <div className="gd-legend">
        <span><i className="box" />what it normally does (baseline)</span>
        <span><i className="on" />what it did{cap ? " (counted up to its baseline)" : ""}</span>
        {cap ? <span><i className="hatch" />growth above baseline (not counted)</span> : null}
      </div>
    </div>
  );
}

/** Horizontal bars with a value label. */
function Hbars({ rows }: { rows: Array<{ label: string; value: number; text: string; tone?: "base" | "goal" | "good" | "bad" | "plain"; mark?: number }> }) {
  const max = Math.max(...rows.map(r => Math.max(r.value, r.mark ?? 0)), 1);
  return (
    <div className="gd-viz gd-hbars">
      {rows.map(r => (
        <div className="gd-hbar" key={r.label}>
          <span>{r.label}</span>
          <div>
            <i className={r.tone ?? "plain"} style={{ width: `${(r.value / max) * 100}%` }} />
            {r.mark !== undefined ? <u style={{ left: `${(r.mark / max) * 100}%` }} /> : null}
          </div>
          <b>{r.text}</b>
        </div>
      ))}
    </div>
  );
}

function Chips({ groups }: { groups: Array<{ name: string; items: string[]; note?: string }> }) {
  return (
    <div className="gd-viz gd-chipgroups">
      {groups.map(g => (
        <div key={g.name}>
          <span className="gd-chipname">{g.name}</span>
          {g.items.map(i => <em key={i}>{i}</em>)}
          {g.note ? <small>{g.note}</small> : null}
        </div>
      ))}
    </div>
  );
}

/** A dial in bar form: so far, heading to, and the goal. */
function Meter({ soFar, heading, goal, caption }: { soFar: number; heading: number; goal: number; caption: string }) {
  const hi = Math.max(soFar, heading, goal) * 1.08;
  const pct = (n: number) => `${(n / hi) * 100}%`;
  return (
    <div className="gd-viz">
      <div className="gd-meter">
        <i className="fill" style={{ width: pct(soFar) }} />
        <i className="head" style={{ left: pct(heading) }} />
        <i className="goal" style={{ left: pct(goal) }} />
      </div>
      <div className="gd-legend gd-meterlegend">
        <span><i className="on" />so far {soFar}K</span>
        <span><i className="head" />heading to {heading}K</span>
        <span><i className="goal" />goal {goal}K</span>
      </div>
      <p className="gd-cap">{caption}</p>
    </div>
  );
}

/** Order dates on a line with a "gone quiet" marker. */
function Timeline({ rows }: { rows: Array<{ who: string; orders: number[]; line: number; today: number; note: string }> }) {
  return (
    <div className="gd-viz gd-time">
      {rows.map(r => (
        <div key={r.who}>
          <span>{r.who}</span>
          <div className="gd-track">
            {r.orders.map(o => <i key={o} style={{ left: `${(o / r.today) * 100}%` }} />)}
            <u className="line" style={{ left: `${(Math.max(0, (r.today - r.line)) / r.today) * 100}%` }} />
            <b>today</b>
          </div>
          <small>{r.note}</small>
        </div>
      ))}
      <p className="gd-cap">Blue dots are orders. The red dashed line marks how far back the clinic's limit reaches: an order after the line keeps it active, no order after it means churned.</p>
    </div>
  );
}

/* ───────────── content ───────────── */

type Metric = {
  id: string;
  name: string;
  /** One sentence a non-analyst would say out loud. */
  asks: string;
  see: string;
  how: string[];
  who: string;
  click: string;
  good?: string;
  watch: string[];
  example: { story: string; viz: React.ReactNode };
};

type Section = { id: string; title: string; blurb: string; metrics: Metric[] };

const SECTIONS: Section[] = [
  {
    id: "new",
    title: "New Business",
    blurb: "Revenue from clinics that have no baseline: this year's new clinics, and older clinics that came back after a long quiet spell.",
    metrics: [
      {
        id: "new-revenue",
        name: "New Revenue",
        asks: "How much money are my brand-new clinics (and clinics that came back) bringing in?",
        see: "A dollar amount for the window, then a breakdown: active, reactivated and churned new clinics, plus older clinics that are back. The line above says how many clinics ordered out of the group.",
        how: [
          "Take every clinic whose first order ever was this calendar year. They have no baseline, so all their revenue counts as new business.",
          "Add older clinics that went quiet through the baseline period and have come back (they have no baseline either).",
          "Add up what those clinics spent in this window only. A clinic that has not ordered this window adds $0.",
          "Show it split by status: still ordering (active), came back after a gap (reactivated), gone quiet (churned), and the older clinics that are back.",
        ],
        who: "Everyone in the new group, whether or not they ordered in this window. That is why it reads like \"46 of 288 clinics ordered\": the 288 are in the group, 46 actually spent money in the window.",
        click: "The clinics in the group. The ones that ordered are \"bringing revenue\"; the rest are \"not ordering yet\".",
        good: "There is a goal for new business (a slice of the annual target, shared out by baseline size). The New dial shows how you are tracking against it.",
        watch: [
          "A new clinic counts as new all year, even months after its first order.",
          "Churned new clinics still show their revenue from earlier in the window, so the number can be bigger than this week's orders suggest.",
        ],
        example: {
          story: "October so far: new clinics that are still active brought $40K, ones that came back after a gap $23K, new clinics that have gone quiet $0K (they have not ordered this month), and older clinics that returned $7K. Together $70K, from 46 of the 288 clinics in the group.",
          viz: <Hbars rows={[
            { label: "New, active", value: 40, text: "$40K", tone: "good" },
            { label: "New, reactivated", value: 23, text: "$23K", tone: "good" },
            { label: "New, churned", value: 0, text: "$0K", tone: "plain" },
            { label: "Older clinics back", value: 7, text: "$7K", tone: "base" },
          ]} />,
        },
      },
    ],
  },
  {
    id: "bundle",
    title: "Bundle growth",
    blurb: "Are clinics ordering bigger baskets? Order value is the proxy for clinics buying more per order.",
    metrics: [
      {
        id: "aov",
        name: "AOV (average order value)",
        asks: "When my clinics order, do they spend more or less per order than usual?",
        see: "Dollars per order for this window, with how far it sits above or below the baseline AOV.",
        how: [
          "Add up this window's revenue and count this window's orders for clinics that ordered.",
          "Divide revenue by orders. That is the AOV.",
          "Compare with the baseline AOV: what the same clinics averaged per order in the baseline period.",
        ],
        who: "Clinics that ordered in the window.",
        click: "The ordering clinics, split by whether their own order value is above or below their baseline. The dollars shown are the effect of that price difference on the orders they placed.",
        good: "Above baseline is green. A small gap is normal; AOV moves slowly compared with order counts.",
        watch: [
          "AOV does not grow through the month, so the dial's \"heading\" equals \"so far\".",
          "A green AOV can sit next to a large revenue shortfall: it only tells you about order size, not how many orders there were.",
        ],
        example: {
          story: "Three orders this week: $500, $600 and $700. Revenue $1,800 over 3 orders is $600 per order. Last quarter's usual was $580, so the clinics are $20 above their usual.",
          viz: <Hbars rows={[
            { label: "Baseline AOV", value: 580, text: "$580", tone: "base" },
            { label: "This window", value: 600, text: "$600", tone: "good" },
          ]} />,
        },
      },
      {
        id: "low-aov",
        name: "Low-AOV customers",
        asks: "Which clinics are placing small orders?",
        see: "A count of clinics.",
        how: [
          "Take clinics that ordered in the window.",
          "Work out each one's average order value.",
          "Count those under $400.",
        ],
        who: "Clinics that ordered in the window.",
        click: "A list split into clinics under $400 (where to act) and clinics at or above $400.",
        good: "This is a \"where to act\" cell, not red or green: fewer is better.",
        watch: ["One small order from a clinic that usually orders big can put it on the list for the window."],
        example: {
          story: "Four clinics ordered. Their average orders are $320, $380, $450 and $520. Two are under the $400 line, so the cell shows 2.",
          viz: <Hbars rows={[
            { label: "Clinic A", value: 320, text: "$320", tone: "bad", mark: 400 },
            { label: "Clinic B", value: 380, text: "$380", tone: "bad", mark: 400 },
            { label: "Clinic C", value: 450, text: "$450", tone: "good", mark: 400 },
            { label: "Clinic D", value: 520, text: "$520", tone: "good", mark: 400 },
          ]} />,
        },
      },
    ],
  },
  {
    id: "product",
    title: "Product Growth",
    blurb: "How the book is doing on one product family at a time. Click a family card to switch the whole scorecard to that family; Hormone Zoomer is the default.",
    metrics: [
      {
        id: "target-product-orders",
        name: "Target Product Orders",
        asks: "How many orders of this product did I get, compared with what I would expect?",
        see: "Orders of the chosen family this window, and the number expected.",
        how: [
          "Count this window's orders that contain the chosen family. An order with several families counts once under each.",
          "Expected is what the same clinics ordered of that family in the baseline period, scaled to the window's length.",
        ],
        who: "Clinics that ordered the family in the window.",
        click: "Two lists. Pulling it down: clinics below their expected orders of the product, plus any the status model says have STOPPED or are DECLINING on it. Pushing it up: clinics above expected, or newly on it. Each line shows orders against expected and the status.",
        watch: [
          "A family that launched in the last 60 days has no baseline, so no expectation or goal yet.",
          "A clinic needs 3 or more baseline orders of the product before anything is expected of it; clinics new this year have none.",
          "The STOPPED / DECLINING status looks at the last 28 days against the 90 before, so it does not change with the tab.",
        ],
        example: {
          story: "Hormone Zoomer: 49 orders this month against 79 expected. The cell reads 49 vs 79, a gap of 30 orders.",
          viz: <Hbars rows={[
            { label: "Expected", value: 79, text: "79", tone: "base" },
            { label: "Actual", value: 49, text: "49", tone: "bad" },
          ]} />,
        },
      },
      {
        id: "product-adoption",
        name: "Product adoption",
        asks: "Of my new clinics that are buying Zoomer tests, how many have tried this product?",
        see: "A percentage and \"x of y new clinics ordered the product\".",
        how: [
          "Take this year's new clinics that ordered any Zoomer product in the window (Non Zoomer does not count), plus existing clinics that ordered a product or added this one.",
          "Count the new clinics that ordered the chosen family, plus the existing clinics that added it (status NEW).",
          "Divide. The card shows the split: new a/b · existing added c/d.",
        ],
        who: "New clinics that bought at least one Zoomer product in the window.",
        click: "Two lists. New clinics: who ordered the product and who is ordering without it. Existing clinics: who added the product (status NEW: none in the 90 days before the last 28, fewer than 3 ever before) and who has not.",
        watch: [
          "The percentage blends new and existing clinics. Existing clinics adopt far less often, so it reads lower than the new-clinic rate alone; use the split under the number.",
          "On a short window the new group can be a handful of clinics, so a single clinic moves it a lot.",
        ],
        example: {
          story: "Five new clinics bought Zoomer tests this month. Two of them bought Hormone Zoomer. Adoption is 2 of 5, which is 40%.",
          viz: <Dots total={5} on={2} onLabel="bought Hormone Zoomer" offLabel="bought other Zoomer tests" />,
        },
      },
      {
        id: "product-whitespace",
        name: "Product whitespace",
        asks: "Which clinics should be buying this product but never have?",
        see: "A count.",
        how: [
          "You tick clinics as eligible for the chosen product in the whitespace planner below the scorecard (the ticks are saved for you).",
          "The cell counts the ticked clinics that have never ordered the product.",
        ],
        who: "Only the clinics you ticked.",
        click: "The ticked clinics with no orders of the product, ready to call.",
        good: "A \"where to act\" cell: a high count is your call list.",
        watch: ["It stays at zero until you tick clinics. It does not guess who is eligible."],
        example: {
          story: "You ticked 12 clinics as eligible for Hormone Zoomer. Nine have never ordered it, so the cell shows 9.",
          viz: <Dots total={12} on={9} onLabel="never ordered it (your call list)" offLabel="already order it" />,
        },
      },
      {
        id: "repeat-product-rate",
        name: "Repeat product rate",
        asks: "Once a clinic buys this product, do they buy it again?",
        see: "A percentage and \"x of y clinics ordered it 2+ times\".",
        how: [
          "Take clinics that ordered the chosen family in the window.",
          "Count the ones that ordered it two or more times in the window.",
          "Divide.",
        ],
        who: "Clinics that ordered the family in the window.",
        click: "The clinics split into those that reordered it and those that bought it once.",
        watch: ["A short window gives few chances to reorder, so a week reads lower than a quarter."],
        example: {
          story: "Eight clinics ordered Hormone Zoomer this quarter. Three ordered it twice or more. The rate is 3 of 8, 38%.",
          viz: <Dots total={8} on={3} onLabel="ordered it 2+ times" offLabel="ordered it once" />,
        },
      },
    ],
  },
  {
    id: "retention",
    title: "Retention",
    blurb: "Are clinics that already buy from you staying and ordering regularly? \"Existing\" clinics are the ones with a baseline: not new this year, and they ordered in the baseline period.",
    metrics: [
      {
        id: "revenue-retention",
        name: "Revenue Retention",
        asks: "Of the revenue my existing clinics normally bring, how much did I keep?",
        see: "A percentage, with a note on what it covers.",
        how: [
          "Each existing clinic has a baseline: what it normally brings in that stretch of time.",
          "For each clinic, count what it actually brought, but never more than its baseline (growth does not count here).",
          "Add those up and divide by the total of all baselines.",
        ],
        who: "Existing clinics (not new this year, with a baseline). Clinics that did not order are counted too: they kept $0.",
        click: "Existing clinics split into those that kept their baseline in full and those that fell short. The dollars are what the shortfall clinics lost.",
        good: "The colour compares with what is typical for clinics of that age: older signups keep more than this year's. Short windows are judged more gently because orders are lumpy.",
        watch: [
          "For \"2026 signups\" the cell changes: new clinics have no baseline, so it shows the share of new clinics still ordering.",
          "On a short window a healthy clinic that simply did not order that week counts as a miss.",
        ],
        example: {
          story: "Ten clinics each normally bring $10K, $100K in all. Six brought $10K or more, one $8K, two $5K, two nothing. Counting each only up to $10K gives $68K kept out of $100K: 68%.",
          viz: <Cols cap clinics={[
            { n: "A", base: 10, actual: 14 }, { n: "B", base: 10, actual: 12 }, { n: "C", base: 10, actual: 10 }, { n: "D", base: 10, actual: 10 },
            { n: "E", base: 10, actual: 10 }, { n: "F", base: 10, actual: 8 }, { n: "G", base: 10, actual: 5 }, { n: "H", base: 10, actual: 5 },
            { n: "I", base: 10, actual: 0 }, { n: "J", base: 10, actual: 0 },
          ]} />,
        },
      },
      {
        id: "repeat-ordering",
        name: "Repeat ordering",
        asks: "Of the clinics that ordered, how many ordered more than once?",
        see: "A percentage and \"x of y ordered 2+ times\".",
        how: [
          "Take clinics that ordered in the window.",
          "Count those with two or more orders in the window.",
          "Divide.",
        ],
        who: "Clinics that ordered in the window, including this year's new clinics (who have had less time to reorder).",
        click: "The ordering clinics split into those that reordered and those that ordered once.",
        watch: ["It naturally rises with the window length: weeks read lower than quarters, and the colour allows for that."],
        example: {
          story: "Ten clinics ordered this month. Six placed two or more orders. Repeat ordering is 60%.",
          viz: <Dots total={10} on={6} onLabel="ordered 2+ times" offLabel="ordered once" />,
        },
      },
      {
        id: "at-risk",
        name: "At-risk customers",
        asks: "Which clinics that normally buy from me are starting to slip?",
        see: "A count and the dollars they are short of their baseline.",
        how: [
          "Take existing clinics whose last order was 5 to 44 days ago (past that they count as churned).",
          "Keep the ones the system has flagged as slipping, overdue, at risk or dropping, judged over the whole analysis window.",
          "The dollars are how far below their baseline those clinics are this window.",
        ],
        who: "Existing clinics only. The same clinics are at risk on every tab; only the dollars change with the window.",
        click: "The at-risk clinics, with the rest of the existing clinics for contrast.",
        good: "A \"where to act\" cell: these are your calls.",
        watch: ["A clinic can be at risk and still above its baseline this window; the flag is about its rhythm."],
        example: {
          story: "Twelve existing clinics ordered 5 to 44 days ago. Four of them are flagged as slipping: they usually reorder every two weeks and it has been five. Those four are $9K below their baseline together.",
          viz: <Dots total={12} on={4} onLabel="flagged as slipping" offLabel="on their usual rhythm" />,
        },
      },
      {
        id: "churn",
        name: "Customer churn",
        asks: "How many of my clinics have stopped ordering?",
        see: "A percentage and \"x of y clinics\".",
        how: [
          "A clinic is churned when it has gone quiet longer than its own limit: 45 days for new clinics, and for established clinics at least 45 days and at least three times its usual gap between orders.",
          "Count churned clinics among existing, new and returning clinics, then divide by all of them.",
          "This is judged as of the latest data, so it is the same on every tab.",
        ],
        who: "Existing, new and returning clinics together. Dormant clinics with nothing in either period are left out.",
        click: "Everyone in that group, split into still ordering and churned. The dollars are the baseline revenue those clinics no longer bring.",
        good: "The colour is lower-is-better and depends on clinic age: this year's signups churn far more than older clinics.",
        watch: [
          "A clinic that normally orders every four months is not churned just because it has been quiet for 60 days: its own pattern sets the limit.",
          "A new clinic's revenue stays in New Revenue even after it churns.",
        ],
        example: {
          story: "Monthly buyer A last ordered 50 days ago: her usual gap is 30 days, so her limit is 90 days and she is fine. Clinic B, new this year, ordered once 50 days ago: new clinics have a 45-day limit, so B is churned.",
          viz: <Timeline rows={[
            { who: "Clinic A (orders monthly)", orders: [5, 35, 70, 100], line: 90, today: 150, note: "last order 50 days ago, limit 90 days: still active" },
            { who: "Clinic B (new, 1 order)", orders: [100], line: 45, today: 150, note: "last order 50 days ago, limit 45 days: churned" },
          ]} />,
        },
      },
    ],
  },
  {
    id: "expansion",
    title: "Expansion",
    blurb: "Are existing clinics growing, and are they buying more kinds of product?",
    metrics: [
      {
        id: "expansion-revenue",
        name: "Expansion Revenue",
        asks: "How much extra are my growing clinics bringing above their normal?",
        see: "A dollar amount and how many clinics are growing.",
        how: [
          "For each existing clinic, compare what it brought in the window with its baseline.",
          "Keep only clinics above their baseline and add up how far above they are.",
          "Clinics below baseline are not subtracted here; they are what this number has to make up for.",
        ],
        who: "Existing clinics that sit above their own baseline.",
        click: "The growing clinics, with the shrinking ones as the other side.",
        watch: ["For 2026 signups it reads \"new clinics have no baseline yet\"."],
        example: {
          story: "Clinic A normally brings $10K and brought $14K this month; B normally brings $10K and brought $12K. Expansion revenue is $4K + $2K = $6K.",
          viz: <Cols clinics={[{ n: "A", base: 10, actual: 14 }, { n: "B", base: 10, actual: 12 }, { n: "C", base: 10, actual: 10 }, { n: "D", base: 10, actual: 5 }]} />,
        },
      },
      {
        id: "products-per-customer",
        name: "Products per customer",
        asks: "How many kinds of Zoomer product does a typical clinic buy?",
        see: "A range (the middle half of clinics) rather than one decimal number.",
        how: [
          "Take clinics that bought at least one Zoomer product in the window (Non Zoomer and unmapped tests are not counted as products).",
          "Count how many different product families each one bought in the window.",
          "Show the range covering the middle 50% of those clinics.",
        ],
        who: "Clinics that bought a Zoomer product in the window.",
        click: "Those clinics, split into clinics on two or more families and clinics on only one.",
        watch: ["The clinic card's family list counts every family including Non Zoomer, so a clinic can show a different number there."],
        example: {
          story: "Clinic A bought Gut and Toxin Zoomer (2 families), B bought only Gut Zoomer (1), C bought Gut, Total Tox and Neural (3). The average is 2 families per clinic.",
          viz: <Chips groups={[
            { name: "Clinic A", items: ["Gut", "Toxin"], note: "2 families" },
            { name: "Clinic B", items: ["Gut"], note: "1 family" },
            { name: "Clinic C", items: ["Gut", "Total Tox", "Neural"], note: "3 families" },
          ]} />,
        },
      },
      {
        id: "cross-sell",
        name: "Cross-sell candidates",
        asks: "Which clinics could I sell another product family to, and what is it worth?",
        see: "A count and a rough dollar upside.",
        how: [
          "Take clinics that bought a product this window and have bought two or fewer product families in their whole history.",
          "For each one, look at your other clinics that buy the same families and find the family they most often also buy.",
          "The upside is the clinic's current spend divided by how many families it buys: one more family at today's spend per family.",
        ],
        who: "Active clinics on one or two families lifetime, with a suggested family.",
        click: "The candidates, with the suggested family and the upside.",
        good: "A \"where to act\" cell.",
        watch: ["The upside is a rough ceiling, not a forecast. A clinic that spends heavily on one family gets a large number."],
        example: {
          story: "Clinic X buys Gut Zoomer and Toxin Zoomer. Most of your clinics that buy both also buy Total Tox, so Total Tox is suggested. X spends $20K a month on its two families, $10K each, so the upside shown is $10K.",
          viz: <Chips groups={[
            { name: "Clinic X buys", items: ["Gut", "Toxin"] },
            { name: "Similar clinics also buy", items: ["Total Tox"], note: "suggested, upside $10K" },
          ]} />,
        },
      },
      {
        id: "nrr",
        name: "NRR (net revenue retention)",
        asks: "Counting growth and losses together, are my existing clinics bringing as much as they normally do?",
        see: "A percentage; 100% means exactly their normal.",
        how: [
          "Add up what existing clinics brought in the window.",
          "Divide by the total of their baselines.",
          "Unlike Revenue Retention, growth counts here and cancels out losses.",
        ],
        who: "Existing clinics.",
        click: "The same existing-clinic list, split into above and below baseline.",
        watch: ["Two very different books can both read 100%: steady clinics, or half growing and half shrinking."],
        example: {
          story: "The same ten clinics as the retention example brought $74K against a $100K baseline. NRR is 74%, while Revenue Retention (capped) was 68%: the two growing clinics' extra $6K is the difference.",
          viz: <Hbars rows={[
            { label: "Baseline", value: 100, text: "$100K", tone: "base" },
            { label: "Brought (NRR 74%)", value: 74, text: "$74K", tone: "bad" },
            { label: "Kept, capped (68%)", value: 68, text: "$68K", tone: "bad" },
          ]} />,
        },
      },
    ],
  },
  {
    id: "combined",
    title: "Combined",
    blurb: "The whole book against its goal, and where the gap comes from.",
    metrics: [
      {
        id: "net-growth",
        name: "Net Revenue Growth",
        asks: "Am I ahead of or behind my goal so far?",
        see: "A percentage and the dollar gap to goal.",
        how: [
          "Add up the book's revenue so far in the window.",
          "Add up its goal for the same days: existing clinics' goals plus your share of the new-business goal.",
          "Divide and subtract 1. Minus means behind.",
        ],
        who: "Everyone in the book: existing, new and returning clinics, ordering or not.",
        click: "Every clinic, split into those above and below their goal.",
        watch: ["The goal for a clinic is its baseline times a factor from the annual target; for existing clinics it is never below their baseline."],
        example: {
          story: "So far this month the book has brought $646K against a goal of $766K for the same days. That is 16.5% behind, or $120K short.",
          viz: <Hbars rows={[
            { label: "Goal so far", value: 766, text: "$766K", tone: "goal" },
            { label: "Actual so far", value: 646, text: "$646K", tone: "bad" },
          ]} />,
        },
      },
      {
        id: "run-rate",
        name: "Growth run-rate",
        asks: "At this pace, how much would I bring in over a normal week?",
        see: "Dollars per week and the goal's weekly pace.",
        how: [
          "Take the window's revenue.",
          "Express the window as a share of a normal week using your book's own weekday pattern (a Monday to Friday stretch is about 0.9 of a week, not 5 sevenths).",
          "Divide revenue by that share. Do the same for the goal.",
        ],
        who: "The whole book.",
        click: "The same list as Net Revenue Growth.",
        watch: ["Weekends sell less than weekdays, so a part-week is scaled by what normally happens, not by simply counting days."],
        example: {
          story: "By Wednesday evening you have brought $190K, which in a normal week is about 60% of the week. The run-rate is $190K ÷ 0.6 = $317K a week, against a goal pace of $340K.",
          viz: <Hbars rows={[
            { label: "Goal pace", value: 340, text: "$340K/wk", tone: "goal" },
            { label: "Your pace", value: 317, text: "$317K/wk", tone: "bad" },
          ]} />,
        },
      },
      {
        id: "opportunity",
        name: "Revenue opportunity",
        asks: "How much could I win back if I fixed the obvious problems?",
        see: "A dollar amount: at-risk shortfall plus the order-value gap.",
        how: [
          "At-risk shortfall: how far below baseline the at-risk clinics are.",
          "Order-value gap: for each ordering clinic whose order value is under its own baseline, the gap per order times its orders.",
          "Add them.",
        ],
        who: "At-risk clinics plus clinics ordering below their usual order value (they can overlap).",
        click: "Every clinic in either group.",
        good: "A \"where to act\" cell.",
        watch: ["It is an upper estimate: not every dollar is recoverable."],
        example: {
          story: "At-risk clinics are $12K below baseline and order-value gaps add $8K. The opportunity is $20K.",
          viz: <Hbars rows={[
            { label: "At-risk shortfall", value: 12, text: "$12K", tone: "bad" },
            { label: "Order-value gap", value: 8, text: "$8K", tone: "bad" },
            { label: "Opportunity", value: 20, text: "$20K", tone: "goal" },
          ]} />,
        },
      },
      {
        id: "decomposition",
        name: "Growth decomposition",
        asks: "Is my gap to goal because of fewer orders or smaller orders?",
        see: "Two dollar figures: the effect of order volume and the effect of order value.",
        how: [
          "Volume effect: how many orders fewer (or more) than expected, times the usual order value.",
          "Order-value effect: the change in average order value, times the orders actually placed.",
          "Together they add up to the gap against the existing clinics' goal (the new-business goal is shown as its own line in the Where the gap comes from section).",
        ],
        who: "The whole book.",
        click: "Pick volume or order value to see the clinics pulling each way.",
        watch: ["Clinic lists use each clinic's own numbers, so their totals can differ from the card by a few thousand dollars."],
        example: {
          story: "You placed 90 orders against 100 expected, at a usual $500 each: that is −$5K from volume. Your average order was $540 instead of $500 on 90 orders: that is +$3.6K from order value. Net −$1.4K.",
          viz: <Hbars rows={[
            { label: "Volume", value: 5, text: "−$5.0K", tone: "bad" },
            { label: "Order value", value: 3.6, text: "+$3.6K", tone: "good" },
            { label: "Net gap", value: 1.4, text: "−$1.4K", tone: "bad" },
          ]} />,
        },
      },
    ],
  },
];

const NOT_YET = [
  { name: "Pipeline", why: "needs CRM pipeline data" },
  { name: "Unconverted prospects", why: "needs CRM lead data" },
  { name: "Win rate", why: "needs CRM opportunity data" },
  { name: "Stack penetration and Stack mix", why: "need per-order panel mix" },
];

/** The scorecard grid exactly as it is on the window tabs: one row per pillar, four columns, with a one-line summary per cell. */
type MxCell = { label: string; says: string; kind?: "act" | "na" };
const MATRIX: Array<{ pillar: string; cells: MxCell[] }> = [
  { pillar: "New Business", cells: [
    { label: "New Revenue", says: "Money from new clinics and clinics that came back." },
    { label: "Pipeline", says: "Not in the data yet.", kind: "na" },
    { label: "Unconverted prospects", says: "Not in the data yet.", kind: "na" },
    { label: "Win rate", says: "Not in the data yet.", kind: "na" },
  ] },
  { pillar: "Bundle growth", cells: [
    { label: "AOV", says: "Average spend per order against normal." },
    { label: "Stack penetration", says: "Not in the data yet.", kind: "na" },
    { label: "Low-AOV customers", says: "Clinics placing orders under $400.", kind: "act" },
    { label: "Stack mix", says: "Not in the data yet.", kind: "na" },
  ] },
  { pillar: "Product Growth", cells: [
    { label: "Target Product Orders", says: "Orders of the chosen product against expected." },
    { label: "Product adoption", says: "New clinics that have tried the product." },
    { label: "Product whitespace", says: "Clinics you marked that never bought it.", kind: "act" },
    { label: "Repeat product rate", says: "Clinics that bought the product again." },
  ] },
  { pillar: "Retention", cells: [
    { label: "Revenue Retention", says: "Share of normal revenue kept, growth not counted." },
    { label: "Repeat ordering", says: "Ordering clinics that ordered 2+ times." },
    { label: "At-risk customers", says: "Regular clinics starting to slip.", kind: "act" },
    { label: "Customer churn", says: "Clinics that have been quiet too long." },
  ] },
  { pillar: "Expansion", cells: [
    { label: "Expansion Revenue", says: "Extra revenue from growing clinics." },
    { label: "Products per customer", says: "How many product families a clinic buys." },
    { label: "Cross-sell candidates", says: "Clinics to offer another product.", kind: "act" },
    { label: "NRR", says: "Revenue against normal, growth and losses together." },
  ] },
  { pillar: "Combined", cells: [
    { label: "Net Revenue Growth", says: "Ahead of or behind goal so far." },
    { label: "Growth run-rate", says: "Weekly pace against the goal's pace." },
    { label: "Revenue opportunity", says: "Dollars you could win back.", kind: "act" },
    { label: "Growth decomposition", says: "Gap from fewer orders or smaller orders." },
  ] },
];

function Matrix({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="rv-matrix gd-mx" role="table" aria-label="The scorecard grid; click a cell for its explanation">
      <div className="rv-mx-h">Pillar</div>
      <div className="rv-mx-h">Outcome<span>Did it happen?</span></div>
      <div className="rv-mx-h">Leading indicator<span>Will it happen?</span></div>
      <div className="rv-mx-h">Opportunity<span>Where to act</span></div>
      <div className="rv-mx-h">Diagnostic<span>Why</span></div>
      {MATRIX.map(r => (
        <div className="rv-mx-row" key={r.pillar}>
          <div className="rv-mx-p"><b>{r.pillar}</b></div>
          {r.cells.map(c => (
            <button
              type="button"
              key={c.label}
              className={`rv-mx-c gd-mx-c ${c.kind ?? "plain"}`}
              onClick={() => onPick(c.kind === "na" ? "notyet" : guideIdFor(c.label))}
            >
              <div className="rv-mx-l">{c.label}</div>
              <div className="gd-mx-s">{c.says}</div>
              <div className="gd-mx-go">{c.kind === "na" ? "see why" : "explain ↓"}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ───────────── page ───────────── */

function Card({ m, flash }: { m: Metric; flash: boolean }) {
  return (
    <article className={`gd-card${flash ? " gd-flash" : ""}`} id={`gd-${m.id}`}>
      <header>
        <button type="button" className="gd-back" onClick={() => jump("gd-matrix")}>↑ back to the grid</button>
        <h3>{m.name}</h3>
        <p className="gd-asks">{m.asks}</p>
      </header>
      <div className="gd-card-body">
        <div className="gd-text">
          <h4>What the cell shows</h4>
          <p>{m.see}</p>
          <h4>How it is worked out</h4>
          <ol>{m.how.map(h => <li key={h}>{h}</li>)}</ol>
          <h4>Which clinics count</h4>
          <p>{m.who}</p>
          <h4>Click it to see</h4>
          <p>{m.click}</p>
          {m.good ? (<><h4>Colour and goal</h4><p>{m.good}</p></>) : null}
          <h4>Watch out</h4>
          <ul>{m.watch.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
        <aside className="gd-example">
          <h4>Example</h4>
          <p>{m.example.story}</p>
          {m.example.viz}
        </aside>
      </div>
    </article>
  );
}

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function ScorecardGuide({ onOpen }: { onOpen: Go }) {
  const [flash, setFlash] = useState<string | null>(null);
  const pick = (id: string) => {
    jump(id === "notyet" ? "gd-notyet" : `gd-${id}`);
    setFlash(id);
    window.setTimeout(() => setFlash(f => (f === id ? null : f)), 1800);
  };
  // Arriving from "Explain this metric" on the scorecard: open at that metric.
  useEffect(() => {
    const t = guideNav.target;
    if (!t) return;
    guideNav.target = null;
    const h = window.setTimeout(() => pick(t), 60);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="gd">
      <div className="rv-eyebrow">Scorecard guide</div>
      <h1 className="rv-h1">How to read the scorecard</h1>
      <p className="gd-lead">
        The scorecard sits inside each window tab (This week, This month, This quarter). This page explains every dial and every cell in plain
        English: what it tells you, how it is worked out, which clinics it counts, and a small made-up example. The numbers in the examples are
        invented so the arithmetic is easy to follow; your own numbers are on the window tabs.
      </p>
      <div className="gd-go">
        <button type="button" className="rv-sc-btn" onClick={() => onOpen("week")}>Open this week's scorecard</button>
        <button type="button" className="rv-sc-btn" onClick={() => onOpen("month")}>This month's</button>
        <button type="button" className="rv-sc-btn" onClick={() => onOpen("quarter")}>This quarter's</button>
      </div>

      <section className="gd-sec" id="gd-matrix">
        <h2>The scorecard at a glance</h2>
        <p className="gd-blurb">
          This is the grid exactly as it appears on each window tab, with a line on what each cell says. Click any cell to jump to its full
          explanation, and use "Explain this metric" on the live scorecard to land here.
        </p>
        <Matrix onPick={pick} />
      </section>

      <nav className="gd-toc" aria-label="Other parts of the guide">
        <button type="button" onClick={() => jump("gd-start")}>Start here</button>
        <button type="button" onClick={() => jump("gd-words")}>Key words</button>
        <button type="button" onClick={() => jump("gd-groups")}>Groups of clinics</button>
        <button type="button" onClick={() => jump("gd-dials")}>The five dials</button>
        <button type="button" onClick={() => jump("gd-notyet")}>Not in the data yet</button>
      </nav>

      <section className="gd-sec" id="gd-start">
        <h2>Start here: how the page is laid out</h2>
        <div className="gd-two">
          <div>
            <p>
              The scorecard is a grid of 6 rows by 4 columns. Each row is an area of the business (New Business, Bundle growth, Product Growth,
              Retention, Expansion, Combined) and each cell is one measure. Above the grid are five dials that sum the picture up.
            </p>
            <ul>
              <li><b className="gd-g">Green</b>: on track. <b className="gd-a">Amber</b>: keep an eye on it. <b className="gd-r">Red</b>: behind.</li>
              <li><b>Blue "where to act"</b> cells are lists of clinics to work on, not scores.</li>
              <li>Greyed cells are not in the data yet.</li>
              <li>Everything on a window tab is for that window. A few measures (who is new or existing, who has churned, who is at risk) are judged as of the latest data, so they are the same on every tab.</li>
              <li>Click a cell to see the clinics behind it, with the ones pushing it up and the ones pulling it down.</li>
              <li>The colour allows for clinic age and for the window length: a week is judged more gently than a quarter, and this year's signups are judged against other new clinics.</li>
            </ul>
          </div>
          <Dots total={24} on={17} onLabel="cells that have data" offLabel="not in the data yet" />
        </div>
      </section>

      <section className="gd-sec" id="gd-words">
        <h2>Key words</h2>
        <div className="gd-two">
          <dl className="gd-dl">
            <dt>Baseline</dt>
            <dd>What a clinic normally does: its average over the baseline period (by default the best 91 days of data before the analysis window, which the company can change). Baselines add up across clinics, reps and the company.</dd>
            <dt>Goal</dt>
            <dd>The baseline plus a stretch, built from the company's annual target. Existing clinics' goals are never below their baseline. New business has its own goal, a slice of the target.</dd>
            <dt>Change vs baseline</dt>
            <dd>What actually happened compared with what the clinics normally do: actual minus baseline.</dd>
            <dt>Goal stretch</dt>
            <dd>How far the goal sits above the baseline: the extra you are being asked for.</dd>
            <dt>Shortfall (or gap) vs goal</dt>
            <dd>Change vs baseline plus goal stretch. In other words, actual minus goal.</dd>
            <dt>Heading to</dt>
            <dd>Where the window will end up if the rest of it keeps pace with how it is going against goal.</dd>
          </dl>
          <Hbars rows={[
            { label: "Goal", value: 110, text: "$110K", tone: "goal" },
            { label: "Baseline", value: 100, text: "$100K", tone: "base" },
            { label: "Actual", value: 96, text: "$96K", tone: "bad" },
          ]} />
        </div>
        <p className="gd-cap">Example: baseline $100K, goal $110K (a $10K stretch), actual $96K. Change vs baseline is −$4K, goal stretch is −$10K, so the shortfall is −$14K.</p>
      </section>

      <section className="gd-sec" id="gd-groups">
        <h2>Groups of clinics</h2>
        <div className="gd-two">
          <ul>
            <li><b>New</b>: the clinic's first ever order was this calendar year. New clinics have no baseline; all their revenue counts as gain. They are split into <b>active</b> (still ordering), <b>reactivated</b> (came back after a gap) and <b>churned</b>.</li>
            <li><b>Existing</b>: not new this year, and it ordered in the baseline period (or has its own history to build one from). It is measured against its baseline.</li>
            <li><b>Returning</b>: an older clinic that was silent through the baseline period and is back. No baseline, so it counts with New Business.</li>
            <li><b>Churned</b>: gone quiet longer than its own limit, whichever group it is in.</li>
            <li><b>2026 signups</b> (the clinic-age cut above the scorecard): this year's new clinics. They have no baseline, so retention for them means "share still ordering".</li>
          </ul>
          <Timeline rows={[
            { who: "New clinic", orders: [40, 55, 70], line: 45, today: 100, note: "first order this year: new, no baseline" },
            { who: "Existing clinic", orders: [10, 40, 70, 95], line: 90, today: 100, note: "ordered in the baseline period: existing" },
          ]} />
        </div>
      </section>

      <section className="gd-sec" id="gd-dials">
        <h2>The five dials</h2>
        <div className="gd-two">
          <div>
            <p>
              Each dial shows three things: <b>so far</b> (what has happened), <b>heading to</b> (where it ends up at the current pace) and the
              <b> goal</b> for the whole window. Under the dial, "276 of 797 clinics ordered" means 797 clinics are in the book and carry a goal, and 276 of them
              placed an order in this window.
            </p>
            <ul>
              <li><b>Combined: Revenue</b>: the whole book. The other dials add up to it (New plus Existing is Combined).</li>
              <li><b>New Business: New Revenue</b>: this year's new clinics and returning ones, against the new-business goal.</li>
              <li><b>Bundle growth: AOV</b>: average order value against baseline. It does not grow over the window, so heading equals so far.</li>
              <li><b>Product Growth</b>: orders of the chosen product family against the number expected.</li>
              <li><b>Existing business revenue</b>: the existing clinics against their goal.</li>
            </ul>
          </div>
          <Meter soFar={50} heading={105} goal={120} caption="Half way through the month the book has $50K. At the same pace against goal it heads to $105K, short of the $120K goal." />
        </div>
      </section>

      {SECTIONS.map(s => (
        <section className="gd-sec" id={`gd-sec-${s.id}`} key={s.id}>
          <h2>{s.title}</h2>
          <p className="gd-blurb">{s.blurb}</p>
          {s.metrics.map(m => <Card m={m} key={m.id} flash={flash === m.id} />)}
        </section>
      ))}

      <section className={`gd-sec${flash === "notyet" ? " gd-flash" : ""}`} id="gd-notyet">
        <h2>Not in the data yet</h2>
        <p className="gd-blurb">These cells are greyed out on the scorecard because the data behind them is not available yet. They will light up when it is.</p>
        <ul>
          {NOT_YET.map(n => <li key={n.name}><b>{n.name}</b>: {n.why}</li>)}
        </ul>
      </section>
    </div>
  );
}
