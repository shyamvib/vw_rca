/**
 * Access rules for client account manager (CAM) logins (2026-11).
 *
 * A CAM signs in like a rep and gets the rep view only, limited to the salespeople paired with them in Cube
 * (internal_user.cam_name). The handlers know two kinds of rep-view viewer: a rep pinned to one name, and a manager who may
 * open any rep or `team:` book. A CAM is neither, so the check lives here, at the service boundary, in one place:
 *
 *   - only the calls the rep view needs are allowed (deny by default: anything not listed is refused);
 *   - `sales` must be exactly one of the CAM's reps (so `team:*`, another rep, or no value at all is refused);
 *   - `teamLead` is refused everywhere (it widens a call to a whole team or the company);
 *   - clinic ids must belong to one of the CAM's reps;
 *   - calls that return other people's rows are cut down to the CAM's reps afterwards.
 *
 * Pure functions, no I/O: the caller supplies the rep set and a clinic-owner lookup.
 */

export class CamDenied extends Error {}

export type CamScope = {
  reps: ReadonlySet<string>;
  /** Salesperson that owns the clinic in the current snapshot, or undefined when the clinic is unknown. */
  ownerOf: (clinic: string) => string | undefined;
  /** Salespeople whose recent orders carry this provider (customer) id; empty or undefined when unknown. */
  providerOwners?: (provider: string) => readonly string[] | undefined;
};

type Args = Record<string, unknown>;
type Rule = {
  /** `sales` must be present and one of the CAM's reps. */
  sales?: true;
  /** Names of arguments holding one clinic id each (required when listed, unless `optional`). */
  clinic?: string[];
  /** Names of arguments holding a provider (customer) id; every salesperson on the provider's orders must be the CAM's. */
  provider?: string[];
  /** For a rule with `clinic` and `provider`: either one may be sent, but at least one must be. */
  optional?: true;
  /** Names of arguments holding a list of clinic ids. */
  clinics?: string[];
  /** Arguments that must not be sent at all (they would aim the call at someone else's data). */
  forbid?: string[];
  /** Cuts the result down to the CAM's reps. */
  filter?: (value: unknown, scope: CamScope) => unknown;
  /** Runs the call once per rep (with `sales` set to that rep) and merges the answers. */
  fanOut?: (results: unknown[]) => unknown;
};

const rowsBySales = (key: string) => (value: unknown, scope: CamScope) => {
  if (Array.isArray(value)) return value.filter(r => scope.reps.has(String((r as Args)?.[key] ?? "")));
  if (value && typeof value === "object" && Array.isArray((value as Args).rows)) {
    const v = value as Args;
    return { ...v, rows: (v.rows as unknown[]).filter(r => scope.reps.has(String((r as Args)?.[key] ?? ""))) };
  }
  return value;
};

/** Clinic search: every rep's best hits, nearest the biggest gap first, at most 8 like the rep's own search. */
const mergeSearch = (results: unknown[]) => {
  const parts = results as Array<{ ready?: boolean; matches?: Array<{ delta?: number }> }>;
  const matches = parts.flatMap(r => r?.matches ?? []).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 8);
  return { ready: parts.some(r => r?.ready), matches };
};

const BOOK: Rule = { sales: true };

/** The calls a CAM may make. Everything else is refused. */
export const CAM_RULES: Record<string, Rule> = {
  // One rep's book and everything the rep view computes from it.
  "repView:book": BOOK,
  "repView:pace": BOOK,
  "repView:clinicDetail": BOOK,
  "repView:rowsByFocus": BOOK,
  "repView:teamEffort": BOOK,
  "wins:winsSummary": BOOK,
  "leadFamilies:salesFamilies": BOOK,
  "newClinicFunnel:orderRetentionFunnel": BOOK,
  "projection:summary": BOOK,
  "productGrowth:productGrowth": BOOK,
  "clinics:cohortDriverSplit": BOOK,
  "clinics:clinicDrill": BOOK,
  "clinics:newClinicGroups": BOOK,
  "families:familyClinicsAction": BOOK,
  "families:switchClinicsAction": BOOK,
  "geo:geoSummary": BOOK,
  "geo:scopeTotals": BOOK,
  "feed:repQuestions": BOOK,
  "feed:raiseQuestion": { sales: true },
  // Clinic-level lookups: the clinic must sit in one of the CAM's reps' books.
  "families:portfolioAction": { clinic: ["clinic"] },
  "families:customersAction": { clinic: ["clinic"] },
  "clinicalTouch:clinicalTouch": { clinic: ["clinic"], provider: ["provider"], optional: true },
  "newClinicTouches:newClinicTouches": { clinics: ["clinics"] },
  "newClinicFunnel:seqFor": { clinics: ["clinics"] },
  // Lists that cover other people: cut down to the CAM's reps.
  "geo:salesReps": { forbid: ["teamLead", "sales"], filter: rowsBySales("name") },
  "families:providerSearch": { filter: rowsBySales("sales") },
  "feed:clinicSearch": { forbid: ["sales"], fanOut: mergeSearch },
  // What the page loads first: the list of periods (and the window settings). It is the same call every rep login makes, and it holds
  // company-level totals but no clinic or provider rows.
  "bridge:bridge": {},
  // Harmless app-wide settings the rep view reads on load.
  "config:get": {},
  "familyLaunch:launches": {},
};

const isText = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/**
 * Checks one call. Returns the arguments to run it with and an optional result filter, or throws CamDenied.
 * `password` is passed through untouched; the handlers still run their own login check on it.
 */
export function guardCamCall(
  name: string,
  args: Args,
  scope: CamScope,
): { args: Args; filter?: (value: unknown) => unknown; calls?: Args[]; merge?: (results: unknown[]) => unknown } {
  const rule = CAM_RULES[name];
  if (!rule) throw new CamDenied(`Not available for account manager logins (${name}).`);

  // `teamLead` widens a call to a team or the company; no allowed call needs it.
  if (isText(args.teamLead)) throw new CamDenied("Not available for account manager logins.");
  for (const k of rule.forbid ?? []) if (args[k] !== undefined && args[k] !== null && args[k] !== "") throw new CamDenied("Not available for account manager logins.");

  const out: Args = { ...args };
  if (rule.sales) {
    if (!isText(args.sales) || !scope.reps.has(args.sales)) throw new CamDenied("That salesperson is not one of your reps.");
  } else if (isText(args.sales)) {
    // A call that takes no rep must not smuggle one in either.
    if (!scope.reps.has(args.sales)) throw new CamDenied("That salesperson is not one of your reps.");
  }
  let given = 0;
  for (const k of rule.provider ?? []) {
    const p = args[k];
    if (p === undefined || p === null || p === "") continue;
    given++;
    const owners = isText(p) ? scope.providerOwners?.(p) : undefined;
    if (!owners || !owners.length || !owners.every(o => scope.reps.has(o))) throw new CamDenied("That provider is not in your reps' books.");
  }
  for (const k of rule.clinic ?? []) {
    const c = args[k];
    if (rule.optional && (c === undefined || c === null || c === "")) continue;
    if (!isText(c)) throw new CamDenied("Pick one of your clinics.");
    given++;
    const owner = scope.ownerOf(c);
    if (!owner || !scope.reps.has(owner)) throw new CamDenied("That clinic is not in your reps' books.");
  }
  if (rule.optional && !given) throw new CamDenied("Pick one of your clinics or providers.");
  for (const k of rule.clinics ?? []) {
    const list = args[k];
    if (!Array.isArray(list) || list.length > 5000) throw new CamDenied("Pick clinics from your reps' books.");
    for (const c of list) {
      const owner = isText(c) ? scope.ownerOf(c) : undefined;
      if (!owner || !scope.reps.has(owner)) throw new CamDenied("That clinic is not in your reps' books.");
    }
  }
  // Never let the caller's own team scope through, even if a handler would accept it.
  delete out.teamLead;
  const filter = rule.filter;
  if (rule.fanOut) {
    const reps = [...scope.reps].slice(0, 40);
    return { args: out, calls: reps.map(sales => ({ ...out, sales })), merge: rule.fanOut, filter: filter ? value => filter(value, scope) : undefined };
  }
  return { args: out, filter: filter ? value => filter(value, scope) : undefined };
}
