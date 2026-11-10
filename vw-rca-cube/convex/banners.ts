/**
 * Announcement banners an admin has dismissed for everyone (2026-11). A banner on the rep view (see src/lib/announcements.ts) keeps showing for
 * every rep until an admin dismisses it here; the dismissal is shared, not saved per browser. Admin = an email in BANNER_ADMINS signed in
 * on the team login; everyone else can read the list, so they know what to hide, but cannot change it.
 *
 * Stored as rows of `appMeta` (key "banner-dismissed:<id>"), the table that already holds small shared settings, so no schema change.
 */
import { v } from "convex/values";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { gatedMutation, scopedQuery } from "./gated";

/** Who may dismiss or restore a banner for everyone (lower case). Add an email here to give someone the button. */
export const BANNER_ADMINS = ["shyam.n@vibrant-wellness.com"];
export const isBannerAdmin = (email?: string | null): boolean => !!email && BANNER_ADMINS.includes(email.trim().toLowerCase());
const NOT_ADMIN = "Only a banner admin can do this.";

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

/** Does the person asking get the Dismiss / Show it again buttons? The pages ask this, so the list lives only here. */
export const canManage = scopedQuery({
  args: {},
  handler: async ctx => ctx.viewer.kind === "team" && isBannerAdmin(ctx.viewer.email),
});

/** Banner admins only (rep tokens are refused by the access wrapper, other team logins here). */
export const dismiss = gatedMutation({
  args: { bannerId: v.string() },
  handler: async (ctx, { bannerId }) => {
    if (ctx.viewer.kind !== "team" || !isBannerAdmin(ctx.viewer.email)) throw new Error(NOT_ADMIN);
    await dismissBanner(ctx.db, bannerId, ctx.viewer.email);
  },
});

export const restore = gatedMutation({
  args: { bannerId: v.string() },
  handler: async (ctx, { bannerId }) => {
    if (ctx.viewer.kind !== "team" || !isBannerAdmin(ctx.viewer.email)) throw new Error(NOT_ADMIN);
    await restoreBanner(ctx.db, bannerId);
  },
});
