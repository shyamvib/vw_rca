/**
 * Mirrors a verified rep session (from Convex) into the engine's in-memory db, so the handlers' own login check
 * (resolveRepToken: repSessions by token, repAccounts by email, both read with unique()) passes for the request.
 *
 * A page load fires many requests at once. Done independently, each finds no row and inserts one, leaving duplicates, and the next
 * unique() throws "found 4 documents". So the writes are run one at a time, and any duplicates already there are removed.
 */
type Row = { _id: string } & Record<string, unknown>;
export type MirrorDb = {
  query: (table: string) => { withIndex: (name: string, range: (q: any) => any) => { collect: () => Promise<Row[]> } };
  insert: (table: string, value: Record<string, unknown>) => Promise<unknown>;
  patch: (id: string, partial: Record<string, unknown>) => Promise<void>;
  delete: (id: string) => Promise<void>;
};
export type MirrorSession = { rep: string; email: string; all?: boolean };

let chain: Promise<unknown> = Promise.resolve();

export function mirrorRep(db: MirrorDb, credential: string, s: MirrorSession): Promise<void> {
  const run = chain.then(() => mirrorOne(db, credential, s));
  chain = run.catch(() => undefined); // one failure must not block the next request
  return run;
}

/** The one row for a lookup: keeps the first, deletes the rest. */
async function one(db: MirrorDb, table: string, index: string, field: string, value: string): Promise<Row | null> {
  const rows = await db.query(table).withIndex(index, q => q.eq(field, value)).collect();
  for (const extra of rows.slice(1)) await db.delete(extra._id);
  return rows[0] ?? null;
}

async function mirrorOne(db: MirrorDb, credential: string, s: MirrorSession): Promise<void> {
  const token = credential.slice(3);
  const now = Date.now();
  const sess = await one(db, "repSessions", "by_token", "token", token);
  if (sess) await db.patch(sess._id, { lastSeen: now, rep: s.rep, email: s.email });
  else await db.insert("repSessions", { token, email: s.email, rep: s.rep, createdAt: now, lastSeen: now });
  const acct = await one(db, "repAccounts", "by_email", "email", s.email);
  // `all` = a rep-view-only login that may open any rep's book: the handlers read it from this mirrored account.
  if (acct) await db.patch(acct._id, { rep: s.rep, allReps: s.all === true });
  else await db.insert("repAccounts", { email: s.email, rep: s.rep, allReps: s.all === true, salt: "", hash: "", createdAt: now, updatedAt: now });
}
