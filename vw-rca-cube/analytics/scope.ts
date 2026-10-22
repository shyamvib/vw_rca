/**
 * Rep view scope (2026-10-21). Rep view calls carry `sales`: a salesperson's name, or "team:<lead name>" for a VP of sales
 * looking at their whole team (the lead and every rep under them) as one combined book. Access is unchanged: a rep login is
 * pinned to its own name by the access wrapper (gated.ts), so only team and manager logins can pass a team scope.
 */
import type { QueryCtx } from "./_generated/server";

export const TEAM_PREFIX = "team:";
export const isTeamScope = (s?: string | null): s is string => !!s && s.startsWith(TEAM_PREFIX);
export const teamOf = (s: string) => s.slice(TEAM_PREFIX.length).trim();

/** Does a row with this `sales` belong to the scope? One rep: the name matches. A team: the rep sits under the lead. */
export async function scopeMatcher(ctx: QueryCtx, gen: number, scope: string): Promise<(sales?: string | null) => boolean> {
  if (!isTeamScope(scope)) return s => s === scope;
  const lead = teamOf(scope);
  const meta = await ctx.db.query("clinicMeta").withIndex("by_gen_lead", q => q.eq("gen", gen).eq("teamLead", lead)).collect();
  const reps = new Set(meta.map(m => m.sales ?? "—"));
  return s => reps.has(s ?? "—");
}

/** The names behind a scope (one rep, or every rep under the lead). */
export async function repsInScope(ctx: QueryCtx, gen: number, scope: string): Promise<string[]> {
  if (!isTeamScope(scope)) return [scope];
  const lead = teamOf(scope);
  const meta = await ctx.db.query("clinicMeta").withIndex("by_gen_lead", q => q.eq("gen", gen).eq("teamLead", lead)).collect();
  return [...new Set(meta.map(m => m.sales ?? "—").filter(s => s !== "—"))];
}
