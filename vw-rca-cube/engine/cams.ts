/**
 * Client account managers and the salespeople paired with them.
 *
 * The pairing comes from the order rows (rfm_orders: sales_id, cam_id, team_lead), not from internal_user: the live
 * internal_user table has no CAM column. A CAM is paired with a salesperson when the CAM's id is on at least SHARE of that
 * salesperson's orders over the last WINDOW_DAYS days, so a stray order does not hand a CAM someone's whole book. The CAM's
 * name and email come from internal_user by id; the salesperson's name is internal_user.name, the same name the refresh
 * stores as clinicMeta.sales.
 *
 * Read on demand and cached, so a pairing change reaches the dashboard within CACHE_MS without a rebuild. If Cube is down
 * the last good answer keeps serving; with no answer at all a CAM sees nothing (fail closed).
 */
import { CAM_OVERRIDES } from "./camOverrides.ts";

const CACHE_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 180;
/** A CAM is paired with a rep when they hold at least this share of the rep's orders in the window. */
const SHARE = 0.25;

export type CamOverrides = Record<string, { name: string; email: string }>;
export type CamRep = { name: string; teamLead: string };
export type Cam = { camId: string; name: string; email: string; reps: CamRep[] };
let raw: { users: Array<Record<string, unknown>>; pairs: Array<Record<string, unknown>> } | null = null;
let cache: { at: number; cams: Cam[] } | null = null;
let inflight: Promise<Cam[]> | null = null;

const text = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * Pure: pairs CAMs with reps. `users` are internal_user rows ({ id, name, email }); `pairs` are order counts per
 * (sales_id, cam_id, team_lead) in the window ({ salesId, camId, teamLead, orders }). Exported for tests.
 */
export function buildCams(
  users: Array<Record<string, unknown>>,
  pairs: Array<Record<string, unknown>>,
  share = SHARE,
  overrides: CamOverrides = {},
): Cam[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const u of users) byId.set(text(u.id), u);
  const total = new Map<string, number>(); // orders per rep
  for (const p of pairs) total.set(text(p.salesId), (total.get(text(p.salesId)) ?? 0) + Number(p.orders ?? 0));
  const cams = new Map<string, Cam>();
  const seen = new Set<string>();
  for (const p of pairs) {
    const salesId = text(p.salesId);
    const camId = text(p.camId);
    const orders = Number(p.orders ?? 0);
    if (!camId || !salesId || camId === salesId || !orders) continue;
    if (orders / (total.get(salesId) || 1) < share) continue;
    const rep = text(byId.get(salesId)?.name);
    if (!rep) continue;
    let cam = cams.get(camId);
    if (!cam) {
      const row = byId.get(camId);
      // A CAM id with no internal_user row has no name or email to sign in with, unless engine/camOverrides.ts supplies them.
      const name = text(row?.name) || text(overrides[camId]?.name);
      if (!name) continue;
      cam = { camId, name, email: (text(row?.email) || text(overrides[camId]?.email)).toLowerCase(), reps: [] };
      cams.set(camId, cam);
    }
    const key = `${camId}|${salesId}`;
    if (seen.has(key)) continue; // the same rep under two team leads counts once
    seen.add(key);
    cam.reps.push({ name: rep, teamLead: text(p.teamLead) });
  }
  return [...cams.values()]
    .map(c => ({ ...c, reps: c.reps.sort((a, b) => a.teamLead.localeCompare(b.teamLead) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchCams(): Promise<Cam[]> {
  // Loaded here, not at the top, so the pure buildCams above can be tested without Cube configured.
  const { rows: cubeRows, orderDays, O } = await import("../analytics/cube");
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const [users, pairs] = await Promise.all([
    cubeRows(
      { dimensions: ["internal_user.internal_user_id", "internal_user.name", "internal_user.email"] },
      { "internal_user.internal_user_id": "id", "internal_user.name": "name", "internal_user.email": "email" },
    ),
    cubeRows(
      {
        dimensions: [`${O}.sales_id`, `${O}.cam_id`, `${O}.team_lead`],
        measures: [`${O}.orders`],
        timeDimensions: orderDays(day(start), day(end)),
      },
      { [`${O}.sales_id`]: "salesId", [`${O}.cam_id`]: "camId", [`${O}.team_lead`]: "teamLead", [`${O}.orders`]: "orders" },
    ),
  ]);
  raw = { users, pairs };
  return buildCams(users, pairs, SHARE, overrides());
}

const overrides = (): CamOverrides => CAM_OVERRIDES;

/** CAM ids carried by orders (at a real share of some rep's orders) that no one can sign in as: no internal_user row, no override. */
export async function unmatchedCamIds() {
  await allCams();
  const { users, pairs } = raw ?? { users: [], pairs: [] };
  const known = new Set([...users.map(u => text(u.id)), ...Object.keys(overrides())]);
  const name = new Map(users.map(u => [text(u.id), text(u.name)]));
  const total = new Map<string, number>();
  for (const p of pairs) total.set(text(p.salesId), (total.get(text(p.salesId)) ?? 0) + Number(p.orders ?? 0));
  const by = new Map<string, Array<{ rep: string; teamLead: string; orders: number }>>();
  for (const p of pairs) {
    const id = text(p.camId);
    const orders = Number(p.orders ?? 0);
    if (!id || known.has(id) || orders / (total.get(text(p.salesId)) || 1) < SHARE) continue;
    (by.get(id) ?? by.set(id, []).get(id)!).push({ rep: name.get(text(p.salesId)) ?? `(no user ${text(p.salesId)})`, teamLead: text(p.teamLead), orders });
  }
  return [...by].map(([camId, reps]) => ({ camId, reps: reps.sort((a, b) => b.orders - a.orders) })).sort((a, b) => b.reps.length - a.reps.length);
}

/** Every CAM with their reps (cached). Throws only when there is no answer at all. */
export async function allCams(): Promise<Cam[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cams;
  inflight ??= fetchCams()
    .then(cams => {
      cache = { at: Date.now(), cams };
      return cams;
    })
    .finally(() => {
      inflight = null;
    });
  try {
    return await inflight;
  } catch (e) {
    if (cache) return cache.cams;
    throw e;
  }
}

/** The CAM whose name or email matches `who` (a CAM login stores the CAM's name as its rep), with reps. Fails closed. */
export async function repsOfCam(who: string, email: string): Promise<CamRep[]> {
  let cams: Cam[];
  try {
    cams = await allCams();
  } catch {
    return [];
  }
  const e = email.trim().toLowerCase();
  const byEmail = e ? cams.filter(c => c.email === e) : [];
  const hit = byEmail.length ? byEmail : cams.filter(c => c.name.toLowerCase() === who.trim().toLowerCase());
  return hit.flatMap(c => c.reps);
}

/**
 * Why is someone (not) paired? For each search term: matching internal_user rows, the order shares of any rep whose name matches
 * (who their orders list as CAM, and how big a share each CAM holds), and, for a CAM whose name matches, every rep their id is on.
 * Admin-only (see /admin/cams?debug=Name,Name). Share is the fraction of the rep's orders in the window; SHARE is the cut-off.
 */
export async function camDiagnostics(terms: string[]) {
  await allCams();
  const { users, pairs } = raw ?? { users: [], pairs: [] };
  const name = new Map(users.map(u => [text(u.id), text(u.name)]));
  const total = new Map<string, number>();
  for (const p of pairs) total.set(text(p.salesId), (total.get(text(p.salesId)) ?? 0) + Number(p.orders ?? 0));
  const share = (p: Record<string, unknown>) => Math.round((Number(p.orders ?? 0) / (total.get(text(p.salesId)) || 1)) * 1000) / 10;
  const row = (p: Record<string, unknown>) => ({
    rep: name.get(text(p.salesId)) ?? `(no user ${text(p.salesId)})`,
    teamLead: text(p.teamLead),
    cam: text(p.camId) ? `${name.get(text(p.camId)) ?? "(no internal_user row)"} [id ${text(p.camId)}]` : "(no CAM on these orders)",
    orders: Number(p.orders ?? 0),
    sharePct: share(p),
    paired: share(p) >= SHARE * 100 && !!text(p.camId),
  });
  return {
    windowDays: WINDOW_DAYS,
    minSharePct: SHARE * 100,
    terms: terms.map(t => {
      const q = t.trim().toLowerCase();
      const hit = (u: Record<string, unknown>) => `${text(u.name)} ${text(u.email)}`.toLowerCase().includes(q);
      const matched = users.filter(hit);
      const ids = new Set(matched.map(u => text(u.id)));
      return {
        term: t,
        users: matched.slice(0, 10).map(u => ({ id: text(u.id), name: text(u.name), email: text(u.email) })),
        // orders of the reps who match the term
        asRep: pairs.filter(p => ids.has(text(p.salesId))).map(row).sort((a, b) => a.rep.localeCompare(b.rep) || b.sharePct - a.sharePct),
        // orders that carry the matching person's id as CAM
        asCam: pairs.filter(p => ids.has(text(p.camId))).map(row).sort((a, b) => b.orders - a.orders),
      };
    }),
  };
}

/**
 * Salespeople on a provider's (customer's) orders in the window, by name. A sales id with no internal_user name is listed as "?",
 * so the guard treats it as someone else's. Empty when the id is not numeric or has no orders. Used to open a provider card.
 */
export async function ownersOfProvider(customerId: string): Promise<string[]> {
  if (!/^\d+$/.test(customerId)) return [];
  await allCams();
  const name = new Map((raw?.users ?? []).map(u => [text(u.id), text(u.name)]));
  const { rows: cubeRows, orderDays, eq, O } = await import("../analytics/cube");
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const data = await cubeRows(
    { dimensions: [`${O}.sales_id`], filters: [eq(`${O}.customer_id`, customerId)], timeDimensions: orderDays(day(start), day(end)) },
    { [`${O}.sales_id`]: "salesId" },
  );
  return [...new Set(data.map(r => name.get(text(r.salesId)) || "?"))];
}
