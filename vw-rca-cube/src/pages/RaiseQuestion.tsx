import { useState } from "react";
import { useRcaAction } from "@/lib/rca";
import { api } from "@/lib/api";
import { pw, email as gateEmail } from "./gatePw";

/**
 * "Raise a question" about a Business Feed card (2026-10-20). Creates a Jira issue through the engine (analytics/jira.ts) with
 * the card's question and fact attached, and shows the issue key with a link when it comes back.
 */
export type AskCard = { id: string; question: string; fact: string };

export function RaiseQuestion({ card, context, sales }: { card?: AskCard; context: string; sales?: string }) {
  const run = useRcaAction(api.feed.raiseQuestion);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ key?: string; url?: string } | null>(null);

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setState("sending");
    setErr("");
    try {
      const r = await run({ password: pw(), question: q, email: gateEmail() || undefined, context, card, sales });
      setDone({ key: r.key, url: r.url });
      setText("");
      setOpen(false);
      setState("idle");
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setErr(msg.replace(/^.*Uncaught Error:\s*/, "").slice(0, 200));
      setState("error");
    }
  };

  if (done)
    return (
      <div className="rq rq-done">
        Question raised{done.key ? <> as {done.url ? <a href={done.url} target="_blank" rel="noreferrer">{done.key}</a> : <b>{done.key}</b>}</> : ""}.{" "}
        <button type="button" className="rq-link" onClick={() => setDone(null)}>Ask another</button>
      </div>
    );
  if (!open)
    return (
      <div className="rq">
        <button type="button" className="rq-open" onClick={() => setOpen(true)}>Raise a question</button>
      </div>
    );
  return (
    <div className="rq rq-form">
      <label className="rq-l" htmlFor={`rq-${card?.id ?? "x"}`}>{card ? "Your question about this card" : "Your question"}</label>
      <textarea id={`rq-${card?.id ?? "x"}`} rows={3} value={text} maxLength={4000} onChange={e => setText(e.target.value)} placeholder="What do you want to know or have checked?" />
      <div className="rq-row">
        <button type="button" className="rq-send" disabled={state === "sending" || !text.trim()} onClick={send}>{state === "sending" ? "Sending…" : "Send"}</button>
        <button type="button" className="rq-link" onClick={() => { setOpen(false); setState("idle"); setErr(""); }}>Cancel</button>
        {state === "error" ? <span className="rq-err" role="alert">{err || "Could not send. Try again."}</span> : null}
      </div>
    </div>
  );
}
