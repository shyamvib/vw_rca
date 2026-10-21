import { useEffect, useRef, useState } from "react";
import { useRcaAction, useRcaQuery } from "@/lib/rca";
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

/** One global "Raise a question" for the rep view (2026-10-20): a button in the rail and a dialog, from any tab. On the Business feed tab the
 * question can be tied to one of its cards; the tab it was raised from always goes in the context. */
export function RaiseQuestionDialog({ onClose, context, sales, withCards }: { onClose: () => void; context: string; sales?: string; withCards?: boolean }) {
  const run = useRcaAction(api.feed.raiseQuestion);
  const feedQ = useRcaQuery(api.feed.repQuestions, withCards && sales ? { password: pw(), sales } : "skip");
  const cards: AskCard[] = feedQ?.ready ? feedQ.cards.map(c => ({ id: c.id, question: c.question, fact: c.fact })) : [];
  const [text, setText] = useState("");
  const [about, setAbout] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ key?: string; url?: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const card = cards.find(c => c.id === about);

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setState("sending");
    setErr("");
    try {
      const r = await run({ password: pw(), question: q, email: gateEmail() || undefined, context, card, sales });
      setDone({ key: r.key, url: r.url });
      setState("idle");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).replace(/^.*Uncaught Error:\s*/, "").slice(0, 200));
      setState("error");
    }
  };

  return (
    <div className="rq-scrim" onClick={onClose}>
      <div className="rq-dialog" role="dialog" aria-modal="true" aria-labelledby="rq-title" onClick={e => e.stopPropagation()}>
        <div className="rq-dhead">
          <h2 id="rq-title">Raise a question</h2>
          <button type="button" className="rq-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {done ? (
          <div className="rq-done">
            <p>Question raised{done.key ? <> as {done.url ? <a href={done.url} target="_blank" rel="noreferrer">{done.key}</a> : <b>{done.key}</b>}</> : ""}. You will hear back through the request.</p>
            <div className="rq-row"><button type="button" className="rq-send" onClick={onClose}>Close</button><button type="button" className="rq-link" onClick={() => { setDone(null); setText(""); }}>Ask another</button></div>
          </div>
        ) : (
          <>
            <p className="rq-sub">Goes to the analytics team as a request, filed under your name. Where you are now ({context.replace(/^Rep view · /, "")}) is attached.</p>
            {cards.length ? (
              <>
                <label className="rq-l" htmlFor="rq-about">About</label>
                <select id="rq-about" className="rq-select" value={about} onChange={e => setAbout(e.target.value)}>
                  <option value="">Nothing in particular</option>
                  {cards.map(c => <option key={c.id} value={c.id}>{c.question}</option>)}
                </select>
              </>
            ) : null}
            <label className="rq-l" htmlFor="rq-text">Your question</label>
            <textarea id="rq-text" ref={box} rows={5} value={text} maxLength={4000} onChange={e => setText(e.target.value)} placeholder="What do you want to know or have checked?" />
            <div className="rq-row">
              <button type="button" className="rq-send" disabled={state === "sending" || !text.trim()} onClick={send}>{state === "sending" ? "Sending…" : "Send"}</button>
              <button type="button" className="rq-link" onClick={onClose}>Cancel</button>
              {state === "error" ? <span className="rq-err" role="alert">{err || "Could not send. Try again."}</span> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
