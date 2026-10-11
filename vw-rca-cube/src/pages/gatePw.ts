/**
 * The shared dashboard password for the current browser session.
 *
 * The Space itself is open, so this password is what authorizes every Convex
 * data call — PasswordGate stores it here after a successful unlock and each
 * call passes it along.
 */
export const PW_KEY = "vw-rca-pw";

export function pw(): string {
  try {
    return sessionStorage.getItem(PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPw(value: string) {
  try {
    sessionStorage.setItem(PW_KEY, value);
  } catch {
    /* private mode — the session simply won't be remembered */
  }
}

export function clearPw() {
  try {
    sessionStorage.removeItem(PW_KEY);
  } catch {
    /* ignore */
  }
}

/** The work email captured at the gate (attribution only). */
export const EMAIL_KEY = "vw-rca-email";

export function email(): string {
  try {
    return sessionStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setEmail(value: string) {
  try {
    sessionStorage.setItem(EMAIL_KEY, value);
  } catch {
    /* ignore */
  }
}

/**
 * Rep login (Shyam, 2026-09-25). When set, `pw()` holds a `rs:` session token
 * instead of the shared password and the dashboard is locked to this rep.
 */
export const REP_KEY = "vw-rca-rep";

export type RepSession = { rep: string; email: string };

export function repSession(): RepSession | null {
  try {
    const raw = sessionStorage.getItem(REP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RepSession;
    return parsed?.rep ? parsed : null;
  } catch {
    return null;
  }
}

export function setRepSession(value: RepSession | null) {
  try {
    if (value) sessionStorage.setItem(REP_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(REP_KEY);
  } catch {
    /* ignore */
  }
}

/** Forget everything and show the gate again. */
export function signOut() {
  clearPw();
  setRepSession(null);
  try {
    sessionStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}
