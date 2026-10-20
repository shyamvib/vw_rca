/**
 * Client for the RCA analytics service (engine/server.ts).
 *
 * Analytics endpoints (map, wins, rep views, feed, drill-downs ...) are served
 * from a snapshot by the analytics service; Convex keeps only app state. These
 * hooks are drop-in replacements for Convex's useQuery / useAction: they take
 * the same typed `api.module.fn` references, so call sites and types are
 * unchanged.
 *
 * Where the service lives: VITE_RCA_API_URL if the build pins one, otherwise the
 * URL the service announced to Convex (ops.serviceUrl; a quick tunnel's URL
 * changes on every restart).
 */
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { api } from "@/lib/api";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const PINNED = (import.meta.env.VITE_RCA_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;
let BASE = PINNED;

/** Looks the announced service URL up in Convex (no-op when the build pins one). */
async function resolveBase(): Promise<boolean> {
  if (PINNED || !CONVEX_URL) return false;
  try {
    const url = await new ConvexHttpClient(CONVEX_URL).query(api.ops.serviceUrl, {});
    const next = (url ?? "").replace(/\/+$/, "");
    if (next && next !== BASE) {
      BASE = next;
      return true;
    }
  } catch {
    /* Convex briefly unreachable: keep the current URL */
  }
  return false;
}
let baseReady: Promise<unknown> = PINNED ? Promise.resolve() : resolveBase();

const TTL_MS = 30_000;
type Entry = { at: number; value?: unknown; error?: Error; promise?: Promise<unknown> };
const cache = new Map<string, Entry>();

// The service rebuilds its snapshot on a schedule. Poll its health for the build
// time and drop cached results when it changes, so open dashboards pick up new data.
let version = "0";
const listeners = new Set<() => void>();
async function pollVersion() {
  let changed = await resolveBase();
  try {
    if (!BASE) throw new Error("no service url yet");
    const h = await (await fetch(`${BASE}/health`)).json();
    const v = String(h?.snapshot?.builtAt ?? "0");
    if (v !== version) {
      version = v;
      changed = true;
    }
  } catch {
    /* service briefly unreachable: keep what we have */
  }
  if (changed) {
    cache.clear();
    listeners.forEach(l => l());
  }
}
void baseReady.then(() => pollVersion());
if (typeof window !== "undefined") setInterval(() => void pollVersion(), 60_000);
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const useVersion = () => useSyncExternalStore(subscribe, () => version);

export class RcaError extends Error {}

async function post(name: string, args: unknown): Promise<unknown> {
  await baseReady;
  if (!BASE) await resolveBase();
  if (!BASE) throw new RcaError("The analytics service is not reachable right now. Try again in a minute.");
  const call = () =>
    fetch(`${BASE}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
  let res: Response;
  try {
    res = await call();
  } catch (e) {
    // "Failed to fetch": the service restarted and its quick tunnel got a new URL (announced to Convex). Look the URL up
    // again and retry once instead of surfacing the error until the next 60-second poll (2026-10-20).
    if (!(await resolveBase())) throw e;
    res = await call();
  }
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
  // Stable identity, like Convex's useAction: callers list it in effect dependencies.
  return useCallback((args: FunctionArgs<F>) => post(name, args) as Promise<FunctionReturnType<F>>, [name]);
}

export const useRcaQuery = useRcaQueryService;
export const useRcaAction = useRcaActionService;
