/**
 * Row helpers shared by the refresh and drill code. Data now comes from Cube
 * (see ./cube.ts); rows are re-keyed there to these legacy Power BI column
 * names so the aggregation code reads them unchanged. File name kept to keep
 * the diff small.
 */

export const TABLE = "customer_rfm_segmented_orders";

export function num(row: Record<string, unknown>, key: string): number {
  const v = row[`[${key}]`];
  return typeof v === "number" ? v : 0;
}

export function dateOf(row: Record<string, unknown>, col: string): string {
  return String(row[`${TABLE}[${col}]`] ?? "").slice(0, 10);
}

/** Legacy key for the order's product-family combination (rfm_orders.product_family). */
export const FAMILY_COL = "fact_order_tests_enriched[product_family]";

/**
 * Product families arrive as combination strings ("Gut Zoomer, Hormone Zoomer")
 * because an order can carry several test families. We report single families:
 * the order counts once under each family it contains, and its revenue is split
 * pro-rata across them (the line-level table carries no per-test price).
 */
export function splitFamilies(raw: string): string[] {
  const parts = raw
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.length ? out : ["Unmapped"];
}

/** Reads the product family label off a row, normalising blanks. */
export function familyOf(row: Record<string, unknown>): string {
  const raw = String(row[FAMILY_COL] ?? "").trim();
  if (!raw || raw === "null") return "Unmapped";
  return raw;
}
