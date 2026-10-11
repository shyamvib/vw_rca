/**
 * Password-gated Convex function builders.
 *
 * The Space itself is open (no Viktor sign-in), so the credential sent as the
 * `password` argument IS the access control — which means it has to be
 * enforced on every data function, not just on the gate screen.
 *
 * Two kinds of credential arrive in `password`:
 *   - the shared team password → full dashboard ("team" viewer);
 *   - a rep session token (`rs:…`, see convex/repAuth.ts) → "rep" viewer,
 *     locked to one salesperson's book.
 *
 * Two families of builders:
 *   - `gated*`  — team only. Rep tokens are rejected. Use for anything that
 *     is company-wide or changes global state (config, refresh, feed, …).
 *   - `scoped*` — team or rep. For a rep, `args.sales` is force-set to the
 *     rep's name and `args.teamLead` cleared, so a handler that already
 *     supports the `sales` filter is automatically locked down. `ctx.viewer`
 *     tells handlers who is asking (actions use it to post-filter rows).
 */
import {
  customAction,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { teamUserEmail, verifyPassword } from "./password";
import { REP_TOKEN_PREFIX, resolveRepToken } from "./repAuth";

export type Viewer =
  | { kind: "team"; email?: string }
  | { kind: "rep"; rep: string; email: string };

const passwordArgs = { password: v.string() };

const DENIED = "Not authorized — wrong dashboard password.";
const REP_DENIED = "Not available for rep logins.";

async function resolveViewer(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  credential: string,
): Promise<Viewer | null> {
  if (credential.startsWith(REP_TOKEN_PREFIX)) {
    const session =
      "db" in ctx
        ? await resolveRepToken(ctx as QueryCtx, credential)
        : await (ctx as ActionCtx).runQuery(internal.repAuth.resolveSession, {
            credential,
          });
    return session ? { kind: "rep", ...session } : null;
  }
  if (!(await verifyPassword(credential))) return null;
  const email = teamUserEmail(credential);
  return email ? { kind: "team", email } : { kind: "team" };
}

type TeamResult = { ctx: { viewer: Viewer }; args: Record<never, never> };
type ScopedResult = {
  ctx: { viewer: Viewer };
  args: { sales?: string; teamLead?: string };
};

/** Team-only check (legacy behaviour). */
async function checkTeam(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  args: { password: string },
): Promise<TeamResult> {
  const viewer = await resolveViewer(ctx, args.password);
  if (!viewer) throw new Error(DENIED);
  if (viewer.kind === "rep") throw new Error(REP_DENIED);
  return { ctx: { viewer }, args: {} };
}

/** Team or rep; reps get `sales` pinned to their own name. */
async function checkScoped(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  args: { password: string },
): Promise<ScopedResult> {
  const viewer = await resolveViewer(ctx, args.password);
  if (!viewer) throw new Error(DENIED);
  if (viewer.kind === "rep") {
    return {
      ctx: { viewer },
      args: { sales: viewer.rep, teamLead: undefined },
    };
  }
  return { ctx: { viewer }, args: {} };
}

export const gatedQuery = customQuery(query, {
  args: passwordArgs,
  input: async (ctx, args) => await checkTeam(ctx, args),
});

export const gatedMutation = customMutation(mutation, {
  args: passwordArgs,
  input: async (ctx, args) => await checkTeam(ctx, args),
});

export const gatedAction = customAction(action, {
  args: passwordArgs,
  input: async (ctx, args) => await checkTeam(ctx, args),
});

export const scopedQuery = customQuery(query, {
  args: passwordArgs,
  input: async (ctx, args) => await checkScoped(ctx, args),
});

export const scopedMutation = customMutation(mutation, {
  args: passwordArgs,
  input: async (ctx, args) => await checkScoped(ctx, args),
});

export const scopedAction = customAction(action, {
  args: passwordArgs,
  input: async (ctx, args) => await checkScoped(ctx, args),
});

/** Rows carrying a `sales` field, cut down to the rep's own when asked by a rep. */
export function onlyMine<T extends { sales?: string }>(
  viewer: Viewer,
  rows: T[],
): T[] {
  return viewer.kind === "rep" ? rows.filter(r => r.sales === viewer.rep) : rows;
}
