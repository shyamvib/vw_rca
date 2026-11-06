/**
 * FZ-score cross-sell targets (Phase 2 of cube/FZ_SCORES.md).
 *
 * build    — snapshot build step (engine/builder.ts, daily): pulls every `fz_scores` row from Cube (served by the
 *            `fz_rows` rollup) into the `fzScores` table. The patient id is replaced by a one-way hash at once: the
 *            snapshot never holds the raw id, and the hash is only used to find each patient's latest test.
 * clinics  — Rep view: for a rep / team and a window, the clinics whose FZ results point to a Zoomer they haven't
 *            ordered: FZ results flagged / followed up / open per Zoomer, cross-sell pairs and revenue. Clinic level
 *            only: no patient id or hash is ever returned.
 * Not gen-scoped: replaced as a whole on each build (like familyStops).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { loadCfg } from "./config";
import { load } from "./cube";
import { periodRange } from "./families";
import { conversionRates, fzTargets, type FzRow } from "./fzTargets";
import { scopedQuery } from "./gated";
import { isCompanyLead, isTeamScope, teamOf } from "./scope";

const rowSpec = {
  area: v.string(),
  product: v.string(),
  priceLow: v.number(),
  priceHigh: v.number(),
  clinic: v.string(),
  day: v.string(),
  resultDay: v.string(),
  sample: v.string(),
  pt: v.string(),
  score: v.number(),
  band: v.string(),
  trend: v.string(),
  reason: v.union(v.string(), v.null()),
  isTarget: v.boolean(),
  targetsOnSample: v.number(),
  isTop20: v.boolean(),
  hadBefore: v.boolean(),
  withFz: v.optional(v.boolean()),
  orderedAfter: v.boolean(),
};

const C = "fz_scores";
const m = (x: string) => `${C}.${x}`;
// Every dimension is in the fz_rows rollup, so this pull never touches BigQuery.
const DIMS = ["sample_id", "area", "product", "price_low", "price_high", "patient_id", "clinic_id", "score", "band", "trend",
  "target_reason", "is_target", "targets_on_sample", "is_top20_ytd", "had_product_before", "ordered_product_after"];

const bool = (x: unknown) => x === true || x === "true";

/** One-way, unsalted-but-prefixed SHA-256 of the patient id, first 16 hex chars. */
async function hashPatient(id: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fz-patient:${id}`));
  return [...new Uint8Array(d).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export const replaceAll = internalMutation({
  args: { rows: v.array(v.object(rowSpec)), clear: v.boolean() },
  handler: async (ctx, { rows, clear }) => {
    if (clear) for (const r of await ctx.db.query("fzScores").collect()) await ctx.db.delete(r._id);
    for (const r of rows) await ctx.db.insert("fzScores", r);
  },
});

export const build = internalAction({
  args: {},
  handler: async ctx => {
    const pull = (dims: string[]) =>
      load({ dimensions: dims.map(m), measures: [m("samples")], timeDimensions: [{ dimension: m("order_date"), granularity: "day" }] });
    // Dimensions added in later cube versions. If the Cube serving us doesn't have one yet, drop it and carry on:
    // result_day falls back to the order day, ordered_with_fz to false.
    const optional = ["result_day", "ordered_with_fz"];
    let raw: Awaited<ReturnType<typeof pull>> | null = null;
    while (!raw) {
      try {
        raw = await pull([...DIMS, ...optional]);
      } catch (e) {
        const missing = optional.find(o => String(e).includes(o));
        if (!missing) throw e;
        optional.splice(optional.indexOf(missing), 1);
      }
    }
    const withResult = optional.includes("result_day");
    const withFzDim = optional.includes("ordered_with_fz");
    const rows = await Promise.all(raw.map(async r => ({
      area: String(r[m("area")]),
      product: String(r[m("product")]),
      priceLow: Number(r[m("price_low")]),
      priceHigh: Number(r[m("price_high")]),
      clinic: String(r[m("clinic_id")]),
      day: String(r[m("order_date.day")]).slice(0, 10),
      resultDay: String((withResult ? r[m("result_day")] : null) ?? r[m("order_date.day")]).slice(0, 10),
      sample: String(r[m("sample_id")]),
      pt: await hashPatient(String(r[m("patient_id")])),
      score: Number(r[m("score")]),
      band: String(r[m("band")]),
      trend: String(r[m("trend")]),
      reason: (r[m("target_reason")] as string | null) ?? null,
      isTarget: bool(r[m("is_target")]),
      targetsOnSample: Number(r[m("targets_on_sample")]),
      isTop20: bool(r[m("is_top20_ytd")]),
      hadBefore: bool(r[m("had_product_before")]),
      withFz: withFzDim ? bool(r[m("ordered_with_fz")]) : false,
      orderedAfter: bool(r[m("ordered_product_after")]),
    })));
    for (let i = 0; i < Math.max(rows.length, 1); i += 1000)
      await ctx.runMutation(internal.fzScores.replaceAll, { rows: rows.slice(i, i + 1000), clear: i === 0 });
    return { rows: rows.length, clinics: new Set(rows.map(r => r.clinic)).size, window: withResult ? "result date" : "order date (cube has no result_day yet)",
      sameOrderRule: withFzDim ? "on" : "off (cube has no ordered_with_fz yet)" };
  },
});

export const clinics = scopedQuery({
  args: { periodId: v.string(), sales: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.sales) return { ready: false as const, reason: "pick-rep" };
    const cfg = await loadCfg(ctx);
    if (!cfg) return { ready: false as const, reason: "no-data" };
    const all = (await ctx.db.query("fzScores").collect()) as unknown as FzRow[];
    if (!all.length) return { ready: false as const, reason: "no-score-data" };
    // "all" = every FZ result on file (FZ results start before the dashboard's analysis window).
    const pr = args.periodId === "all" ? null : periodRange(args.periodId, cfg.currentStart, cfg.currentEnd);
    if (pr && !pr.start) return { ready: false as const, reason: "empty-window" };
    const win = pr ? { start: pr.start, end: pr.end } : null;

    // Same scope as repView.book: a rep's clinics, a team lead's, or the whole company.
    const gen = cfg.gen ?? 0;
    const meta = isTeamScope(args.sales) && isCompanyLead(teamOf(args.sales))
      ? await ctx.db.query("clinicMeta").withIndex("by_gen", q => q.eq("gen", gen)).collect()
      : isTeamScope(args.sales)
      ? await ctx.db.query("clinicMeta").withIndex("by_gen_lead", q => q.eq("gen", gen).eq("teamLead", teamOf(args.sales!))).collect()
      : await ctx.db.query("clinicMeta").withIndex("by_gen_sales", q => q.eq("gen", gen).eq("sales", args.sales!)).collect();
    const byClinic = new Map(meta.map(c => [c.clinic, c]));

    const rates = conversionRates(all);
    const res = fzTargets(all, win, new Set(byClinic.keys()), rates);
    // Company-wide follow-up in the same window, so a rep can compare their book with everyone's.
    const co = fzTargets(all, win, null, rates).totals;
    // Latest result on file: tells the rep how fresh the scores are.
    let scoresThrough = "";
    let scoresFrom = "9999";
    for (const r of all) {
      if (r.resultDay > scoresThrough) scoresThrough = r.resultDay;
      if (r.resultDay < scoresFrom) scoresFrom = r.resultDay;
    }
    return {
      ready: true as const,
      window: win ?? { start: scoresFrom, end: scoresThrough },
      allOnFile: !win,
      scoresThrough,
      rates,
      totals: res.totals,
      company: { flagged: co.flagged, followed: co.followed },
      products: res.products,
      clinics: res.clinics.map(c => {
        const meta = byClinic.get(c.clinic);
        return { ...c, name: meta?.name ?? `Clinic ${c.clinic}`, state: meta?.state ?? "", sales: meta?.sales ?? "" };
      }),
    };
  },
});
