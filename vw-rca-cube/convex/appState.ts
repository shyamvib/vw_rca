/**
 * App state the analytics service needs a copy of (Phase 3).
 *
 * The analytics service serves the dashboard from a snapshot; these small
 * tables are *user-edited or accumulated* app state that also feed the maths
 * (window, annual target, eligibility flags, plans, insight history), so the
 * service and the snapshot builder pull them from here. Internal only: called
 * with the deployment admin key.
 */
import { internalQuery } from "./_generated/server";

export const snapshotSeed = internalQuery({
  args: {},
  handler: async ctx => {
    const config = await ctx.db.query("config").collect();
    const productEligible = await ctx.db.query("productEligible").collect();
    const clinicPlan = await ctx.db.query("clinicPlan").collect();
    const insights = await ctx.db.query("insights").collect();
    return { config, productEligible, clinicPlan, insights };
  },
});
