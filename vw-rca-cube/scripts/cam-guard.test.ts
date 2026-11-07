// Run with: node --experimental-strip-types --test scripts/cam-guard.test.ts   (or: bun test scripts/cam-guard.test.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { CamDenied, guardCamCall } from "../engine/camGuard.ts";
import { buildCams } from "../engine/cams.ts";

const owners: Record<string, string> = { c1: "Ann", c2: "Bob", c9: "Zed" };
const scope = { reps: new Set(["Ann", "Bob"]), ownerOf: (c: string) => owners[c] };
const denied = (name: string, args: Record<string, unknown>) => assert.throws(() => guardCamCall(name, { password: "rs:x", ...args }, scope), CamDenied);
const ok = (name: string, args: Record<string, unknown>) => guardCamCall(name, { password: "rs:x", ...args }, scope);

test("a rep's book: only the CAM's own reps", () => {
  assert.equal(ok("repView:book", { periodId: "all", sales: "Ann" }).args.sales, "Ann");
  denied("repView:book", { periodId: "all", sales: "Zed" });
  denied("repView:book", { periodId: "all" });
  denied("repView:book", { periodId: "all", sales: "" });
  denied("repView:book", { periodId: "all", sales: "team:*" });
  denied("repView:book", { periodId: "all", sales: "team:Ann" });
});

test("teamLead is refused on every call", () => {
  denied("repView:book", { periodId: "all", sales: "Ann", teamLead: "Lee" });
  denied("geo:salesReps", { periodId: "all", teamLead: "Lee" });
  denied("config:get", { teamLead: "*" });
});

test("anything not listed is refused", () => {
  for (const name of ["feed:feed", "geo:teamLeads", "config:setRepWindow", "config:repWindow", "refresh:refreshNow", "insights:list", "plan:list", "nope:nope"]) denied(name, { sales: "Ann" });
});

test("clinic lookups need a clinic in the CAM's reps' books", () => {
  ok("families:portfolioAction", { clinic: "c1", periodId: "all" });
  denied("families:portfolioAction", { clinic: "c9", periodId: "all" });
  denied("families:portfolioAction", { clinic: "unknown", periodId: "all" });
  denied("families:portfolioAction", { periodId: "all" });
  ok("newClinicTouches:newClinicTouches", { clinics: ["c1", "c2"] });
  denied("newClinicTouches:newClinicTouches", { clinics: ["c1", "c9"] });
  denied("newClinicTouches:newClinicTouches", { clinics: "c1" });
  ok("clinicalTouch:clinicalTouch", { clinic: "c1" });
  denied("clinicalTouch:clinicalTouch", { clinic: "c9" });
  denied("clinicalTouch:clinicalTouch", {}); // neither a clinic nor a provider
});

test("provider search is cut down to the CAM's reps; the leaderboard is whole, as a rep sees it", () => {
  const p = ok("families:providerSearch", { term: "x" });
  assert.deepEqual((p.filter?.({ ready: true, rows: [{ sales: "Zed" }, { sales: "Ann" }] }) as { rows: unknown[] }).rows, [{ sales: "Ann" }]);
  // Same rows a rep login gets: no filter, so every rank and total matches the rep's own view.
  const g = ok("geo:salesReps", { periodId: "all" });
  assert.equal(g.filter, undefined);
  denied("geo:salesReps", { periodId: "all", sales: "Ann" });
  denied("geo:salesReps", { periodId: "all", teamLead: "Lee" });
});

test("the page's first call carries the CAM's rep list for the picker", () => {
  const withList = { ...scope, repList: [{ name: "Ann", teamLead: "Lee" }, { name: "Bob", teamLead: "Kim" }] };
  const g = guardCamCall("bridge:bridge", { password: "rs:x" }, withList);
  const out = g.filter?.({ ready: true, periods: [] }) as { ready: boolean; camReps: Array<{ name: string }> };
  assert.equal(out.ready, true);
  assert.deepEqual(out.camReps.map(r => r.name), ["Ann", "Bob"]);
});

test("the guard does not mutate the caller's args", () => {
  const args = { password: "rs:x", periodId: "all", sales: "Ann" };
  guardCamCall("repView:book", args, scope);
  assert.deepEqual(args, { password: "rs:x", periodId: "all", sales: "Ann" });
});

test("buildCams pairs a CAM with the reps whose orders carry their id, and takes the CAM's email from their own row", () => {
  const users = [
    { id: "1", name: "Cam One", email: "Cam.One@vibrant-wellness.com" },
    { id: "2", name: "Ann", email: "a@x" },
    { id: "3", name: "Bob", email: "b@x" },
    { id: "4", name: "Cy", email: "c@x" },
  ];
  const pairs = [
    { salesId: "2", camId: "1", teamLead: "Lee", orders: 90 },
    { salesId: "2", camId: "9", teamLead: "Lee", orders: 10 }, // a stray 10% share, and an unknown CAM id
    { salesId: "3", camId: "1", teamLead: "Kim", orders: 40 },
    { salesId: "3", camId: "", teamLead: "Kim", orders: 60 }, // orders with no CAM
    { salesId: "4", camId: "1", teamLead: "Kim", orders: 2 }, // 2 of 100: too small a share
    { salesId: "4", camId: "", teamLead: "Kim", orders: 98 },
  ];
  const cams = buildCams(users, pairs);
  assert.equal(cams.length, 1);
  assert.equal(cams[0].email, "cam.one@vibrant-wellness.com");
  assert.deepEqual(cams[0].reps.map(r => r.name), ["Bob", "Ann"]); // sorted by team lead (Kim, Lee); Cy's 2% is not enough
});

test("a CAM id with no internal_user row is paired only when an override names it", () => {
  const users = [{ id: "2", name: "Sara", email: "s@x" }, { id: "3", name: "William", email: "w@x" }];
  const pairs = [
    { salesId: "2", camId: "1541", teamLead: "Suzi", orders: 509 },
    { salesId: "3", camId: "1541", teamLead: "Suzi", orders: 1573 },
  ];
  assert.equal(buildCams(users, pairs).length, 0);
  const cams = buildCams(users, pairs, 0.25, { "1541": { name: "Akanksha Sharma", email: "Akanksha.S@vibrant-wellness.com" } });
  assert.equal(cams.length, 1);
  assert.equal(cams[0].email, "akanksha.s@vibrant-wellness.com");
  assert.deepEqual(cams[0].reps.map(r => r.name), ["Sara", "William"]);
});

test("the dashboard shell's whole-book calls need one of the CAM's reps", () => {
  for (const name of ["clinics:cohortDriverSplit", "geo:geoSummary", "wins:winsSummary"]) {
    ok(name, { periodId: "all", sales: "Ann" });
    denied(name, { periodId: "all" }); // no rep chosen yet: the frontend skips these calls
    denied(name, { periodId: "all", sales: "Zed" });
  }
});

test("clinic search runs once per paired rep and merges the hits", () => {
  const g = ok("feed:clinicSearch", { term: "smith" });
  assert.deepEqual(g.calls?.map(c => c.sales).sort(), ["Ann", "Bob"]);
  assert.ok(g.calls?.every(c => c.term === "smith" && c.password === "rs:x"));
  const merged = g.merge?.([
    { ready: true, matches: [{ delta: -5, clinic: "a" }, { delta: -1, clinic: "b" }] },
    { ready: false, matches: [{ delta: -9, clinic: "c" }] },
  ]) as { ready: boolean; matches: Array<{ clinic: string }> };
  assert.equal(merged.ready, true);
  assert.deepEqual(merged.matches.map(m => m.clinic), ["c", "a", "b"]);
  // The caller cannot aim the search at a rep, or at anyone outside the CAM's reps.
  denied("feed:clinicSearch", { term: "smith", sales: "Zed" });
  denied("feed:clinicSearch", { term: "smith", sales: "Ann" });
});

test("a provider card opens only when every rep on the provider's orders is the CAM's", () => {
  const owned: Record<string, string[]> = { "100": ["Ann"], "101": ["Ann", "Bob"], "102": ["Ann", "Zed"], "103": ["?"], "104": [] };
  const s = { ...scope, providerOwners: (p: string) => owned[p] };
  const call = (args: Record<string, unknown>) => guardCamCall("clinicalTouch:clinicalTouch", { password: "rs:x", ...args }, s);
  call({ provider: "100" });
  call({ provider: "101" });
  for (const p of ["102", "103", "104", "999"]) assert.throws(() => call({ provider: p }), CamDenied);
  assert.throws(() => call({ provider: "100", clinic: "c9" }), CamDenied); // an owned provider does not make a foreign clinic ok
});

test("the page's first call and the rep panels", () => {
  ok("bridge:bridge", {});
  denied("bridge:bridge", { teamLead: "Lee" });
  for (const name of ["clinics:clinicDrill", "clinics:newClinicGroups", "families:familyClinicsAction", "families:switchClinicsAction"]) {
    ok(name, { periodId: "all", sales: "Bob" });
    denied(name, { periodId: "all" });
    denied(name, { periodId: "all", sales: "Zed" });
    denied(name, { periodId: "all", sales: "Ann", teamLead: "Lee" });
  }
  denied("families:unmappedTestsAction", { periodId: "all" }); // team only
});

test("mirroring a session from many parallel requests leaves one session and one account", async () => {
  const { mirrorRep } = await import("../engine/mirror.ts");
  // A slow in-memory db: every call yields first, as real I/O would, so unserialised callers interleave.
  const tables: Record<string, Array<Record<string, any>>> = { repSessions: [], repAccounts: [] };
  let n = 0;
  const tick = () => new Promise(r => setImmediate(r));
  const db = {
    query: (table: string) => ({ withIndex: (_: string, range: (q: any) => any) => {
      let field = "", value = "";
      range({ eq: (f: string, v: string) => { field = f; value = v; return {}; } });
      return { collect: async () => { await tick(); return tables[table].filter(r => r[field] === value); } };
    } }),
    insert: async (table: string, v: Record<string, unknown>) => { await tick(); tables[table].push({ ...v, _id: `id${++n}` }); },
    patch: async (id: string, p: Record<string, unknown>) => { await tick(); for (const t of Object.values(tables)) for (const r of t) if (r._id === id) Object.assign(r, p); },
    delete: async (id: string) => { await tick(); for (const k of Object.keys(tables)) tables[k] = tables[k].filter(r => r._id !== id); },
  };
  const s = { rep: "Cam One", email: "cam@x", all: true };
  await Promise.all(Array.from({ length: 8 }, () => mirrorRep(db, "rs:tok", s)));
  assert.equal(tables.repSessions.length, 1);
  assert.equal(tables.repAccounts.length, 1);
  assert.equal(tables.repAccounts[0].allReps, true);
  // and duplicates left behind by an older build are cleaned up on the next mirror
  tables.repAccounts.push({ _id: "dup1", email: "cam@x" }, { _id: "dup2", email: "cam@x" });
  await mirrorRep(db, "rs:tok", s);
  assert.equal(tables.repAccounts.length, 1);
});

test("cam-compare's diff finds real differences and ignores rounding and per-request fields", async () => {
  const { diff } = await import("./cam-compare.mjs");
  assert.deepEqual(diff({ a: 1, b: [1, 2], at: 5 }, { a: 1, b: [1, 2], at: 9 }), []);
  assert.deepEqual(diff({ a: 100 }, { a: 100.0000000001 }), []);
  assert.equal(diff({ a: 100 }, { a: 101 }).length, 1);
  assert.equal(diff({ rows: [{ x: 1 }] }, { rows: [{ x: 1 }, { x: 2 }] }).length, 1);
  assert.equal(diff({ n: "a" }, { n: "b" }).length, 1);
});

test("a ticket raised by a CAM is stamped with the CAM's name, and the browser cannot choose it", () => {
  const sc = { ...scope, camName: "Cam One" };
  const g = guardCamCall("feed:raiseQuestion", { password: "rs:x", question: "q", sales: "Ann", asCam: "Someone Else" }, sc);
  assert.equal(g.args.asCam, "Cam One");
  const none = guardCamCall("feed:raiseQuestion", { password: "rs:x", question: "q", sales: "Ann", asCam: "Spoof" }, scope);
  assert.equal("asCam" in none.args, false);
  denied("feed:raiseQuestion", { question: "q", sales: "Zed" });
});
