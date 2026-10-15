/**
 * One `api` object for the whole app.
 *
 * Phase 3 split the backend in two: Convex (convex/) keeps app state (logins,
 * settings, plans, insights) and the analytics service (analytics/, served by
 * engine/server.ts) answers everything computed from the data. Both generate
 * a typed `api`; at runtime a function reference is just its "module:name"
 * string, so one proxy serves both and the hooks route by what they are given:
 * Convex's useQuery/useMutation/useAction for app state, useRcaQuery/useRcaAction
 * (src/lib/rca.ts) for analytics.
 */
import { api as convexApi } from "../../convex/_generated/api";
import type { api as analyticsApi } from "../../analytics/_generated/api";

type Merged = typeof convexApi & typeof analyticsApi;
export const api = convexApi as unknown as Merged;
