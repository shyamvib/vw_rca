/**
 * Per-rep logins for the RCA dashboard (Shyam, 2026-09-25).
 *
 * A rep account is an email + password that Shyam sets from the admin panel
 * in Settings. Signing in with one issues a session token; the browser sends
 * that token (prefixed `rs:`) wherever it used to send the shared password,
 * and convex/gated.ts resolves it back to the rep's name and forces every
 * data call to that salesperson's book. Reps never see the shared password.
 */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  normalizeEmail,
  sha256Hex,
  verifyAdminPassword,
  verifyPassword,
} from "./password";

export const REP_TOKEN_PREFIX = "rs:";
/** Rep sessions expire after 14 days of inactivity. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashWithSalt(salt: string, password: string): Promise<string> {
  return await sha256Hex(`${salt}::${password}`);
}

export type RepSession = { rep: string; email: string };

/** Resolves a `rs:` token to its session, or null when unknown/expired. */
export async function resolveRepToken(
  ctx: QueryCtx,
  credential: string,
): Promise<RepSession | null> {
  if (!credential.startsWith(REP_TOKEN_PREFIX)) return null;
  const token = credential.slice(REP_TOKEN_PREFIX.length);
  if (!token) return null;
  const row = await ctx.db
    .query("repSessions")
    .withIndex("by_token", q => q.eq("token", token))
    .unique();
  if (!row) return null;
  if (Date.now() - row.lastSeen > SESSION_TTL_MS) return null;
  // The account may have been deleted or re-pointed since the login.
  const account = await ctx.db
    .query("repAccounts")
    .withIndex("by_email", q => q.eq("email", row.email))
    .unique();
  if (!account) return null;
  return { rep: account.rep, email: row.email };
}

/** Action-side lookup (actions have no ctx.db). */
export const resolveSession = internalQuery({
  args: { credential: v.string() },
  returns: v.union(v.null(), v.object({ rep: v.string(), email: v.string() })),
  handler: async (ctx, { credential }) => await resolveRepToken(ctx, credential),
});

/** Salesperson that owns a clinic in the current data generation. */
export const clinicSales = internalQuery({
  args: { clinic: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { clinic }) => {
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const gen = cfg?.gen ?? 0;
    const rows = await ctx.db
      .query("clinicMeta")
      .withIndex("by_clinic", q => q.eq("clinic", clinic))
      .collect();
    const row = rows.find(r => (r.gen ?? 0) === gen) ?? rows[0];
    return row?.sales ?? null;
  },
});

/**
 * One sign-in for everyone. If the email has a rep account, only that
 * account's password works and the result is a rep session; otherwise the
 * shared team password unlocks the full dashboard as before.
 */
export const login = mutation({
  args: { email: v.string(), password: v.string(), agent: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({ kind: v.literal("team") }),
    v.object({ kind: v.literal("rep"), token: v.string(), rep: v.string() }),
  ),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) return null;
    const account = await ctx.db
      .query("repAccounts")
      .withIndex("by_email", q => q.eq("email", email))
      .unique();
    const agent = args.agent?.slice(0, 200);
    if (account) {
      const hash = await hashWithSalt(account.salt, args.password);
      if (hash !== account.hash) return null;
      const token = randomToken();
      const now = Date.now();
      await ctx.db.insert("repSessions", {
        token,
        email,
        rep: account.rep,
        createdAt: now,
        lastSeen: now,
      });
      await ctx.db.insert("accessLog", { email, at: now, agent });
      return { kind: "rep" as const, token, rep: account.rep };
    }
    if (!(await verifyPassword(args.password))) return null;
    await ctx.db.insert("accessLog", { email, at: Date.now(), agent });
    return { kind: "team" as const };
  },
});

/** Who the current rep credential belongs to (null when not a rep session). */
export const me = query({
  args: { credential: v.string() },
  returns: v.union(v.null(), v.object({ rep: v.string(), email: v.string() })),
  handler: async (ctx, { credential }) => await resolveRepToken(ctx, credential),
});

/** Ends a rep session. */
export const logout = mutation({
  args: { credential: v.string() },
  returns: v.null(),
  handler: async (ctx, { credential }) => {
    if (!credential.startsWith(REP_TOKEN_PREFIX)) return null;
    const token = credential.slice(REP_TOKEN_PREFIX.length);
    const row = await ctx.db
      .query("repSessions")
      .withIndex("by_token", q => q.eq("token", token))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Admin panel (Settings → Rep logins). Every call carries the admin password.
// ---------------------------------------------------------------------------

const accountShape = v.object({
  email: v.string(),
  rep: v.string(),
  updatedAt: v.number(),
  lastLogin: v.union(v.null(), v.number()),
});

export const list = query({
  args: { adminPassword: v.string() },
  returns: v.union(v.null(), v.array(accountShape)),
  handler: async (ctx, { adminPassword }) => {
    if (!(await verifyAdminPassword(adminPassword))) return null;
    const rows = await ctx.db.query("repAccounts").collect();
    const out = [];
    for (const r of rows) {
      const last = await ctx.db
        .query("accessLog")
        .withIndex("by_email", q => q.eq("email", r.email))
        .order("desc")
        .first();
      out.push({
        email: r.email,
        rep: r.rep,
        updatedAt: r.updatedAt,
        lastLogin: last?.at ?? null,
      });
    }
    return out.sort((a, b) => a.rep.localeCompare(b.rep));
  },
});

/** Salesperson names present in the current data, for the admin dropdown. */
export const repNames = query({
  args: { adminPassword: v.string() },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, { adminPassword }) => {
    if (!(await verifyAdminPassword(adminPassword))) return null;
    const cfg = await ctx.db
      .query("config")
      .withIndex("by_key", q => q.eq("key", "main"))
      .unique();
    const gen = cfg?.gen ?? 0;
    const clinics = await ctx.db
      .query("clinicMeta")
      .withIndex("by_gen", q => q.eq("gen", gen))
      .collect();
    const names = new Set<string>();
    for (const c of clinics) {
      const n = (c.sales ?? "").trim();
      if (n && n !== "—") names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  },
});

type UpsertResult = { ok: boolean; error?: string };

async function upsertAccount(
  ctx: MutationCtx,
  args: { email: string; rep: string; password?: string },
): Promise<UpsertResult> {
    const email = normalizeEmail(args.email);
    if (!email) return { ok: false, error: "Use a @vibrant-wellness.com or @vibrant-america.com email." };
    const rep = args.rep.trim();
    if (!rep) return { ok: false, error: "Pick the salesperson this login is for." };
    const existing = await ctx.db
      .query("repAccounts")
      .withIndex("by_email", q => q.eq("email", email))
      .unique();
    const now = Date.now();
    if (existing) {
      const patch: Record<string, unknown> = { rep, updatedAt: now };
      if (args.password) {
        if (args.password.length < 8) return { ok: false, error: "Password needs at least 8 characters." };
        const salt = randomToken();
        patch.salt = salt;
        patch.hash = await hashWithSalt(salt, args.password);
        // A password change signs the rep out everywhere.
        const sessions = await ctx.db.query("repSessions").collect();
        for (const s of sessions) if (s.email === email) await ctx.db.delete(s._id);
      }
      await ctx.db.patch(existing._id, patch);
      return { ok: true };
    }
    if (!args.password || args.password.length < 8) {
      return { ok: false, error: "Password needs at least 8 characters." };
    }
    const salt = randomToken();
    await ctx.db.insert("repAccounts", {
      email,
      rep,
      salt,
      hash: await hashWithSalt(salt, args.password),
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true };
}

/** Creates or updates a rep account. Omit `password` to keep the current one. */
export const upsert = mutation({
  args: {
    adminPassword: v.string(),
    email: v.string(),
    rep: v.string(),
    password: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.object({ ok: v.boolean(), error: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    if (!(await verifyAdminPassword(args.adminPassword))) return null;
    return await upsertAccount(ctx, args);
  },
});

/**
 * Same as `upsert`, callable only from the Convex CLI/dashboard (never from
 * the browser) — for seeding test accounts on preview.
 */
export const adminUpsert = internalMutation({
  args: { email: v.string(), rep: v.string(), password: v.optional(v.string()) },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => await upsertAccount(ctx, args),
});

/** Deletes a rep account and all its sessions. */
export const remove = mutation({
  args: { adminPassword: v.string(), email: v.string() },
  returns: v.union(v.null(), v.boolean()),
  handler: async (ctx, args) => {
    if (!(await verifyAdminPassword(args.adminPassword))) return null;
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("repAccounts")
      .withIndex("by_email", q => q.eq("email", email))
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    const sessions = await ctx.db.query("repSessions").collect();
    for (const s of sessions) if (s.email === email) await ctx.db.delete(s._id);
    return true;
  },
});
