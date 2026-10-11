// PHI console redaction (active only on PHI deployments).
import "./phiLogging";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
// Registers Convex Auth's routes, including the OAuth endpoints used by
// "Sign in with Viktor": /api/auth/signin/viktor and /api/auth/callback/viktor.
auth.addHttpRoutes(http);

/**
 * Seed/refresh endpoint. Lets the data pipeline be kicked off for a freshly
 * deployed environment (production starts with an empty database and would
 * otherwise wait for the 6am PT cron). Guarded by the dashboard password.
 */
http.route({
  path: "/api/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      password?: string;
    };
    const ok = await ctx.runQuery(api.gate.check, {
      password: body.password ?? "",
    });
    if (!ok) return new Response("forbidden", { status: 403 });
    const result = await ctx.runAction(internal.refresh.refreshData, {});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

export default http;
