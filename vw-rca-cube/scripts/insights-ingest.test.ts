// Run with: npx tsx --test scripts/insights-ingest.test.ts   (or: bun test scripts/insights-ingest.test.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingest } from "../convex/insights";

type Row = Record<string, any>;
/** An in-memory stand-in for ctx.db that FAILS on a full-table filter and counts how many documents each call reads. */
function fakeDb(seed: Row[]) {
  const rows: Row[] = seed.map((r, i) => ({ _id: `id${i}`, ...r }));
  let n = rows.length, reads = 0;
  return {
    rows,
    get reads() { return reads; },
    db: {
      query: (_t: string) => ({
        withIndex: (name: string, range: (q: any) => any) => {
          assert.equal(name, "by_date");
          let value = "";
          range({ eq: (_f: string, v: string) => { value = v; return {}; } });
          return { collect: async () => { const hit = rows.filter(r => r.date === value); reads += hit.length; return hit; } };
        },
        filter: () => { throw new Error("full-table scan: this is what blew Convex's read limit"); },
      }),
      insert: async (_t: string, doc: Row) => { const _id = `id${n++}`; rows.push({ _id, ...doc }); return _id; },
      get: async (id: string) => rows.find(r => r._id === id) ?? null,
      patch: async (id: string, p: Row) => { Object.assign(rows.find(r => r._id === id)!, p); },
    },
  };
}
const run = (ctx: any, rows: Row[]) => (ingest as any)._handler(ctx, { rows });
const card = (insightId: string, date: string, extra: Row = {}) => ({ insightId, date, fact: "f", action: "auto", status: "Monitoring", createdAt: 1, edited: [], ...extra });

test("inserts new cards and updates existing ones, reading only the batch's own dates", async () => {
  // a table far bigger than one day: 5,000 cards across 200 dates
  const old = Array.from({ length: 5000 }, (_, i) => card(`REV-d${i % 200}-${i}`, `2026-01-${String((i % 200) + 1).padStart(3, "0")}`));
  const f = fakeDb([...old, card("REV-2026-1109-001", "2026-11-09", { fact: "old fact", action: "my edit", edited: ["action"] })]);
  const out = await run({ db: f.db }, [
    card("REV-2026-1109-001", "2026-11-09", { fact: "new fact", action: "auto again" }),
    card("REV-2026-1109-002", "2026-11-09", { fact: "brand new" }),
  ]);
  assert.deepEqual(out, { inserted: 1, updated: 1 });
  const upd = f.rows.find(r => r.insightId === "REV-2026-1109-001")!;
  assert.equal(upd.fact, "new fact");      // auto field refreshed
  assert.equal(upd.action, "my edit");     // a hand-edited field is never overwritten
  assert.equal(upd.createdAt, 1);          // createdAt is kept
  assert.ok(f.rows.some(r => r.insightId === "REV-2026-1109-002"));
  assert.ok(f.reads <= 5, `read ${f.reads} documents; it must read only that date's cards, not the table`);
});

test("a repeat of the same batch is idempotent, and two new cards in one batch are not inserted twice", async () => {
  const f = fakeDb([]);
  const batch = [card("A-1", "2026-11-09"), card("A-2", "2026-11-09"), card("A-1", "2026-11-09", { fact: "again" })];
  assert.deepEqual(await run({ db: f.db }, batch), { inserted: 2, updated: 1 });
  assert.deepEqual(await run({ db: f.db }, batch), { inserted: 0, updated: 3 });
  assert.equal(f.rows.length, 2);
});
