/**
 * Access log for the shared-password dashboard.
 *
 * The Space is open and everyone uses one password, so the email captured at
 * the gate is self-reported: this is an attribution trail ("who says they
 * opened it, when"), not authentication. Only work emails on the allowed
 * Vibrant domains can unlock, and the log itself is behind a second,
 * admin-only password.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  normalizeEmail,
  verifyAdminPassword,
  verifyPassword,
} from "./password";

/** Records one successful unlock. Called by the gate after the password check. */
export const record = mutation({
  args: { password: v.string(), email: v.string(), agent: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await verifyPassword(args.password))) return false;
    const email = normalizeEmail(args.email);
    if (!email) return false;
    await ctx.db.insert("accessLog", {
      email,
      at: Date.now(),
      agent: args.agent?.slice(0, 200),
    });
    return true;
  },
});

/** True when the supplied admin password opens the access log. */
export const checkAdmin = query({
  args: { adminPassword: v.string() },
  returns: v.boolean(),
  handler: async (_ctx, args) => await verifyAdminPassword(args.adminPassword),
});

/**
 * Recent unlocks plus a per-person roll-up. Requires the admin password.
 */
export const log = query({
  args: { adminPassword: v.string(), limit: v.optional(v.number()) },
  returns: v.union(v.null(), v.object({
    recent: v.array(
      v.object({ email: v.string(), at: v.number(), agent: v.optional(v.string()) }),
    ),
    people: v.array(
      v.object({ email: v.string(), count: v.number(), last: v.number() }),
    ),
    total: v.number(),
  })),
  handler: async (ctx, args) => {
    if (!(await verifyAdminPassword(args.adminPassword))) return null;
    const rows = await ctx.db
      .query("accessLog")
      .withIndex("by_at")
      .order("desc")
      .take(1000);
    const byEmail = new Map<string, { count: number; last: number }>();
    for (const r of rows) {
      const cur = byEmail.get(r.email);
      if (cur) {
        cur.count += 1;
        cur.last = Math.max(cur.last, r.at);
      } else {
        byEmail.set(r.email, { count: 1, last: r.at });
      }
    }
    return {
      recent: rows
        .slice(0, args.limit ?? 50)
        .map(r => ({ email: r.email, at: r.at, agent: r.agent })),
      people: [...byEmail.entries()]
        .map(([email, v2]) => ({ email, count: v2.count, last: v2.last }))
        .sort((a, b) => b.last - a.last),
      total: rows.length,
    };
  },
});
