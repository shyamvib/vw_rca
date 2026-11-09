/**
 * Foundation Zoomer (FZ) numbers for the rep view's Opportunity agenda and My week plan (2026-11): the agenda's Cross-sell and
 * Whitespace cards are FZ-only, and the plan ranks the same two lists, so the card and the plan row always agree.
 *
 * Pure functions over the shapes the engine already returns (analytics/fzTargets.ts, the scorecard's product-growth data), so they can be
 * tested without the page.
 */

/** Foundation Zoomer, however the family is spelled in the data. */
export const isFzFamily = (f?: string) => /foundation\s*zoomer/i.test(f ?? "");

/** The family name the data uses for Foundation Zoomer (first match), or undefined when no clinic has it. */
export const findFzFamily = (families: Iterable<string>): string | undefined => [...families].find(isFzFamily);

type FzLineLike = { product: string; open: number; likely: number };
export type FzClinicLike = { clinic: string; name: string; likely: number; open: number; products: FzLineLike[] };
export type FzAgendaInput = {
  ready: true;
  totals: { clinics: number; likely: number; low: number; high: number };
  clinics: FzClinicLike[];
};

/** The Zoomer to pitch at a clinic: the one with the most open FZ results (ties: the bigger likely revenue). */
export function suggestOf(c: Pick<FzClinicLike, "products">): string | null {
  const open = c.products.filter(p => p.open > 0);
  if (!open.length) return null;
  return [...open].sort((a, b) => b.open - a.open || b.likely - a.likely || a.product.localeCompare(b.product))[0].product;
}

/**
 * The Cross-sell card: clinics whose FZ results point to a Zoomer they have not ordered, biggest likely revenue first.
 * `up` is the likely revenue: what the open results bring at the share of similar results that already turned into an order.
 * `low` / `high` are the bounds: every open result ordering the Baseline (lower price) / the Zoomer (upper price).
 */
export function fzCrossSell(fz: FzAgendaInput) {
  const sorted = [...fz.clinics].sort((a, b) => b.likely - a.likely || a.name.localeCompare(b.name));
  return {
    n: fz.totals.clinics,
    up: fz.totals.likely,
    low: fz.totals.low,
    high: fz.totals.high,
    ids: sorted.map(c => c.clinic),
    names: sorted.slice(0, 3).map(c => {
      const s = suggestOf(c);
      return { clinic: c.clinic, name: s ? `${c.name} → ${s}` : c.name, v: c.likely };
    }),
  };
}

/** The Whitespace card: clinics the rep marked eligible for Foundation Zoomer that have never ordered it. */
export function fzWhitespace(
  elig: Array<{ clinic: string; family: string }>,
  clinics: Array<{ clinic: string; name?: string; life: Record<string, number> }>,
) {
  const byId = new Map(clinics.map(c => [c.clinic, c]));
  const ids = [...new Set(elig.filter(e => isFzFamily(e.family) && !((byId.get(e.clinic)?.life[e.family] ?? 0) > 0)).map(e => e.clinic))];
  return { ids, names: ids.slice(0, 3).map(id => ({ clinic: id, name: byId.get(id)?.name ?? id, v: 0 })) };
}

/**
 * What the Overview opens when its Cross-sell candidates cell is clicked while Foundation Zoomer is the selected family: the FZ clinic list
 * (the same one the rep view opens), over the clinics the FZ data returns for the Overview's scope (the whole company, or one team lead's
 * team). Null for any other cell or family, or while there are no FZ clinics, so the caller falls back to the ordinary list.
 */
export function fzListSel(
  label: string,
  family: string,
  scoped: boolean,
  fz: { ready: boolean; clinics?: Array<{ clinic: string }> } | undefined,
) {
  if (label !== "Cross-sell candidates" || !scoped || !isFzFamily(family) || !fz?.ready || !fz.clinics?.length) return null;
  return { key: "Cross-sell candidates", label: "FZ score targets", ids: fz.clinics.map(c => c.clinic), tone: "act" as const, fz: true as const };
}
