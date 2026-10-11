/**
 * Shared-password gate for the RCA dashboard.
 *
 * The Space is open to anyone with the link, so this password is the access
 * control: every data function enforces it too (see convex/gated.ts). This
 * query only powers the unlock screen.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { verifyPassword } from "./password";

/** Returns true when the supplied password matches the configured one. */
export const check = query({
  args: { password: v.string() },
  returns: v.boolean(),
  handler: async (_ctx, args) => await verifyPassword(args.password),
});
