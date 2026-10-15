/**
 * Cube REST client: the one data source for vw-rca (replaces Power BI DAX).
 *
 * Env (Convex dashboard → Settings → Environment variables):
 *   CUBE_API_URL     e.g. https://cube.example.com  (no trailing /cubejs-api)
 *   CUBE_API_SECRET  CUBEJS_API_SECRET of that Cube deployment (signs an HS256 JWT)
 *
 * Every call goes through `load()`: bounded concurrency, "Continue wait"
 * polling, retries on transport errors, and transparent paging past Cube's
 * per-request row cap. `rows()` re-keys Cube's `cube.member` columns to the
 * legacy DAX keys (`customer_rfm_segmented_orders[order_date]`, `[rev]`) so the
 * downstream aggregation code is unchanged from the Power BI version.
 */
declare const process: { env: Record<string, string | undefined> };

export type CubeFilter = {
  member: string;
  operator:
    | "equals"
    | "notEquals"
    | "contains"
    | "notContains"
    | "set"
    | "notSet"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "beforeDate"
    | "afterDate";
  values?: string[];
};

export type CubeQuery = {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: "day";
    dateRange?: [string, string];
  }>;
  filters?: Array<CubeFilter | { or: CubeFilter[] } | { and: CubeFilter[] }>;
  order?: Array<[string, "asc" | "desc"]>;
  limit?: number;
  offset?: number;
};

export type Row = Record<string, unknown>;

/** Orders fact (BigQuery customer_rfm_segmented_orders, enriched in the model). */
export const O = "rfm_orders";

const PAGE = 50_000; // Cube's default CUBEJS_DB_QUERY_LIMIT
const MAX_INFLIGHT = 8;
let inflight = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return;
  }
  await new Promise<void>(resolve => waiting.push(resolve));
  inflight += 1;
}

function release(): void {
  inflight -= 1;
  waiting.shift()?.();
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let cachedToken: { token: string; exp: number } | null = null;

/** Short-lived HS256 JWT signed with the Cube API secret (cached ~50 min).
 * Web Crypto, so it runs in both the Convex V8 and Node runtimes. */
async function token(): Promise<string> {
  const secret = process.env.CUBE_API_SECRET;
  if (!secret) throw new Error("CUBE_API_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 600 > now) return cachedToken.token;
  const exp = now + 3600;
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now, exp, app: "vw-rca" }));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`));
  const sig = b64url(new Uint8Array(mac));
  cachedToken = { token: `${head}.${body}.${sig}`, exp };
  return cachedToken.token;
}

function baseUrl(): string {
  const url = process.env.CUBE_API_URL;
  if (!url) throw new Error("CUBE_API_URL is not set");
  return url.replace(/\/+$/, "").replace(/\/cubejs-api(\/v1)?$/, "");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One /load request, following Cube's "Continue wait" long-poll protocol. */
async function loadOnce(query: CubeQuery): Promise<Row[]> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${baseUrl()}/cubejs-api/v1/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await token() },
      body: JSON.stringify({ query: { timezone: "UTC", ...query } }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: { error?: string; data?: Row[] };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Cube HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (json.error === "Continue wait") {
      if (Date.now() > deadline) throw new Error("Cube timed out (Continue wait)");
      await sleep(500);
      continue;
    }
    if (!res.ok || json.error) {
      // 4xx = bad query / bad member name: surface immediately, never retry.
      const err = new Error(`Cube error ${res.status}: ${String(json.error ?? text).slice(0, 400)}`);
      if (res.status >= 400 && res.status < 500) (err as { fatal?: boolean }).fatal = true;
      throw err;
    }
    return json.data ?? [];
  }
}

async function loadRetry(query: CubeQuery): Promise<Row[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await loadOnce(query);
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Runs a Cube query and returns every row (pages past the row cap). */
export async function load(query: CubeQuery): Promise<Row[]> {
  const fetchPage = async (offset: number) => {
    await acquire();
    try {
      return await loadRetry({ ...query, limit: PAGE, offset });
    } finally {
      release();
    }
  };
  if (query.limit !== undefined) {
    await acquire();
    try {
      return await loadRetry(query);
    } finally {
      release();
    }
  }
  // Stable order is required for offset paging.
  if (!query.order) {
    const keys = [
      ...(query.dimensions ?? []),
      ...(query.timeDimensions ?? []).filter(t => t.granularity).map(t => t.dimension),
    ];
    if (keys.length) query = { ...query, order: keys.map(k => [k, "asc"]) };
  }
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/**
 * Runs a query and re-keys each row: `map` is { cubeMember: legacyKey }. A
 * day-grain time dimension is read from `member.day` and trimmed to YYYY-MM-DD.
 * Numeric strings from Cube are converted to numbers for measure keys.
 */
export async function rows(query: CubeQuery, map: Record<string, string>): Promise<Row[]> {
  const data = await load(query);
  const measures = new Set(query.measures ?? []);
  const timeDims = new Set(
    (query.timeDimensions ?? []).filter(t => t.granularity).map(t => t.dimension),
  );
  return data.map(r => {
    const o: Row = {};
    for (const [member, key] of Object.entries(map)) {
      if (timeDims.has(member)) {
        const v = r[`${member}.day`] ?? r[member];
        o[key] = v == null ? null : String(v).slice(0, 10);
      } else if (measures.has(member)) {
        const v = r[member];
        const n = typeof v === "number" ? v : v == null ? null : Number(v);
        o[key] = n != null && Number.isFinite(n) ? n : v;
      } else {
        o[key] = r[member] ?? null;
      }
    }
    return o;
  });
}

/** Inclusive day range on the order date (the DAX `dateFilter` equivalent). */
export function orderDays(start: string, end: string, granularity?: "day") {
  return [
    {
      dimension: `${O}.order_date`,
      dateRange: [start, end] as [string, string],
      ...(granularity ? { granularity } : {}),
    },
  ];
}

export const eq = (member: string, ...values: Array<string | number>): CubeFilter => ({
  member,
  operator: "equals",
  values: values.map(String),
});

/** Order-scope filters (bundle / non-bundle / all) for the family drills. */
export function scopeFilters(scope: string): CubeFilter[] {
  if (scope === "bundle") return [eq(`${O}.is_bundle`, "true")];
  if (scope === "nonbundle") return [eq(`${O}.header_bundle_blank`, "true")];
  return [];
}

/** Legacy Power BI column name (customer_rfm_segmented_orders[...]) → rfm_orders dimension. */
const ORDER_DIMS: Record<string, string> = {
  clinic_id: "clinic_id",
  customer_id: "customer_id",
  customer_name: "customer_name",
  customer_type: "customer_type",
  customer_practice_name: "practice_name",
  state: "state",
  country_name: "country",
  team_lead: "team_lead",
  sales_id: "sales_id",
  charge_method: "charge_method",
  hubspot_id: "hubspot_id",
  sample_test_type_v2: "sample_test_type_v2",
};
const LEGACY_TABLE = "customer_rfm_segmented_orders";
const LEGACY_FAMILY = "fact_order_tests_enriched[product_family]";

/**
 * Orders query in legacy row shape.
 *  by      legacy column names to group by (keys come back as `customer_rfm_segmented_orders[col]`)
 *  family  also group by the order's product family (key `fact_order_tests_enriched[product_family]`)
 *  day     also group by order_date at day grain (key `customer_rfm_segmented_orders[order_date]`)
 *  m       { legacyMeasureKey: rfm_orders measure }, e.g. { rev: "revenue" } → row["[rev]"]
 */
export function ordersRows(opts: {
  by?: string[];
  family?: boolean;
  day?: boolean;
  m: Record<string, string>;
  start?: string;
  end?: string;
  filters?: CubeQuery["filters"];
  order?: CubeQuery["order"];
  limit?: number;
}): Promise<Row[]> {
  const map: Record<string, string> = {};
  const dimensions: string[] = [];
  for (const col of opts.by ?? []) {
    const d = ORDER_DIMS[col];
    if (!d) throw new Error(`No Cube dimension mapped for ${col}`);
    dimensions.push(`${O}.${d}`);
    map[`${O}.${d}`] = `${LEGACY_TABLE}[${col}]`;
  }
  if (opts.family) {
    dimensions.push(`${O}.product_family`);
    map[`${O}.product_family`] = LEGACY_FAMILY;
  }
  const measures: string[] = [];
  for (const [key, measure] of Object.entries(opts.m)) {
    measures.push(`${O}.${measure}`);
    map[`${O}.${measure}`] = `[${key}]`;
  }
  const timeDimensions =
    opts.start && opts.end
      ? orderDays(opts.start, opts.end, opts.day ? "day" : undefined)
      : [];
  if (opts.day) map[`${O}.order_date`] = `${LEGACY_TABLE}[order_date]`;
  const order = opts.order?.map(
    ([k, dir]) => [map[k] ? k : `${O}.${opts.m[k] ?? k}`, dir] as [string, "asc" | "desc"],
  );
  return rows(
    {
      measures,
      dimensions,
      timeDimensions,
      filters: opts.filters,
      ...(order ? { order } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    },
    map,
  );
}
