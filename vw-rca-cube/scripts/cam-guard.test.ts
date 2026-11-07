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
  for (const name of ["feed:feed", "clinics:clinicDrill", "geo:teamLeads", "config:setRepWindow", "config:repWindow", "refresh:refreshNow", "insights:list", "plan:list", "clinics:cohortDriverSplit", "nope:nope"]) denied(name, { sales: "Ann" });
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
  denied("clinicalTouch:clinicalTouch", { clinic: "c1", provider: "Dr X" });
  denied("clinicalTouch:clinicalTouch", { provider: "Dr X" });
});

test("lists that cover other people are cut down to the CAM's reps", () => {
  const g = ok("geo:salesReps", { periodId: "all" });
  const rows = [{ name: "Ann" }, { name: "Zed" }, { name: "Bob" }];
  assert.deepEqual(g.filter?.(rows), [{ name: "Ann" }, { name: "Bob" }]);
  const p = ok("families:providerSearch", { term: "x" });
  assert.deepEqual((p.filter?.({ ready: true, rows: [{ sales: "Zed" }, { sales: "Ann" }] }) as { rows: unknown[] }).rows, [{ sales: "Ann" }]);
  denied("geo:salesReps", { periodId: "all", sales: "Ann" });
});

test("the guard does not mutate the caller's args", () => {
  const args = { password: "rs:x", periodId: "all", sales: "Ann" };
  guardCamCall("repView:book", args, scope);
  assert.deepEqual(args, { password: "rs:x", periodId: "all", sales: "Ann" });
});

test("buildCams pairs reps with their CAM and takes the CAM's email from their own row", () => {
  const users = [
    { id: "1", name: "Cam One", email: "Cam.One@vibrant-wellness.com", camId: "", camName: "", supervisor: "", active: true },
    { id: "2", name: "Ann", email: "a@x", camId: "1", camName: "Cam One", supervisor: "Lee", active: true },
    { id: "3", name: "Bob", email: "b@x", camId: "1", camName: "Cam One", supervisor: "Kim", active: true },
    { id: "4", name: "Gone", email: "g@x", camId: "1", camName: "Cam One", supervisor: "Kim", active: false },
    { id: "5", name: "Cy", email: "c@x", camId: "", camName: "", supervisor: "Kim", active: true },
  ];
  const cams = buildCams(users);
  assert.equal(cams.length, 1);
  assert.equal(cams[0].email, "cam.one@vibrant-wellness.com");
  assert.deepEqual(cams[0].reps.map(r => r.name), ["Bob", "Ann"]); // sorted by team lead (Kim, Lee)
});
