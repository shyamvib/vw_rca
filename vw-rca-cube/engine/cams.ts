/**
 * Client account managers and the salespeople paired with them, read from Cube's internal_user cube
 * (each salesperson row carries cam_id / cam_name; a CAM is also a row, which gives their email).
 *
 * Read on demand and cached, so a pairing change in the source system reaches the dashboard within CACHE_MS without a
 * rebuild. If Cube is down the last good answer keeps serving; with no answer at all a CAM sees nothing (fail closed).
 * Salesperson names are internal_user.name, the same name the refresh stores as clinicMeta.sales.
 */

const CACHE_MS = 10 * 60 * 1000;

export type CamRep = { name: string; teamLead: string };
export type Cam = { camId: string; name: string; email: string; reps: CamRep[] };

let cache: { at: number; cams: Cam[] } | null = null;
let inflight: Promise<Cam[]> | null = null;

const text = (v: unknown) => (v == null ? "" : String(v).trim());

/** Pure: turns internal_user rows into CAMs with their reps. Exported for tests. */
export function buildCams(users: Array<Record<string, unknown>>): Cam[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const u of users) byId.set(text(u.id), u);
  const cams = new Map<string, Cam>();
  for (const u of users) {
    const camName = text(u.camName);
    const camId = text(u.camId);
    const name = text(u.name);
    if (!camName || !name || u.active === false) continue;
    if (camId && camId === text(u.id)) continue; // a CAM listed as their own CAM
    const key = camId || camName;
    let cam = cams.get(key);
    if (!cam) {
      const row = camId ? byId.get(camId) : undefined;
      cam = { camId, name: camName, email: text(row?.email).toLowerCase(), reps: [] };
      cams.set(key, cam);
    }
    cam.reps.push({ name, teamLead: text(u.supervisor) });
  }
  return [...cams.values()]
    .map(c => ({ ...c, reps: c.reps.sort((a, b) => a.teamLead.localeCompare(b.teamLead) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchCams(): Promise<Cam[]> {
  // Loaded here, not at the top, so the pure buildCams above can be tested without Cube configured.
  const { rows: cubeRows } = await import("../analytics/cube");
  const data = await cubeRows(
    {
      dimensions: [
        "internal_user.internal_user_id",
        "internal_user.name",
        "internal_user.email",
        "internal_user.cam_id",
        "internal_user.cam_name",
        "internal_user.supervisor_name",
        "internal_user.is_active",
      ],
    },
    {
      "internal_user.internal_user_id": "id",
      "internal_user.name": "name",
      "internal_user.email": "email",
      "internal_user.cam_id": "camId",
      "internal_user.cam_name": "camName",
      "internal_user.supervisor_name": "supervisor",
      "internal_user.is_active": "active",
    },
  );
  return buildCams(data);
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
