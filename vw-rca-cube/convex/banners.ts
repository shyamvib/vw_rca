/**
 * Announcement banners an admin has dismissed for everyone (2026-11). A banner on the rep view (see src/lib/announcements.ts) keeps showing for
 * every rep until an admin dismisses it here; the dismissal is shared, not saved per browser. Admin = a team login (the shared dashboard
 * password): rep, manager and account manager logins can read the list, so they know what to hide, but cannot change it.
 *
 * Stored as rows of `appMeta` (key "banner-dismissed:<id>"), the table that already holds small shared settings, so no schema change.
 */
import { v } from "convex/values";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { gatedMutation, scopedQuery } from "./gated";

const PREFIX = "banner-dismissed:";

/** The ids of the banners that are dismissed. */
export async function listDismissed(db: DatabaseReader): Promise<string[]> {
  const rows = await db.query("appMeta").collect();
  return rows.filter(r => r.key.startsWith(PREFIX)).map(r => r.key.slice(PREFIX.length));
}

/** Dismiss a banner for everyone (a repeat changes nothing). `by` is who did it, for the record. */
export async function dismissBanner(db: DatabaseWriter, bannerId: string, by?: string): Promise<void> {
  const key = PREFIX + bannerId;
  const value = JSON.stringify({ by: by ?? null, at: Date.now() });
  const row = await db.query("appMeta").withIndex("by_key", q => q.eq("key", key)).unique();
  if (row) await db.patch(row._id, { value, updatedAt: Date.now() });
  else await db.insert("appMeta", { key, value, updatedAt: Date.now() });
}

/** Show a dismissed banner again. */
export async function restoreBanner(db: DatabaseWriter, bannerId: string): Promise<void> {
  const row = await db.query("appMeta").withIndex("by_key", q => q.eq("key", PREFIX + bannerId)).unique();
  if (row) await db.delete(row._id);
}

/** Readable by every login: a rep needs it to know whether to show the banner. */
export const dismissed = scopedQuery({
  args: {},
  handler: async ctx => await listDismissed(ctx.db),
});

/** Team logins only (rep tokens are refused by the access wrapper). */
export const dismiss = gatedMutation({
  args: { bannerId: v.string() },
  handler: async (ctx, { bannerId }) => await dismissBanner(ctx.db, bannerId, ctx.viewer.email),
});

export const restore = gatedMutation({
  args: { bannerId: v.string() },
  handler: async (ctx, { bannerId }) => await restoreBanner(ctx.db, bannerId),
});
