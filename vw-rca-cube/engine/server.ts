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
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { Host, loadExport } from "./host";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map(s => s.trim());
const SNAP = path.join(DATA_DIR, "snapshot");

type Loaded = { host: Host; builtAt: number; dataThrough: string | null; rows: Record<string, number> };
let current: Loaded | null = null;
let building: { startedAt: number } | null = null;
let lastBuild: { ok: boolean; at: number; secs?: number; error?: string } | null = null;

// ---- Convex bridge (app state: rep sessions) ------------------------------------------
const convex = process.env.CONVEX_URL ? new ConvexHttpClient(process.env.CONVEX_URL) : null;
if (convex && process.env.CONVEX_ADMIN_KEY) (convex as any).setAdminAuth(process.env.CONVEX_ADMIN_KEY);
const sessionCache = new Map<string, { at: number; value: { rep: string; email: string } | null }>();

async function repSession(credential: string): Promise<{ rep: string; email: string } | null> {
  const hit = sessionCache.get(credential);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  if (!convex) return null;
  const value = (await convex.query("repAuth:me" as any, { credential })) as { rep: string; email: string } | null;
  sessionCache.set(credential, { at: Date.now(), value });
  return value;
}

/** Mirror a verified rep session into the in-memory db so the handlers' own login check passes. */
async function mirrorRep(l: Loaded, credential: string, s: { rep: string; email: string }) {
  const db = l.host.db;
  const token = credential.slice(3);
  const sess = await db.query("repSessions").withIndex("by_token", q => q.eq("token", token)).unique();
  const now = Date.now();
  if (sess) await db.patch(sess._id, { lastSeen: now, rep: s.rep, email: s.email });
  else await db.insert("repSessions", { token, email: s.email, rep: s.rep, createdAt: now, lastSeen: now });
  const acct = await db.query("repAccounts").withIndex("by_email", q => q.eq("email", s.email)).unique();
  if (acct) await db.patch(acct._id, { rep: s.rep });
  else await db.insert("repAccounts", { email: s.email, rep: s.rep, salt: "", hash: "", createdAt: now, updatedAt: now });
}

/** Refresh the user-edited app-state tables (target, window, eligibility, plans) from Convex. */
async function syncAppState() {
  if (!convex || !current || !process.env.CONVEX_ADMIN_KEY) return;
  try {
    const seed = (await convex.query("appState:snapshotSeed" as any, {})) as Record<string, any[]>;
    const db = current.host.db;
    db.load("config", seed.config.filter(r => r.key === "main"));
    db.load("productEligible", seed.productEligible);
    db.load("clinicPlan", seed.clinicPlan);
  } catch (e) {
    console.error("app-state sync failed:", String(e).slice(0, 200));
  }
}

// ---- snapshot lifecycle ----------------------------------------------------------------
function readMeta(dir: string): { builtAt: number; dataThrough: string | null } {
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
  return { host, rows, ...meta };
}

function runBuilder(): Promise<{ secs: number }> {
  return new Promise((resolve, reject) => {
    const out = SNAP + ".new";
    fs.rmSync(out, { recursive: true, force: true });
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--import", "tsx", path.resolve(__dirname_, "builder.ts"), process.env.SEED_DIR ?? "", out], {
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

export async function rebuild(): Promise<void> {
  if (building) return;
  building = { startedAt: Date.now() };
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
  } finally {
    building = null;
  }
}

// ---- http ------------------------------------------------------------------------------
function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin ?? "";
  if (ORIGINS.includes("*") || ORIGINS.includes(origin)) {
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

async function readBody(req: http.IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 2_000_000) throw new Error("body too large");
  }
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname === "/health") {
      return send(res, 200, {
        ok: !!current,
        snapshot: current && { builtAt: current.builtAt, dataThrough: current.dataThrough, rows: current.rows },
        building: building && { startedAt: building.startedAt },
        lastBuild,
      });
    }
    if (url.pathname === "/admin/rebuild" && req.method === "POST") {
      if (!ADMIN_SECRET || req.headers["x-admin-secret"] !== ADMIN_SECRET) return send(res, 403, { error: "forbidden" });
      void rebuild();
      return send(res, 202, { started: true });
    }
    if (url.pathname === "/rpc" && req.method === "POST") {
      if (!current) return send(res, 503, { error: "snapshot not ready" });
      const { name, args } = await readBody(req);
      if (typeof name !== "string" || !args || typeof args !== "object") return send(res, 400, { error: "bad request" });
      const cred = String(args.password ?? "");
      if (cred.startsWith("rs:")) {
        const s = await repSession(cred);
        if (s) await mirrorRep(current, cred, s);
      }
      const value = await current.host.invoke(name, args);
      return send(res, 200, { value: value === undefined ? null : value });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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
  server.listen(PORT, () => console.log(`rca analytics service on :${PORT}`));
}
