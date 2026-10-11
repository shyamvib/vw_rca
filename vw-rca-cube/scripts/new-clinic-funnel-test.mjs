import assert from "node:assert/strict";
import { newClinicFunnelGroups } from "../convex/newClinicFunnel.ts";

assert.deepEqual(newClinicFunnelGroups(1, 20), ["f1", "f2drop"]);
assert.deepEqual(newClinicFunnelGroups(2, 20), ["f1", "f2", "f3drop"]);
assert.deepEqual(newClinicFunnelGroups(3, 20), ["f1", "f2", "f3", "f4drop"]);
assert.deepEqual(newClinicFunnelGroups(4, 13), ["f1", "f2", "f3", "active", "f4"]);
assert.deepEqual(newClinicFunnelGroups(4, 14), ["f1", "f2", "f3", "f4"]);
assert.deepEqual(newClinicFunnelGroups(0, 0), []);

const clinicOrderCounts = [1, 1, 2, 2, 3, 4, 1, 5];
const order1 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f1"),
).length;
const dropOff = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f2drop"),
).length;
const reachedOrder2 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f2"),
).length;
const order2 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f2"),
).length;
const dropOff3 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f3drop"),
).length;
const order3 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f3"),
).length;
const dropOff4 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f4drop"),
).length;
const order4 = clinicOrderCounts.filter(n =>
  newClinicFunnelGroups(n, 20).includes("f4"),
).length;
assert.equal(order1, dropOff + reachedOrder2);
assert.equal(order2, dropOff3 + order3);
assert.equal(order3, dropOff4 + order4);
console.log(`Funnel checks passed (O1=${order1}, O2=${order2}, O3=${order3}, O4=${order4}; drop-offs ${dropOff}/${dropOff3}/${dropOff4})`);
