#!/usr/bin/env node
/**
 * Does a CAM see the same numbers as the rep view? Signs in as a CAM and as the shared team login, asks the analytics service the
 * same questions for each of the CAM's reps through both, and diffs every number. The team login with `sales` set to a rep returns what
 * that rep's own book shows (the handlers take the rep from `sales`), so any difference is a real discrepancy.
 * Also checks the lock: the CAM must be refused for a rep who is not theirs, for a team scope, and for a call outside the allow-list.
 *
 *   SERVICE_URL=https://<engine-url> CONVEX_URL=https://<prod>.convex.cloud \
 *   CAM_EMAIL=emma.b@vibrant-wellness.com CAM_PASSWORD=... TEAM_EMAIL=you@vibrant-wellness.com TEAM_PASSWORD=... \
 *   node scripts/cam-compare.mjs [--rep "Rep Name"] [--outsider "Some Other Rep"]
 *
 * Passwords come from the environment, never from arguments (they would land in shell history). Read-only: it only reads data. It
 * signs in once as the CAM, which adds one line to the access log.
 */
const env = k => process.env[k]?.trim() ?? "";
const args = process.argv.slice(2);
const val = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const SERVICE = env("SERVICE_URL").replace(/\/$/, "");
const CONVEX = env("CONVEX_URL").replace(/\/$/, "");

const rpc = async (name, cred, a) => {
  const r = await fetch(`${SERVICE}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args: { password: cred, ...a } }) });
  const body = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, value: body.value } : { ok: false, status: r.status, error: body.error };
};

/** Numbers that legitimately differ between two requests (times, ids minted per call). */
const IGNORE = /^(generatedAt|builtAt|at|updatedAt|now|requestId|lastSeen|createdAt)$/;
export function diff(a, b, path = "", out = []) {
  if (out.length > 200) return out;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: ${a.length} items vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!IGNORE.test(k)) diff(a[k], b[k], `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const k of ["SERVICE_URL", "CONVEX_URL", "CAM_EMAIL", "CAM_PASSWORD", "TEAM_EMAIL", "TEAM_PASSWORD"])
    if (!env(k)) {
      console.error(`Set ${k}.`);
      process.exit(1);
    }
  // 1. sign in as the CAM
  const login = await (await fetch(`${CONVEX}/api/mutation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "repAuth:login", args: { email: env("CAM_EMAIL"), password: env("CAM_PASSWORD"), agent: "cam-compare" }, format: "json" }) })).json();
  const sess = login.value;
  if (!sess || sess.kind !== "rep" || !sess.cam) {
    console.error(`Sign-in as ${env("CAM_EMAIL")} did not give a CAM session (got ${sess ? `kind ${sess.kind}${sess.cam ? "" : ", not a CAM account"}` : "a refusal: wrong email or password"}).`);
    process.exit(1);
  }
  const CAM = `rs:${sess.token}`;
  const TEAM = `tu:${env("TEAM_EMAIL")}|${env("TEAM_PASSWORD")}`;

  const bridge = await rpc("bridge:bridge", CAM, {});
  if (!bridge.ok) throw new Error(`bridge as CAM: ${bridge.status} ${bridge.error}`);
  const myReps = (bridge.value.camReps ?? []).map(r => r.name);
  const reps = val("--rep") ? [val("--rep")] : myReps;
  console.log(`${env("CAM_EMAIL")}: ${myReps.length} reps: ${myReps.join(", ") || "(none)"}\n`);

  const periods = bridge.value.periods ?? [];
  const latest = kind => periods.filter(p => p.kind === kind).at(-1)?.id;
  const windows = [["all", "all"], [latest("week"), "this week"], [latest("month"), "this month"], [latest("quarter"), "this quarter"]].filter(([id]) => id);

  const CALLS = [
    ["repView:book", p => ({ periodId: p })],
    ["repView:pace", p => ({ periodId: p })],
    ["wins:winsSummary", p => ({ periodId: p })],
    ["leadFamilies:salesFamilies", p => ({ periodId: p })],
    ["geo:scopeTotals", p => ({ periodId: p })],
    ["geo:geoSummary", p => ({ periodId: p })],
    ["clinics:cohortDriverSplit", p => ({ periodId: p })],
    ["clinics:clinicDrill", p => ({ periodId: p, lens: "total", limit: 500 })],
    ["newClinicFunnel:orderRetentionFunnel", p => ({ periodId: p })],
    ["productGrowth:productGrowth", p => ({ periodId: p })],
  ];
  let bad = 0;
  let compared = 0;
  for (const rep of reps) {
    for (const [pid, label] of windows)
      for (const [name, mk] of CALLS) {
        const a = { ...mk(pid), sales: rep };
        const [cam, team] = await Promise.all([rpc(name, CAM, a), rpc(name, TEAM, a)]);
        compared++;
        if (!cam.ok || !team.ok) {
          bad++;
          console.log(`✗ ${rep} · ${label} · ${name}: CAM ${cam.ok ? "ok" : `${cam.status} ${cam.error}`}; team ${team.ok ? "ok" : `${team.status} ${team.error}`}`);
          continue;
        }
        const d = diff(cam.value, team.value);
        if (d.length) {
          bad++;
          console.log(`✗ ${rep} · ${label} · ${name}: ${d.length} differences\n    ${d.slice(0, 6).join("\n    ")}`);
        }
      }
    const q = await Promise.all([rpc("feed:repQuestions", CAM, { sales: rep }), rpc("feed:repQuestions", TEAM, { sales: rep })]);
    compared++;
    const dq = q[0].ok && q[1].ok ? diff(q[0].value, q[1].value) : ["call failed"];
    if (dq.length) {
      bad++;
      console.log(`✗ ${rep} · feed:repQuestions: ${dq.slice(0, 4).join("; ")}`);
    }
  }
  // the leaderboard: a rep sees every rep, so the CAM must too
  for (const [pid, label] of windows) {
    const [cam, team] = await Promise.all([rpc("geo:salesReps", CAM, { periodId: pid }), rpc("geo:salesReps", TEAM, { periodId: pid })]);
    compared++;
    const d = cam.ok && team.ok ? diff(cam.value, team.value) : ["call failed"];
    if (d.length) {
      bad++;
      console.log(`✗ leaderboard · ${label}: ${d.slice(0, 4).join("; ")}`);
    }
  }
  console.log(`\n${compared} comparisons, ${bad === 0 ? "no differences" : `${bad} with differences`}.`);

  // 2. the lock
  console.log("\nLock checks (each should be REFUSED):");
  const outsider = val("--outsider") ?? (await rpc("geo:salesReps", CAM, { periodId: "all" })).value?.map(r => r.name).find(n => !myReps.includes(n));
  const refused = [
    ["another rep's book", "repView:book", { periodId: "all", sales: outsider }],
    ["a team scope", "repView:book", { periodId: "all", sales: "team:*" }],
    ["no rep given", "repView:book", { periodId: "all" }],
    ["a team lead filter", "geo:geoSummary", { periodId: "all", teamLead: "x", sales: myReps[0] }],
    ["the company feed", "feed:feed", {}],
    ["the refresh", "refresh:refreshNow", {}],
  ];
  let leaks = 0;
  for (const [label, name, a] of refused) {
    const r = await rpc(name, CAM, a);
    const ok = !r.ok && (r.status === 403 || r.status === 404);
    if (!ok) leaks++;
    console.log(`  ${ok ? "✓ refused" : "✗ ALLOWED"}  ${label}${ok ? "" : `  (${name})`}`);
  }
  console.log(leaks ? `\n${leaks} lock check(s) FAILED: stop and tell Decision Intelligence before sharing logins.` : "\nThe lock holds.");
  process.exit(bad || leaks ? 1 : 0);
}
