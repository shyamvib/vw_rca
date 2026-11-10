// Run with: npx tsx --test scripts/banners.test.ts   (or: bun test scripts/banners.test.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { dismissBanner, isBannerAdmin, listDismissed, restoreBanner } from "../convex/banners";

type Row = Record<string, any>;
/** An in-memory appMeta: the same calls the module makes (collect, by_key lookup, insert, patch, delete). */
function fakeDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((r, i) => ({ _id: `id${i}`, ...r }));
  let n = rows.length;
  const db: any = {
    query: (_t: string) => ({
      collect: async () => [...rows],
      withIndex: (_name: string, range: (q: any) => any) => {
        let key = "";
        range({ eq: (_f: string, v: string) => { key = v; return {}; } });
        return { unique: async () => rows.find(r => r.key === key) ?? null };
      },
    }),
    insert: async (_t: string, doc: Row) => { const _id = `id${n++}`; rows.push({ _id, ...doc }); return _id; },
    patch: async (id: string, p: Row) => { Object.assign(rows.find(r => r._id === id)!, p); },
    delete: async (id: string) => { rows.splice(rows.findIndex(r => r._id === id), 1); },
  };
  return { rows, db };
}

test("a banner is shown until it is dismissed, and dismissing hides it for everyone who asks", async () => {
  const f = fakeDb([{ key: "serviceUrl", value: "https://x.trycloudflare.com", updatedAt: 1 }]);
  assert.deepEqual(await listDismissed(f.db), []);
  await dismissBanner(f.db, "fz-cross-sell", "admin@vibrant-wellness.com");
  assert.deepEqual(await listDismissed(f.db), ["fz-cross-sell"]);
  assert.equal(JSON.parse(f.rows.find(r => r.key === "banner-dismissed:fz-cross-sell")!.value).by, "admin@vibrant-wellness.com");
});

test("dismissing twice keeps one record, and other settings are never listed or touched", async () => {
  const f = fakeDb([{ key: "serviceUrl", value: "https://x.trycloudflare.com", updatedAt: 1 }]);
  await dismissBanner(f.db, "a");
  await dismissBanner(f.db, "a");
  await dismissBanner(f.db, "b");
  assert.deepEqual((await listDismissed(f.db)).sort(), ["a", "b"]);
  assert.equal(f.rows.filter(r => r.key === "banner-dismissed:a").length, 1);
  assert.equal(f.rows.find(r => r.key === "serviceUrl")!.value, "https://x.trycloudflare.com");
});

test("restoring shows the banner again, and restoring one that was never dismissed changes nothing", async () => {
  const f = fakeDb();
  await dismissBanner(f.db, "a");
  await restoreBanner(f.db, "a");
  assert.deepEqual(await listDismissed(f.db), []);
  await restoreBanner(f.db, "never-dismissed");
  assert.deepEqual(await listDismissed(f.db), []);
});

test("only listed emails are banner admins, whatever the case, and no email means no", () => {
  assert.equal(isBannerAdmin("shyam.n@vibrant-wellness.com"), true);
  assert.equal(isBannerAdmin("  Shyam.N@Vibrant-Wellness.com "), true);
  assert.equal(isBannerAdmin("someone.else@vibrant-wellness.com"), false);
  assert.equal(isBannerAdmin(""), false);
  assert.equal(isBannerAdmin(undefined), false);
});
