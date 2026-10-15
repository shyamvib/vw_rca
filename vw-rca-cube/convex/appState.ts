/**
 * App state the analytics service needs a copy of (Phase 3).
 *
 * The analytics service serves the dashboard from a snapshot; these few small
 * tables are *user-edited* app state that also feed the maths (window, annual
 * target, eligibility flags, plans), so the service and the snapshot builder
 * pull them from here. Internal only: called with the deployment admin key.
 */
import { internalQuery } from "./_generated/server";

export const snapshotSeed = internalQuery({
  args: {},
  handler: async ctx => {
    const config = await ctx.db.query("config").collect();
    const productEligible = await ctx.db.query("productEligible").collect();
    const clinicPlan = await ctx.db.query("clinicPlan").collect();
    return { config, productEligible, clinicPlan };
  },
});
