/**
 * The one number a Business Feed card leads with (2026-10-20 redesign). The cards are generated as sentences, so the
 * number is read back out of the fact text: a signed dollar figure when the sentence has one, else a count or a
 * percentage. Display only; nothing is stored, and a card with no usable number simply shows no headline.
 */
const CAPTION: Record<string, string> = {
  Overview: "vs run rate", Momentum: "gap, last 14 days", Calendar: "worst single day", "Call List": "short of expected",
  "Silent Clinics": "from silent clinics", AOV: "ticket effect", Growth: "ahead of baseline", "Health Flags": "net impact",
  "Target List": "at stake", Intervention: "at risk per month", "Sales Coverage": "of the shortfall", Portfolio: "behind stopped lines",
  "Family Mix": "vs baseline", Substitution: "net of substitution", Geography: "this month", Channel: "revenue gap", "Bundle Mix": "of revenue",
};
const MONEY = /[+\-−]\$\d[\d,.]*[KMB]?/g;
const norm = (s: string) => s.replace("-", "−");

export function insightHeadline(fact: string, topic: string): { value: string; caption: string } | null {
  const text = fact.replace(/\d{4}-\d{2}(-\d{2})?/g, "");
  const signed = text.match(MONEY) ?? [];
  const cap = CAPTION[topic] ?? "vs baseline";
  if (topic === "Substitution") {
    const net = text.match(/Net\s+([+\-−]\$\d[\d,.]*[KMB]?)/);
    if (net) return { value: norm(net[1]), caption: cap };
  }
  if (topic === "Intervention") {
    const about = text.match(/About\s+(\$\d[\d,.]*[KMB]?)/);
    if (about) return { value: about[1], caption: cap };
  }
  const lastSigned = signed[signed.length - 1];
  if (topic === "Geography" && lastSigned) return { value: norm(lastSigned), caption: cap };
  if (topic === "Bundle Mix") {
    const pct = text.match(/\b\d+(\.\d+)?%/);
    if (pct) return { value: pct[0], caption: cap };
  }
  if (signed[0]) return { value: norm(signed[0]), caption: /\bVA\b/.test(text) ? "combined VA revenue" : cap };
  const count = text.match(/\b(\d[\d,]*)\s+((?:[A-Za-z-]+\s?){1,2})/);
  if (count?.[1] && count[2]) return { value: count[1], caption: count[2].trim() };
  return null;
}
