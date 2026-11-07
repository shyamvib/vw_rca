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
 * From a list you already have (one CAM per line, a name then a work email; no service needed), in two steps:
 *   node scripts/cam-logins.mjs --list cams.txt --generate --out ~/cam-logins.csv   # passwords only, nothing is created
 *   node scripts/cam-logins.mjs --apply ~/cam-logins.csv --prod                      # create the accounts from that file
 *
 * --prod is passed to `npx convex run` (production deployment); without it, the deployment the CLI is pointed at is used.
 * With --create, an account that already exists keeps its password (only its CAM flag is set) and is not listed in the CSV. With --apply, the CSV's
 * password is set even on an existing account.
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const SERVICE_URL = (process.env.SERVICE_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.ADMIN_SECRET ?? "";
const out = val("--out");

// Readable one-time passwords: 12 characters from an alphabet without look-alikes (0/O, 1/l/I), shown as 3 groups of 4.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const password = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

const csv = rows => rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
const writeOwnerOnly = (file, rows) => {
  writeFileSync(file, csv(rows));
  chmodSync(file, 0o600);
};
const parseCsv = text =>
  text.trim().split("\n").map(l => [...l.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map(m => (m[1] ?? m[2]).replace(/""/g, '"').trim()));

const run = payload => {
  const cli = ["convex", "run", "repAuth:adminUpsert", JSON.stringify(payload), ...(has("--prod") ? ["--prod"] : [])];
  const text = execFileSync("npx", cli, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(text.trim().split("\n").filter(l => l.trim().startsWith("{")).pop() ?? "{}");
};

/** Creates the account, or (when it exists) only sets its CAM flag. Returns "made" | "kept" | an error string. */
const upsert = (name, email, pw) => {
  const base = { email, rep: name, cam: true };
  if (pw) {
    const made = run({ ...base, password: pw });
    return made.ok ? "made" : made.error ?? "failed";
  }
  const first = run(base); // no password: updates an existing account, or says a new one needs one
  return first.ok ? "kept" : /Password needs/.test(first.error ?? "") ? "new" : first.error ?? "failed";
};

// ---- apply: create the accounts listed in a CSV made by --generate ---------------------------------------------------
if (has("--apply")) {
  const [, ...rows] = parseCsv(readFileSync(val("--apply"), "utf8"));
  let made = 0;
  const problems = [];
  for (const [name, email, pw] of rows) {
    const r = upsert(name, email, pw);
    if (r === "made") {
      made++;
      console.log(`made   ${email}`);
    } else problems.push(`${name} <${email}>: ${r}`);
  }
  console.log(`\n${made} of ${rows.length} accounts created.`);
  if (problems.length) console.log(`Problems:\n  ${problems.join("\n  ")}`);
  console.log("Note: --apply sets the password in the CSV even for an email that already had an account (and signs that person out).");
  process.exit(problems.length ? 1 : 0);
}

// ---- where the CAMs come from: a list file, or the analytics service (Cube) ---------------------------------------------
let cams;
if (val("--list")) {
  // One per line: a name, then a work email (anything else on the line, such as blank columns, is ignored).
  cams = readFileSync(val("--list"), "utf8")
    .split("\n")
    .map(l => {
      const email = l.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
      const name = email ? l.slice(0, l.indexOf(email)).trim() : "";
      return email && name ? { name, email: email.toLowerCase(), reps: [] } : null;
    })
    .filter(Boolean);
  console.log(`${cams.length} CAMs in ${val("--list")}\n`);
  for (const c of cams) console.log(`${c.name.padEnd(28)} ${c.email}`);
} else {
  if (!SERVICE_URL || !SECRET) {
    console.error("Set SERVICE_URL (the analytics service URL) and ADMIN_SECRET, or pass --list <file>.");
    process.exit(1);
  }
  const res = await fetch(`${SERVICE_URL}/admin/cams`, { headers: { "x-admin-secret": SECRET } });
  if (!res.ok) {
    console.error(`The service answered ${res.status}. Check SERVICE_URL and ADMIN_SECRET, and that the service is running the CAM build.`);
    process.exit(1);
  }
  cams = (await res.json()).cams;
  console.log(`${cams.length} client account managers in Cube\n`);
  for (const c of cams) {
    const leads = [...new Set(c.reps.map(r => r.teamLead || "—"))];
    console.log(`${c.name.padEnd(28)} ${(c.email || "(no email found)").padEnd(40)} ${String(c.reps.length).padStart(3)} reps · team leads: ${leads.join(", ")}`);
  }
}

if (!has("--create") && !has("--generate")) {
  console.log("\nList only. Add --generate --out <file.csv> (passwords only) or --create --out <file.csv> (make the logins).");
  process.exit(0);
}
if (!out) {
  console.error("--generate / --create need --out <file.csv>: that is where the one-time passwords go.");
  process.exit(1);
}

const rows = [["name", "email", "one_time_password", "reps"]];
const skipped = [];
for (const c of cams) {
  if (!c.email) {
    skipped.push(`${c.name}: no email`);
    continue;
  }
  if (has("--generate")) {
    rows.push([c.name, c.email, password(), c.reps.length]);
    continue;
  }
  const pw = password();
  const r = upsert(c.name, c.email, null);
  if (r === "kept") console.log(`kept   ${c.email} (account exists; password unchanged)`);
  else if (r !== "new") skipped.push(`${c.name} <${c.email}>: ${r}`);
  else {
    const made = upsert(c.name, c.email, pw);
    if (made === "made") {
      rows.push([c.name, c.email, pw, c.reps.length]);
      console.log(`made   ${c.email}`);
    } else skipped.push(`${c.name} <${c.email}>: ${made}`);
  }
}

if (rows.length > 1) {
  writeOwnerOnly(out, rows);
  console.log(`\n${rows.length - 1} ${has("--generate") ? "passwords generated (nothing created yet)" : "new logins"}. One-time passwords are in ${out} (owner-only). Share them privately, then delete the file.`);
} else console.log("\nNothing to write.");
if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
