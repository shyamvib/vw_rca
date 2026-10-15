/**
 * Client for the RCA analytics service (engine/server.ts).
 *
 * Analytics endpoints (map, wins, rep views, feed, drill-downs ...) are served
 * from a snapshot by the analytics service; Convex keeps only app state. These
 * hooks are drop-in replacements for Convex's useQuery / useAction: they take
 * the same typed `api.module.fn` references, so call sites and types are
 * unchanged.
 *
 * When VITE_RCA_API_URL is not set the hooks fall straight back to Convex's own,
 * so a build without the service behaves exactly as before.
 */
import { useAction, useQuery } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const BASE = (import.meta.env.VITE_RCA_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
export const rcaServiceEnabled = BASE.length > 0;

const TTL_MS = 30_000;
type Entry = { at: number; value?: unknown; error?: Error; promise?: Promise<unknown> };
const cache = new Map<string, Entry>();

// The service rebuilds its snapshot on a schedule. Poll its health for the build
// time and drop cached results when it changes, so open dashboards pick up new data.
let version = "0";
const listeners = new Set<() => void>();
async function pollVersion() {
  try {
    const h = await (await fetch(`${BASE}/health`)).json();
    const v = String(h?.snapshot?.builtAt ?? "0");
    if (v !== version) {
      version = v;
      cache.clear();
      listeners.forEach(l => l());
    }
  } catch {
    /* service briefly unreachable: keep what we have */
  }
}
if (rcaServiceEnabled && typeof window !== "undefined") {
  void pollVersion();
  setInterval(() => void pollVersion(), 60_000);
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const useVersion = () => useSyncExternalStore(subscribe, () => version);

export class RcaError extends Error {}

async function post(name: string, args: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  let body: { value?: unknown; error?: string };
  try {
    body = await res.json();
  } catch {
    throw new RcaError(`Analytics service error (${res.status})`);
  }
  if (!res.ok || body.error) throw new RcaError(body.error ?? `Analytics service error (${res.status})`);
  return body.value;
}

/** One request per (function, args) at a time, with a short shared cache. */
function fetchCached(name: string, args: unknown, force = false): Entry {
  const key = `${name}|${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (hit && !force && (hit.promise || Date.now() - hit.at < TTL_MS)) return hit;
  const entry: Entry = { at: Date.now() };
  entry.promise = post(name, args).then(
    v => {
      entry.value = v;
      entry.promise = undefined;
      entry.at = Date.now();
      return v;
    },
    e => {
      entry.error = e as Error;
      entry.promise = undefined;
      throw e;
    },
  );
  entry.promise.catch(() => undefined);
  cache.set(key, entry);
  return entry;
}

function useRcaQueryService<F extends FunctionReference<"query">>(
  ref: F,
  args: FunctionArgs<F> | "skip",
): FunctionReturnType<F> | undefined {
  const v = useVersion();
  const name = getFunctionName(ref);
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const [, bump] = useState(0);
  const latest = useRef<{ key: string; entry?: Entry }>({ key: "" });

  useEffect(() => {
    if (args === "skip") return;
    const entry = fetchCached(name, args);
    latest.current = { key: `${name}|${key}|${v}`, entry };
    let live = true;
    if (entry.promise) entry.promise.then(() => live && bump(n => n + 1), () => live && bump(n => n + 1));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, v]);

  if (args === "skip") return undefined;
  // Read straight from the cache so a cached result renders on the first pass.
  const entry = cache.get(`${name}|${key}`);
  if (entry?.error) throw entry.error; // surfaces to the error boundary, like Convex's useQuery
  return entry && entry.promise === undefined && "value" in entry ? (entry.value as FunctionReturnType<F>) : undefined;
}

function useRcaActionService<F extends FunctionReference<"action">>(ref: F) {
  const name = getFunctionName(ref);
  return (args: FunctionArgs<F>) => post(name, args) as Promise<FunctionReturnType<F>>;
}

// Chosen once at module load: the choice never changes during a session, so hook order is stable.
export const useRcaQuery: typeof useRcaQueryService = rcaServiceEnabled
  ? useRcaQueryService
  : (useQuery as unknown as typeof useRcaQueryService);

export const useRcaAction: typeof useRcaActionService = rcaServiceEnabled
  ? useRcaActionService
  : (useAction as unknown as typeof useRcaActionService);
