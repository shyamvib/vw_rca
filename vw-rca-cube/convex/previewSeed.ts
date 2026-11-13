/**
 * Seeds a new preview deployment (2026-11). A preview backend starts empty, so the page has no address for the analytics engine
 * ("The analytics service is not reachable"). Convex runs this once after it deploys a preview, when the Vercel build command passes
 * `--preview-run previewSeed:seed` to `npx convex deploy`. It is never run on production.
 *
 * It reads the engine's address from the PREVIEW_ENGINE_URL environment variable of the preview deployment (set it once as a default
 * environment variable for previews in the Convex project settings) and stores it as the `serviceUrl` row the page reads.
 */
import { internalMutation } from "./_generated/server";

export const seed = internalMutation({
  args: {},
  handler: async ctx => {
    // Read through globalThis: the front end's TypeScript build also checks this folder and has no Node types.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const raw = (env?.PREVIEW_ENGINE_URL ?? "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^\s]+$/.test(raw)) return { seeded: false as const, reason: "PREVIEW_ENGINE_URL is not set to an https address" };
    const row = await ctx.db.query("appMeta").withIndex("by_key", q => q.eq("key", "serviceUrl")).unique();
    if (row) await ctx.db.patch(row._id, { value: raw, updatedAt: Date.now() });
    else await ctx.db.insert("appMeta", { key: "serviceUrl", value: raw, updatedAt: Date.now() });
    return { seeded: true as const };
  },
});
