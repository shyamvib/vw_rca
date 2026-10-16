/**
 * Shared-password gate shown in front of the RCA dashboard.
 *
 * The password is verified server-side (convex/gate.ts) — only a "yes/no"
 * crosses the wire. A successful unlock is remembered in sessionStorage, so it
 * is asked again in a new browser session.
 */
import { Logo } from "@/components/Logo";
import { useConvex } from "convex/react";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { clearPw, pw, setEmail, setPw, setRepSession } from "./gatePw";
import "./rca.css";



const ALLOWED = ["vibrant-wellness.com", "vibrant-america.com"];

export function PasswordGate({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const [ok, setOk] = useState(
    () => pw() !== "",
  );
  const [value, setValue] = useState("");
  const [email, setEmailValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ok) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const clean = email.trim().toLowerCase();
    const domain = clean.split("@")[1] ?? "";
    if (!ALLOWED.includes(domain)) {
      setBusy(false);
      setError("Use your @vibrant-wellness.com or @vibrant-america.com email.");
      return;
    }
    try {
      // One sign-in for everyone: a rep account (email + own password) locks
      // the dashboard to that rep; otherwise the shared team password opens
      // the full view. The server decides which applies to this email.
      const res = await convex.mutation(api.repAuth.login, {
        email: clean,
        password: value,
        agent: navigator.userAgent,
      });
      if (res?.kind === "rep") {
        setPw(`rs:${res.token}`);
        setEmail(clean);
        setRepSession({ rep: res.rep, email: clean });
        setOk(true);
      } else if (res?.kind === "team") {
        // Tag the credential with the email so each person keeps their own
        // date window (Shyam, 2026-09-30).
        setPw(`tu:${clean}|${value}`);
        setEmail(clean);
        setRepSession(null);
        setOk(true);
      } else {
        clearPw();
        setRepSession(null);
        setError("That email and password don't match.");
      }
    } catch {
      setError("Could not check the password — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rca-gate">
      <div
        className="rca-gate-card"
        role="form"
        onKeyDown={event => {
          if (event.key === "Enter") void submit();
        }}
      >
        <div className="rca-gate-logo"><Logo tone="ink" height={30} /></div>
        <div className="rca-gate-eyebrow">Vibrant Wellness</div>
        <h1 className="rca-gate-title">Revenue RCA dashboard</h1>
        <p className="rca-gate-sub">
          Enter your work email and password to continue.
        </p>
        <input
          type="email"
          className="rca-gate-input"
          placeholder="you@vibrant-wellness.com"
          value={email}
          autoFocus
          onChange={e => setEmailValue(e.target.value)}
        />
        <input
          type="password"
          className="rca-gate-input"
          placeholder="Password"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <button
          className="rca-gate-btn"
          type="button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        {error ? <div className="rca-gate-error">{error}</div> : null}
      </div>
    </div>
  );
}
