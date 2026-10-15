/**
 * Shared-password verification for the RCA dashboard.
 *
 * The password is never shipped to the browser: callers send a candidate and
 * the server compares its SHA-256 against the configured digest.
 *
 * Rotate the password by setting the Convex environment variable
 * DASHBOARD_PASSWORD_SHA256 to the new sha256 hex digest
 * (`echo -n "newpass" | shasum -a 256`), or by editing DEFAULT_HASH below.
 */

// Fallback only; the live password is the Convex env var DASHBOARD_PASSWORD_SHA256.
const DEFAULT_HASH =
  "5df5fc8d0535049c19d728d7b2f1d0599c4e278a6755fa7d982b4e8518230fe8";

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function expectedHash(): string {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return (env?.DASHBOARD_PASSWORD_SHA256 ?? DEFAULT_HASH).trim().toLowerCase();
}

/** True when the supplied password matches the configured one. */
export async function verifyPassword(password: string): Promise<boolean> {
  return (await sha256Hex(stripUserTag(password))) === expectedHash();
}

/**
 * Team credentials may carry the signed-in work email so each person gets
 * their own date window (Shyam, 2026-09-30): `tu:<email>|<password>`.
 */
export const TEAM_USER_PREFIX = "tu:";
export function teamUserEmail(credential: string): string | null {
  if (!credential.startsWith(TEAM_USER_PREFIX)) return null;
  const i = credential.indexOf("|");
  if (i < 0) return null;
  return normalizeEmail(credential.slice(TEAM_USER_PREFIX.length, i));
}
export function stripUserTag(credential: string): string {
  if (!credential.startsWith(TEAM_USER_PREFIX)) return credential;
  const i = credential.indexOf("|");
  return i < 0 ? credential : credential.slice(i + 1);
}

/**
 * Separate admin password, used only to open the access log inside Settings.
 * Rotate with the Convex environment variable ADMIN_PASSWORD_SHA256.
 */
// sha256 of the current admin secret. The plaintext lives only with the
// dashboard owner and (optionally) in the Convex env var below — never in
// code, chat, or docs.
const DEFAULT_ADMIN_HASH =
  "8013a3a87973877ddbb65a947d0f5ed0a193a9d22878fafffa21c6b64be3c463";

export function expectedAdminHash(): string {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return (env?.ADMIN_PASSWORD_SHA256 ?? DEFAULT_ADMIN_HASH).trim().toLowerCase();
}

/** True when the supplied password matches the configured admin password. */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  return (await sha256Hex(password)) === expectedAdminHash();
}

/** Work-email domains allowed to unlock the dashboard. */
export const ALLOWED_EMAIL_DOMAINS = [
  "vibrant-wellness.com",
  "vibrant-america.com",
];

/** Normalizes and validates a work email; returns null when not allowed. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const domain = email.split("@")[1];
  return ALLOWED_EMAIL_DOMAINS.includes(domain) ? email : null;
}
