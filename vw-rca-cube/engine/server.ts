/**
 * RCA analytics service.
 *
 * Serves the dashboard's analytics endpoints from an in-memory snapshot of the
 * Refresh output (see engine/builder.ts), by running the same handlers that
 * used to run inside Convex (engine/host.ts). Convex keeps only app state.
 *
 *   POST /rpc            { name: "geo:geoSummary", args: {...} }  -> handler result
 *   GET  /health         snapshot info
 *   POST /admin/rebuild  (x-admin-secret) rebuild the snapshot from Cube now
 *
 * Credentials ride in args.password exactly as before: the shared team
 * password ("tu:<email>|<pw>" for a named user) is checked by the handlers
 * against DASHBOARD_PASSWORD_SHA256; rep session tokens ("rs:...") are
 * resolved against Convex (the logins live there) and mirrored into the
 * in-memory db for the request.
 *
 * Env:
 *   PORT, DATA_DIR (snapshot dir), ALLOWED_ORIGINS (comma list or *),
 *   ADMIN_SECRET, DASHBOARD_PASSWORD_SHA256, ADMIN_PASSWORD_SHA256,
 *   CUBE_API_URL / CUBE_API_SECRET (builder),
 *   CONVEX_URL + CONVEX_ADMIN_KEY (app-state bridge; optional in local tests)
 *   TUNNEL=1 (run a cloudflared quick tunnel and announce its URL to Convex), DISABLE_SCHEDULER=1
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { Host, loadExport } from "./host";
import { verifyPassword } from "../analytics/password";
import type { Mode } from "./builder";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map(s => s.trim());
const SNAP = path.join(DATA_DIR, "snapshot");

type Loaded = { host: Host; builtAt: number; dataThrough: string | null; rows: Record<string, number>; total?: number };
let current: Loaded | null = null;
let building: { startedAt: number; done: Promise<void> } | null = null;
let lastBuild: { ok: boolean; at: number; secs?: number; error?: string } | null = null;

// ---- Convex bridge (app state: rep sessions) ------------------------------------------
const convex = process.env.CONVEX_URL ? new ConvexHttpClient(process.env.CONVEX_URL) : null;
if (convex && process.env.CONVEX_ADMIN_KEY) (convex as any).setAdminAuth(process.env.CONVEX_ADMIN_KEY);
type RepSess = { rep: string; email: string; all?: boolean };
const sessionCache = new Map<string, { at: number; value: RepSess | null }>();

async function repSession(credential: string): Promise<RepSess | null> {
  const hit = sessionCache.get(credential);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  if (!convex) return null;
  const value = (await convex.query("repAuth:me" as any, { credential })) as RepSess | null;
  sessionCache.set(credential, { at: Date.now(), value });
  return value;
}

/** Mirror a verified rep session into the in-memory db so the handlers' own login check passes. */
async function mirrorRep(l: Loaded, credential: string, s: RepSess) {
  const db = l.host.db;
  const token = credential.slice(3);
  const sess = await db.query("repSessions").withIndex("by_token", q => q.eq("token", token)).unique();
  const now = Date.now();
  if (sess) await db.patch(sess._id, { lastSeen: now, rep: s.rep, email: s.email });
  else await db.insert("repSessions", { token, email: s.email, rep: s.rep, createdAt: now, lastSeen: now });
  const acct = await db.query("repAccounts").withIndex("by_email", q => q.eq("email", s.email)).unique();
  // `all` = a rep-view-only login that may open any rep's book: the handlers read it from this mirrored account.
  if (acct) await db.patch(acct._id, { rep: s.rep, allReps: s.all === true });
  else await db.insert("repAccounts", { email: s.email, rep: s.rep, allReps: s.all === true, salt: "", hash: "", createdAt: now, updatedAt: now });
}

/** Refresh the user-edited app-state tables (target, window, eligibility, plans) from Convex. */
async function syncAppState() {
  if (!convex || !current || !process.env.CONVEX_ADMIN_KEY) return;
  try {
    const seed = (await convex.query("appState:snapshotSeed" as any, {})) as Record<string, any[]>;
    const db = current.host.db;
    // The config row mixes user-edited settings with pointers the build derives
    // (gen, p75, rolling window ends), so only the settings that are read at query
    // time (annualTarget, newBusinessGoal) are overlaid. Window changes take effect on the next rebuild.
    const mine = await db.query("config").withIndex("by_key", q => q.eq("key", "main")).unique();
    const theirs = seed.config.find(r => r.key === "main");
    if (mine && theirs?.annualTarget !== undefined && mine.annualTarget !== theirs.annualTarget) {
      await db.patch(mine._id, { annualTarget: theirs.annualTarget });
    }
    if (mine && theirs && mine.newBusinessGoal !== theirs.newBusinessGoal) {
      await db.patch(mine._id, { newBusinessGoal: theirs.newBusinessGoal });
    }
    db.load("productEligible", seed.productEligible);
    db.load("clinicPlan", seed.clinicPlan);
  } catch (e) {
    console.error("app-state sync failed:", String(e).slice(0, 200));
  }
}

// ---- snapshot lifecycle ----------------------------------------------------------------
function readMeta(dir: string): { builtAt: number; dataThrough: string | null; rows?: number } {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return { builtAt: 0, dataThrough: null };
  }
}

async function loadSnapshot(dir: string): Promise<Loaded> {
  const db = loadExport(dir);
  const host = new Host(db);
  await host.ready;
  const meta = readMeta(dir);
  const rows: Record<string, number> = {};
  for (const [t, d] of Object.entries(db.dump())) rows[t] = d.length;
  const { rows: total, ...rest } = meta;
  return { host, rows, total, ...rest };
}

function runBuilder(mode: Mode = "daily"): Promise<{ secs: number }> {
  return new Promise((resolve, reject) => {
    const out = SNAP + ".new";
    if (mode === "daily") fs.rmSync(out, { recursive: true, force: true });
    const t0 = Date.now();
    const args = [path.resolve(__dirname_, "builder.ts"), process.env.SEED_DIR ?? "", out, mode, SNAP];
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", d => (log += d));
    child.stderr.on("data", d => (log += d));
    child.on("exit", code => {
      if (code !== 0) return reject(new Error(`builder exited ${code}: ${log.slice(-400)}`));
      resolve({ secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}
const __dirname_ = path.dirname(new URL(import.meta.url).pathname);

/** Rebuild the served snapshot from Cube; resolves when done. A rebuild already in flight is joined, not repeated. */
export function rebuild(): Promise<void> {
  if (building) return building.done;
  const done = doRebuild().finally(() => {
    building = null;
  });
  building = { startedAt: Date.now(), done };
  return done;
}

/** Weekly / monthly insight snapshots: generated off the live window and pushed to Convex; nothing is swapped in. */
async function runCadence(mode: Mode) {
  if (building) await building.done;
  try {
    const { secs } = await runBuilder(mode);
    console.log(`${mode} insight snapshot done in ${secs}s`);
  } catch (e) {
    console.error(`${mode} insight snapshot failed:`, String(e).slice(0, 300));
  }
}

async function doRebuild(): Promise<void> {
  try {
    const { secs } = await runBuilder();
    const next = await loadSnapshot(SNAP + ".new");
    fs.rmSync(SNAP + ".old", { recursive: true, force: true });
    if (fs.existsSync(SNAP)) fs.renameSync(SNAP, SNAP + ".old");
    fs.renameSync(SNAP + ".new", SNAP);
    current = next;
    lastBuild = { ok: true, at: Date.now(), secs };
    fs.rmSync(SNAP + ".old", { recursive: true, force: true });
  } catch (e) {
    lastBuild = { ok: false, at: Date.now(), error: String(e).slice(0, 400) };
    console.error("rebuild failed:", e);
  }
}

// ---- public URL: quick tunnel, announced to Convex ------------------------------------
// TUNNEL=1 runs `cloudflared tunnel --url http://localhost:PORT`. A quick tunnel gets a new
// *.trycloudflare.com URL every time it starts, so each one is published to Convex
// (ops:setServiceUrl) and the frontend looks it up there. Set VITE_RCA_API_URL instead to pin a
// permanent URL (e.g. a named tunnel).
function startTunnel() {
  const bin = process.env.CLOUDFLARED_BIN ?? "cloudflared";
  const launch = () => {
    const child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
    let announced = false;
    const onData = async (d: Buffer) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!m || announced) return;
      announced = true;
      console.log("tunnel up:", m[0]);
      try {
        if (convex) await convex.mutation("ops:setServiceUrl" as any, { url: m[0] });
      } catch (e) {
        console.error("could not announce tunnel url:", String(e).slice(0, 200));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", code => {
      console.error(`cloudflared exited (${code}); restarting in 5s`);
      setTimeout(launch, 5000);
    });
  };
  launch();
}

// ---- schedule (UTC): daily refresh 13:00 (6am PT), weekly insights Mon 13:45, monthly insights 1st 14:00 ----
function startScheduler() {
  const fired = new Set<string>();
  const tick = () => {
    const d = new Date();
    const day = d.toISOString().slice(0, 10);
    const hm = d.getUTCHours() * 60 + d.getUTCMinutes();
    const once = (key: string, fn: () => void) => {
      if (fired.has(key)) return;
      fired.add(key);
      fn();
    };
    if (hm >= 13 * 60) once(`daily|${day}`, () => void rebuild());
    if (d.getUTCDay() === 1 && hm >= 13 * 60 + 45) once(`weekly|${day}`, () => void runCadence("weekly"));
    if (d.getUTCDate() === 1 && hm >= 14 * 60) once(`monthly|${day}`, () => void runCadence("monthly"));
  };
  // The most recent 13:00 UTC slot. A snapshot built before it missed that refresh (service down or restarted around
  // 13:00, first start), so it is rebuilt right away; one built after it has today's refresh and is left alone.
  // (Before 2026-10-20 any snapshot under 26h old counted, so restarts after 13:00 hid a missed daily refresh.)
  const now = new Date();
  const slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13);
  const lastSlot = Date.now() >= slot ? slot : slot - 24 * 3600_000;
  if (!current || current.builtAt < lastSlot) void rebuild();
  else if (Date.now() >= slot) fired.add(`daily|${now.toISOString().slice(0, 10)}`);
  setInterval(tick, 60_000);
}

// ---- http ------------------------------------------------------------------------------
function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin ?? "";
  // Per-deployment Vercel URLs of this project (vw-<hash>-vbw.vercel.app) are allowed too, so a preview or an older
  // deployment can talk to the service, not only the production alias in ALLOWED_ORIGINS (2026-10-20).
  if (ORIGINS.includes("*") || ORIGINS.includes(origin) || /^https:\/\/vw-[a-z0-9-]+-vbw\.vercel\.app$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", ORIGINS.includes("*") ? "*" : origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-admin-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A problem with the request itself: answered with a clean 4xx instead of a 500 carrying an internal message. */
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 2_000_000) throw new HttpError(413, "body too large");
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    throw new HttpError(400, "bad request");
  }
}

// Failed sign-ins are throttled per client (behind the tunnel the real address is in cf-connecting-ip): more than
// MAX_FAILS refused team-password requests in a minute get a 429 for the rest of that minute (2026-10-20, resilience pass).
const MAX_FAILS = 60;
const fails = new Map<string, { n: number; at: number }>();
const clientOf = (req: http.IncomingMessage) => String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");
function throttled(client: string): boolean {
  const f = fails.get(client);
  if (!f) return false;
  if (Date.now() - f.at > 60_000) { fails.delete(client); return false; }
  return f.n >= MAX_FAILS;
}
function noteFail(client: string) {
  const f = fails.get(client);
  if (!f || Date.now() - f.at > 60_000) fails.set(client, { n: 1, at: Date.now() });
  else f.n++;
  if (fails.size > 5000) for (const [k, v] of fails) if (Date.now() - v.at > 60_000) fails.delete(k);
}
const FN_NAME = /^[A-Za-z][A-Za-z0-9_]*:[A-Za-z][A-Za-z0-9_]*$/;

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname === "/health") {
      // Public: just enough for the page to notice a new snapshot. Row counts and build errors are admin-only.
      const admin = !!ADMIN_SECRET && req.headers["x-admin-secret"] === ADMIN_SECRET;
      return send(res, 200, {
        ok: !!current,
        snapshot: current && (admin ? { builtAt: current.builtAt, dataThrough: current.dataThrough, rows: current.rows } : { builtAt: current.builtAt, dataThrough: current.dataThrough }),
        building: building && { startedAt: building.startedAt },
        lastBuild: lastBuild && (admin ? lastBuild : { ok: lastBuild.ok, at: lastBuild.at }),
      });
    }
    if (url.pathname === "/admin/rebuild" && req.method === "POST") {
      if (!ADMIN_SECRET || req.headers["x-admin-secret"] !== ADMIN_SECRET) return send(res, 403, { error: "forbidden" });
      void rebuild();
      return send(res, 202, { started: true });
    }
    if (url.pathname === "/rpc" && req.method === "POST") {
      if (!current) return send(res, 503, { error: "snapshot not ready" });
      const client = clientOf(req);
      if (throttled(client)) return send(res, 429, { error: "Too many failed attempts. Try again in a minute." });
      const { name, args } = await readBody(req);
      if (typeof name !== "string" || name.length > 80 || !FN_NAME.test(name) || !args || typeof args !== "object" || Array.isArray(args)) return send(res, 400, { error: "bad request" });
      if (typeof args.password !== "string" || !args.password) {
        noteFail(client);
        return send(res, 403, { error: "Not authorized — wrong dashboard password." });
      }
      const cred = String(args.password);
      if (name === "refresh:refreshNow") {
        // Manual Refresh button: team only. Rebuilds the snapshot from Cube (about a minute) and reports the result.
        if (cred.startsWith("rs:") || !(await verifyPassword(cred))) return send(res, 403, { error: "Not authorized — wrong dashboard password." });
        await rebuild();
        if (lastBuild && !lastBuild.ok) return send(res, 500, { error: lastBuild.error ?? "refresh failed" });
        return send(res, 200, { value: { dataThrough: current?.dataThrough ?? "", rows: current?.total ?? 0 } });
      }
      if (cred.startsWith("rs:")) {
        const s = await repSession(cred);
        if (s) await mirrorRep(current, cred, s);
      }
      let value: unknown;
      try {
        value = await current.host.invokeExternal(name, args);
      } catch (e) {
        // Only guesses at the shared team password count: rep tokens are random and unguessable, and an office of reps behind one
        // address with expired sessions must not lock each other out.
        if (!cred.startsWith("rs:") && e instanceof Error && e.message.startsWith("Not authorized")) noteFail(client);
        throw e;
      }
      return send(res, 200, { value: value === undefined ? null : value });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (msg.startsWith("unknown function")) return send(res, 404, { error: "unknown function" });
    // Cube (or Convex) unreachable: say so plainly instead of a generic internal error, and keep serving everything else.
    if (msg === "fetch failed" || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|UND_ERR/.test(String((e as { cause?: unknown })?.cause ?? ""))) {
      console.error("upstream unavailable:", url.pathname, msg.slice(0, 200));
      return send(res, 503, { error: "The data source is temporarily unavailable. Try again in a minute." });
    }
    // A bug in a handler (TypeError and friends) is logged here and answered generically, not leaked to the client.
    if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError) {
      console.error("handler error:", url.pathname, msg.slice(0, 300));
      return send(res, 500, { error: "Internal error" });
    }
    send(res, msg.startsWith("Not authorized") || msg.startsWith("Not available") ? 403 : 500, { error: msg });
  }
});

if (process.argv[1]?.endsWith("server.ts")) {
  if (fs.existsSync(path.join(SNAP, "meta.json")) || fs.existsSync(SNAP)) {
    current = await loadSnapshot(SNAP);
    console.log(`snapshot loaded (dataThrough ${current.dataThrough})`);
  } else {
    console.log("no snapshot yet; POST /admin/rebuild to build one");
  }
  setInterval(() => void syncAppState(), 60_000);
  void syncAppState();
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();
  if (process.env.TUNNEL === "1") startTunnel();
  server.listen(PORT, () => console.log(`rca analytics service on :${PORT}`));
}
