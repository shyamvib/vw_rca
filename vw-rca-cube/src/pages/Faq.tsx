import { useMemo, useState } from "react";

/**
 * FAQ drawer (2026-10-20): the dashboard's ideas and metrics in plain words, searchable, opened from the top bar next to
 * the top bar. The Scorecard guide has the per-metric detail with worked examples; this page answers the "what does that
 * word mean" and "why is it like that" questions.
 */
type QA = { q: string; a: string };
type Group = { title: string; items: QA[] };

const GROUPS: Group[] = [
  {
    title: "Getting started",
    items: [
      { q: "What is this dashboard for?", a: "It shows how your book of clinics is doing against its goal, why it is ahead or behind, and which clinics to call to change that. Everything is built from orders, so a clinic only shows up when it has ordered." },
      { q: "What are the tabs?", a: "Today's agenda is your daily to-do list. My week plan turns the actions into a plan for your selling hours. This week, This month and This quarter show the book so far against its goal, each with its own scorecard. Custom uses the dates you pick. The Scorecard guide explains every dial and cell with examples." },
      { q: "What does \"data to Oct 18\" mean?", a: "It is the date of the latest order the dashboard has. Anything ordered after that is not counted yet." },
      { q: "Why do I only see my own clinics?", a: "A rep login is tied to one salesperson, so you see that rep's book and the company leaderboard (names and percentages only). Managers can have a login that opens any rep's book in the Rep view; ask the admin if you need one." },
      { q: "Where do I click to see the clinics behind a number?", a: "Almost any number is clickable: dial counts, scorecard cells, Great job counters, the gap branches and plan actions. You get the list of clinics, and clicking a clinic opens its card." },
    ],
  },
  {
    title: "The big ideas",
    items: [
      { q: "What is the baseline?", a: "What a clinic normally does: its average daily revenue over a reference period, weekday by weekday. By default that period is the best 91-day stretch of the year. Baseline is the yardstick for \"did they keep what they had\"." },
      { q: "What is the goal?", a: "The baseline plus a stretch. The company's yearly target is spread across the year the way each clinic's baseline is spread across weekdays, so a clinic's goal for a window is its baseline times a factor. For existing clinics the goal is never below the baseline." },
      { q: "What is the goal stretch, and the change vs baseline?", a: "The gap to goal has two parts. Change vs baseline is what really moved: actual minus baseline. Goal stretch is the extra the goal asks for above baseline. Add them and you get the shortfall or surplus against goal." },
      { q: "What does \"heading to\" mean?", a: "Where the window will finish if the rest of it goes like the weekdays so far, shaped by each weekday's usual weight (a Monday counts for more than a Sunday). It is a projection, not a promise." },
      { q: "What is the new-business goal?", a: "A separate slice of the yearly target for clinics that start ordering this year. By default it equals last year's revenue from new clinics, phased by last year's monthly shape (the company can set a different number). It is shown as its own line so the existing-clinic goal stays clean." },
      { q: "What is a window?", a: "The period a number covers: this week, this month, this quarter or custom dates. Goals, baselines and \"so far\" figures all follow the window you are in." },
    ],
  },
  {
    title: "Kinds of clinic",
    items: [
      { q: "What is a new clinic?", a: "A clinic whose very first order was this calendar year. It has no baseline (it did not exist in the reference period), so everything it orders counts as new revenue and is measured against the new-business goal." },
      { q: "What is an existing clinic?", a: "A clinic that is not new and ordered in the baseline period (or, for a slow buyer, has its own 12-month history to build a baseline from). Retention, expansion and at-risk are measured on these." },
      { q: "What is a returning (reactivated) clinic?", a: "An older clinic with no baseline that has started ordering again after an unusually long gap. Like a new clinic it has no baseline, so its revenue counts as new business." },
      { q: "When is a clinic churned?", a: "When it has not ordered for 45 days. For an established clinic with a steady rhythm the line is three times its usual gap between orders (never under 45 days), so a clinic that normally orders every 40 days is not called churned at day 50." },
      { q: "What is at risk?", a: "An existing clinic that last ordered 5 to 44 days ago and is flagged as slipping, overdue or similar. It has not churned yet: it is the group to call before it does." },
      { q: "What are the Active tiers (New, Largest 20%, Everyone else)?", a: "A way to split clinics that are still ordering: this year's new clinics, the biggest 20% by baseline, and the rest, so you can see where a shortfall sits." },
    ],
  },
  {
    title: "Reading the scorecard",
    items: [
      { q: "What are the three dials?", a: "Combined is the whole book, New is new and returning clinics against the new-business goal, and Existing is established clinics against their goal. Combined is existing plus new. Each dial shows how many clinics ordered out of how many are in that group." },
      { q: "What do green, amber and red mean?", a: "Green is on track, amber is worth watching, red is behind. Each metric has its own cut-offs; retention and churn targets differ for clinics that signed up before 2025, in 2025 and this year, because younger clinics behave differently." },
      { q: "Why do some cells say \"not in data yet\"?", a: "The numbers they need are not collected yet (for example prospects need CRM lead data, and stack mix needs per-order panel detail)." },
      { q: "What is the difference between Revenue Retention, NRR and Expansion?", a: "Revenue Retention: of the baseline revenue, how much was kept, with each clinic capped at its own baseline (growth does not hide losses). NRR: revenue from existing clinics against their baseline, growth included, so it can go over 100%. Expansion: how far growing clinics sit above their baseline." },
      { q: "What is Repeat ordering?", a: "Of the clinics that ordered in the window, the share that ordered at least twice." },
      { q: "What is Customer churn?", a: "Of clinics that brought revenue (existing, new and returning), the share that is now churned by the rule above. It is as of the latest data, so it reads the same on every tab." },
      { q: "What are AOV and Low-AOV customers?", a: "AOV is the average order value. Low-AOV counts clinics whose average order is under $400, the ones where a bundle suggestion has room to lift the ticket." },
      { q: "What are Net Revenue Growth and Growth run-rate?", a: "Net Revenue Growth: revenue so far against the goal for the same days, as a percentage and a dollar gap. Growth run-rate: the weekly pace the window implies (revenue divided by the window as a share of a normal week), next to the goal's weekly pace." },
      { q: "Why do the lists not always add up to the card number exactly?", a: "The card uses book-level baselines and the lists add up each clinic's own baseline, so a small difference (a few dollars or one clinic) can appear. The lists are the clinic-level truth." },
      { q: "What does \"Explain this metric\" do?", a: "It jumps to that metric's entry in the Scorecard guide, which says what it asks, how it is built, who is counted and shows a worked example." },
    ],
  },
  {
    title: "Products",
    items: [
      { q: "What is a product family?", a: "A group of related tests sold under one name (for example Hormone Zoomer or Gut Zoomer). Click a family card to scope the Product Growth cells to it." },
      { q: "What is Target Product Orders?", a: "Orders of the selected family in the window against what clinics' baselines say to expect. The list splits clinics into those below expected (or stopped / declining on it) and those above (or newly on it)." },
      { q: "What is Product adoption?", a: "Of the clinics ordering in the window, how many ordered the selected family: new clinics that ordered it plus established clinics that added it. The card shows the split between new and existing." },
      { q: "What do NEW, RESTARTED, DECLINING and STOPPED mean?", a: "They compare a clinic's last 28 days with the 90 days before, test by test. NEW: nothing in the prior 90 days and fewer than 3 orders ever before. RESTARTED: nothing in the prior 90 days but 3 or more earlier orders. DECLINING: it ordered at least 6 in the prior period and is now at half the pace or less. STOPPED: it ordered at least 3 before and nothing recently. They look at the last 28 days, not at the tab you are on." },
      { q: "Why does a status not match the tab?", a: "The status is always the last 28 days against the 90 before, wherever you are. The orders-versus-expected numbers follow the tab." },
      { q: "What is product whitespace and cross-sell?", a: "Whitespace: clinics you marked as a fit for a product that never ordered it. Cross-sell: active clinics buying only one or two families, with the family similar clinics buy most." },
    ],
  },
  {
    title: "Today's agenda and My week plan",
    items: [
      { q: "What is Call first?", a: "Existing clinics at least 5 days since their last order that have not churned, ranked by the dollars they are short. It is the most direct list of who to call." },
      { q: "What are the new clinics \"getting to order 4\"?", a: "This year's new clinics due for their next order. Getting a new clinic to its fourth order is when it usually becomes a regular." },
      { q: "What is the Business feed tab?", a: "A short list of questions about your own clinics, each as a card with the answer as one big number and four coloured steps: Fact (what happened), Inference (what it means), Evidence (the numbers behind it) and Action (what to do). Today it answers whether Toxin Zoomer is offsetting the Total Tox decline and which of your clinics are ready for the $400 Foundation Zoomer panel; more questions will be added." },
      { q: "How is the plan built?", a: "Every action gets weekly dollars at stake (its upside), a likelihood and hours. Expected revenue is upside times likelihood; actions are ranked by expected revenue per hour and filled into the hours you can sell, from the top." },
      { q: "Where does the likelihood come from?", a: "From your own record: the share of clinics you touched this quarter that reordered afterwards, blended toward 50% while the sample is small, then adjusted for the kind of action and capped at 90%." },
      { q: "Can I change the hours or the order?", a: "Yes. Type your own hours in the Hours box, click a row to pin it in or out, or click a pillar to see only its actions. Turning off \"Favour pillars that are behind\" ranks on dollars per hour alone." },
      { q: "Why do win-backs count only half?", a: "Most clinics that stopped or went quiet will not come back in full, so half of what they used to bring is a more honest figure to plan around." },
      { q: "What is Touch effort?", a: "Clinics you called or met in the window, how many reordered after, compared with clinics you did not touch, and the lift between them. \"Order within\" limits how soon after a touch an order counts." },
    ],
  },
  {
    title: "Access",
    items: [
      { q: "Who can see what?", a: "Team logins see the whole company. A rep login sees one rep's book. A manager rep-view login opens any rep's Rep view only, with no company dashboard or Business Feed." },
      { q: "How do I get a login or reset a password?", a: "Ask the dashboard admin: logins are created for your work email and tied to your salesperson name. Passwords are one-time starters; use a new one when it is reset." },
    ],
  },
];

export function FaqDrawer({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const t = term.trim().toLowerCase();
  const groups = useMemo(
    () =>
      GROUPS.map(g => ({ ...g, items: g.items.filter(x => !t || x.q.toLowerCase().includes(t) || x.a.toLowerCase().includes(t)) })).filter(g => g.items.length),
    [t],
  );
  return (
    <>
      <div className="rca-drawer-scrim" onClick={onClose} />
      <aside className="rca-drawer rca-faq" role="dialog" aria-label="FAQ">
        <div className="rca-drawer-head">
          <div className="rca-eyebrow">FAQ · the dashboard in plain words</div>
          <button type="button" className="rca-tab" onClick={onClose}>close</button>
        </div>
        <div className="rca-drawer-body">
          <input className="rca-search-input rca-faq-search" type="search" placeholder="Search the FAQ…" aria-label="Search the FAQ" value={term} onChange={e => setTerm(e.target.value)} />
          {!groups.length ? <p className="rca-faq-none">Nothing matches "{term}". The Scorecard guide tab explains every metric in detail.</p> : null}
          {groups.map(g => (
            <section key={g.title} className="rca-faq-group">
              <h3>{g.title}</h3>
              {g.items.map(x => {
                const id = `${g.title}|${x.q}`;
                const isOpen = open === id || !!t;
                return (
                  <div key={id} className={`rca-faq-item${isOpen ? " is-open" : ""}`}>
                    <button type="button" onClick={() => setOpen(o => (o === id ? null : id))} aria-expanded={isOpen}>
                      <span>{x.q}</span><i>{isOpen ? "−" : "+"}</i>
                    </button>
                    {isOpen ? <p>{x.a}</p> : null}
                  </div>
                );
              })}
            </section>
          ))}
          <p className="rca-faq-foot">Every dial and scorecard cell, with worked examples, is in the Scorecard guide tab.</p>
        </div>
      </aside>
    </>
  );
}
