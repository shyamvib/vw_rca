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

const CACHE_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 180;
/** A CAM is paired with a rep when they hold at least this share of the rep's orders in the window. */
const SHARE = 0.25;

export type CamRep = { name: string; teamLead: string };
export type Cam = { camId: string; name: string; email: string; reps: CamRep[] };
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
      const name = text(row?.name);
      if (!name) continue; // a CAM id with no internal_user row has no name or email to sign in with
      cam = { camId, name, email: text(row?.email).toLowerCase(), reps: [] };
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
  return buildCams(users, pairs);
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
