// Run with: node --experimental-strip-types --test scripts/announcements.test.ts   (or: bun test scripts/announcements.test.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNOUNCEMENTS, FZ_ANNOUNCEMENT_ID, FZ_OVERVIEW_ANNOUNCEMENT_ID, announcementsFor, formatAnnouncementDate, hasUnseenAnnouncement, latestAnnouncementId, offersAction } from "../src/lib/announcements.ts";

test("the list is well formed: unique ids, real dates, newest first, something to read", () => {
  const ids = ANNOUNCEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const a of ANNOUNCEMENTS) {
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/, a.id);
    assert.ok(!Number.isNaN(Date.parse(`${a.date}T00:00:00Z`)), `${a.id} has a real date`);
    assert.ok(a.title.trim() && a.summary.trim() && a.points.length > 0, `${a.id} has text`);
  }
  const dates = ANNOUNCEMENTS.map(a => a.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
});

test("the Today's agenda banner announces an entry that exists", () => {
  assert.ok(ANNOUNCEMENTS.some(a => a.id === FZ_ANNOUNCEMENT_ID));
});

test("dates read as plain dates", () => {
  assert.equal(formatAnnouncementDate("2026-11-09"), "Nov 9, 2026");
  assert.equal(formatAnnouncementDate("2026-01-03"), "Jan 3, 2026");
  assert.equal(formatAnnouncementDate("not a date"), "not a date");
});

test("the unread dot shows until the newest announcement has been opened", () => {
  const latest = latestAnnouncementId();
  assert.equal(hasUnseenAnnouncement(null), true);                    // never opened
  assert.equal(hasUnseenAnnouncement("gz-find-clinics"), true);       // opened an older one
  assert.equal(hasUnseenAnnouncement(latest), false);                 // up to date
  assert.equal(hasUnseenAnnouncement(null, []), false);               // nothing to announce
});

test("each place gets its own list, newest first, and its own banner entry", () => {
  const rep = announcementsFor("rep"), ov = announcementsFor("overview");
  assert.ok(rep.some(a => a.id === FZ_ANNOUNCEMENT_ID) && !rep.some(a => a.id === FZ_OVERVIEW_ANNOUNCEMENT_ID));
  assert.ok(ov.some(a => a.id === FZ_OVERVIEW_ANNOUNCEMENT_ID));
  // the Overview's list has everything the rep view has, plus its own entry
  for (const a of rep) assert.ok(ov.some(x => x.id === a.id), `${a.id} is in both`);
  for (const list of [rep, ov]) {
    const d = list.map(a => a.date);
    assert.deepEqual(d, [...d].sort().reverse());
  }
});

test("buttons into the rep view are offered only in the rep view; an entry made for a place offers its own", () => {
  const shared = ANNOUNCEMENTS.find(a => a.id === "this-last-toggle")!;
  assert.equal(offersAction(shared, "rep"), true);
  assert.equal(offersAction(shared, "overview"), false);
  const own = ANNOUNCEMENTS.find(a => a.id === FZ_OVERVIEW_ANNOUNCEMENT_ID)!;
  assert.equal(offersAction(own, "overview"), true);
  assert.equal(offersAction(own, "rep"), false);
});

test("the unread dot is per place", () => {
  const rep = announcementsFor("rep"), ov = announcementsFor("overview");
  assert.equal(hasUnseenAnnouncement(latestAnnouncementId(rep), rep), false);
  // someone who has read everything in the rep view has not read the Overview's newer entry
  assert.equal(hasUnseenAnnouncement(latestAnnouncementId(rep), ov), true);
});

test("every entry names its page, reps never get Overview-only updates, and the Overview lists everything", () => {
  for (const a of ANNOUNCEMENTS) assert.ok(a.pages.length > 0 && a.pages.every(p => p === "overview" || p === "rep"), `${a.id} names its page`);
  const rep = announcementsFor("rep"), ov = announcementsFor("overview");
  assert.ok(rep.every(a => a.pages.includes("rep")), "the rep view lists only rep view updates");
  assert.ok(!rep.some(a => a.pages.length === 1 && a.pages[0] === "overview"), "no Overview-only update reaches reps");
  assert.equal(ov.length, ANNOUNCEMENTS.length, "the Overview lists all of them");
});

test("a tour button is offered only on the page its entry belongs to", () => {
  const repEntry = ANNOUNCEMENTS.find(a => a.id === FZ_ANNOUNCEMENT_ID)!;
  assert.equal(offersAction(repEntry, "rep"), true);
  assert.equal(offersAction(repEntry, "overview"), false); // the Overview's tour would not walk through the rep view's agenda
});
