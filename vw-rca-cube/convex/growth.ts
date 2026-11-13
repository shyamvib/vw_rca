/**
 * What the team has saved on the Growth page (2026-11): per opportunity the target rate, owner, status, investment and the team-entered
 * scores, and the priority weights. Opportunities themselves are computed from the data (src/lib/growthOpps.ts); only these edits are stored.
 * Stored as `appMeta` rows ("growth-opp:<id>", "growth-weights"), like the banner dismissals, so there is no schema change.
 * Everyone on a team login can read; editing is for banner admins (see banners.ts).
 */
import { v } from "convex/values";
import { isBannerAdmin } from "./banners";
import { gatedMutation, gatedQuery } from "./gated";

const OPP = "growth-opp:";
const WEIGHTS = "growth-weights";
const NOT_ADMIN = "Only a growth admin can do this.";
const STATUSES = ["Hypothesis", "Quantified", "Validated", "Investment decision", "Approved", "Executing", "Scaling", "Rejected"];

type Saved = { tgt?: number; owner?: string; status?: string; investment?: number; fit?: number; time?: number; feas?: number; note?: string };

const num = (n: unknown, lo: number, hi: number): number | undefined => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined);

/** Keep only known fields, in range. Exported for the tests. */
export function cleanSaved(p: Record<string, unknown>): Saved {
  const out: Saved = {};
  const tgt = num(p.tgt, 0, 100);
  if (tgt !== undefined) out.tgt = tgt;
  const inv = num(p.investment, 0, 1e9);
  if (inv !== undefined) out.investment = inv;
  for (const k of ["fit", "time", "feas"] as const) {
    const s = num(p[k], 1, 5);
    if (s !== undefined) out[k] = Math.round(s);
  }
  if (typeof p.owner === "string") out.owner = p.owner.trim().slice(0, 80);
  if (typeof p.note === "string") out.note = p.note.trim().slice(0, 500);
  if (typeof p.status === "string" && STATUSES.includes(p.status)) out.status = p.status;
  return out;
}

export const state = gatedQuery({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query("appMeta").collect();
    const opps: Record<string, Saved> = {};
    let weights: Record<string, number> | null = null;
    for (const r of rows) {
      try {
        if (r.key.startsWith(OPP)) opps[r.key.slice(OPP.length)] = JSON.parse(r.value) as Saved;
        else if (r.key === WEIGHTS) weights = JSON.parse(r.value) as Record<string, number>;
      } catch {
        /* a row that does not parse is ignored */
      }
    }
    return { canEdit: ctx.viewer.kind === "team" && isBannerAdmin(ctx.viewer.email), opps, weights };
  },
});

export const saveOpp = gatedMutation({
  args: { id: v.string(), patch: v.any() },
  handler: async (ctx, { id, patch }) => {
    if (ctx.viewer.kind !== "team" || !isBannerAdmin(ctx.viewer.email)) throw new Error(NOT_ADMIN);
    if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new Error("Unknown opportunity.");
    const key = OPP + id;
    const row = await ctx.db.query("appMeta").withIndex("by_key", q => q.eq("key", key)).unique();
    const cur: Saved = row ? (JSON.parse(row.value) as Saved) : {};
    const next = { ...cur, ...cleanSaved((patch ?? {}) as Record<string, unknown>) };
    const value = JSON.stringify({ ...next, by: ctx.viewer.email, at: Date.now() });
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("appMeta", { key, value, updatedAt: Date.now() });
  },
});

export const saveWeights = gatedMutation({
  args: { weights: v.object({ rev: v.number(), prob: v.number(), fit: v.number(), time: v.number(), feas: v.number() }) },
  handler: async (ctx, { weights }) => {
    if (ctx.viewer.kind !== "team" || !isBannerAdmin(ctx.viewer.email)) throw new Error(NOT_ADMIN);
    const clean = Object.fromEntries(Object.entries(weights).map(([k, n]) => [k, Math.min(100, Math.max(0, Math.round(n)))]));
    const value = JSON.stringify(clean);
    const row = await ctx.db.query("appMeta").withIndex("by_key", q => q.eq("key", WEIGHTS)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("appMeta", { key: WEIGHTS, value, updatedAt: Date.now() });
  },
});

/**
 * Every rep's "eligible for this family" marks (the Product whitespace indicator is built from them), for the Growth page.
 * Marks are saved per rep in `productEligible`; this reads all of them.
 */
export const eligibleAll = gatedQuery({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query("productEligible").collect();
    return rows.map(r => ({ clinic: r.clinic, family: r.family }));
  },
});
