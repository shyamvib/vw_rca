#!/usr/bin/env node
/**
 * Client account manager (CAM) logins, in bulk.
 *
 * Reads the CAMs and their paired salespeople from the analytics service (which reads Cube's internal_user), prints them,
 * and, only with --create, makes a rep-view-only login for each CAM that has a work email, with a generated one-time
 * password. Nothing is created without --create, and no password is printed to the screen or stored in the repo.
 *
 *   SERVICE_URL=https://<engine-url> ADMIN_SECRET=... node scripts/cam-logins.mjs              # list only
 *   SERVICE_URL=... ADMIN_SECRET=... node scripts/cam-logins.mjs --create --out ~/cam-logins.csv [--prod]
 *
 * --prod is passed to `npx convex run` (production deployment); without it, the deployment the CLI is pointed at is used.
 * An account that already exists keeps its password (only its CAM flag is set); it is not listed in the CSV. Re-run is safe.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const SERVICE_URL = (process.env.SERVICE_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.ADMIN_SECRET ?? "";
if (!SERVICE_URL || !SECRET) {
  console.error("Set SERVICE_URL (the analytics service URL) and ADMIN_SECRET.");
  process.exit(1);
}
const out = val("--out");
if (has("--create") && !out) {
  console.error("--create needs --out <file.csv>: that is where the one-time passwords go.");
  process.exit(1);
}

const res = await fetch(`${SERVICE_URL}/admin/cams`, { headers: { "x-admin-secret": SECRET } });
if (!res.ok) {
  console.error(`The service answered ${res.status}. Check SERVICE_URL and ADMIN_SECRET, and that the service is running the CAM build.`);
  process.exit(1);
}
const { cams } = await res.json();

console.log(`${cams.length} client account managers in Cube\n`);
for (const c of cams) {
  const leads = [...new Set(c.reps.map(r => r.teamLead || "—"))];
  console.log(`${c.name.padEnd(28)} ${(c.email || "(no email found)").padEnd(40)} ${String(c.reps.length).padStart(3)} reps · team leads: ${leads.join(", ")}`);
}
if (!has("--create")) {
  console.log("\nList only. Add --create --out <file.csv> to make the logins.");
  process.exit(0);
}

const password = () => randomBytes(12).toString("base64url"); // 16 characters
const run = payload => {
  const cli = ["convex", "run", "repAuth:adminUpsert", JSON.stringify(payload), ...(has("--prod") ? ["--prod"] : [])];
  const text = execFileSync("npx", cli, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(text.trim().split("\n").filter(l => l.trim().startsWith("{")).pop() ?? "{}");
};

const rows = [["name", "email", "one_time_password", "reps"]];
const skipped = [];
for (const c of cams) {
  if (!c.email) {
    skipped.push(`${c.name}: no email in Cube`);
    continue;
  }
  const base = { email: c.email, rep: c.name, cam: true };
  const first = run(base); // no password: updates an existing account, or says a new one needs one
  if (first.ok) {
    console.log(`kept   ${c.email} (account exists; password unchanged)`);
    continue;
  }
  if (!/Password needs/.test(first.error ?? "")) {
    skipped.push(`${c.name} <${c.email}>: ${first.error}`);
    continue;
  }
  const pw = password();
  const made = run({ ...base, password: pw });
  if (made.ok) {
    rows.push([c.name, c.email, pw, c.reps.length]);
    console.log(`made   ${c.email}`);
  } else skipped.push(`${c.name} <${c.email}>: ${made.error}`);
}

if (rows.length > 1) {
  writeFileSync(out, rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n");
  chmodSync(out, 0o600);
  console.log(`\n${rows.length - 1} new logins. One-time passwords are in ${out} (owner-only). Share them privately, then delete the file.`);
} else console.log("\nNo new logins to write.");
if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
