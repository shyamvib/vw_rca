/**
 * "Raise a question" -> Jira (2026-10-20). Plain fetch against Jira Cloud's REST API v3; no Convex imports so the engine's admin
 * check can use it too.
 *
 * Environment (engine .env, never in git):
 *   JIRA_BASE_URL     https://<site>.atlassian.net  (no trailing slash)
 *   JIRA_EMAIL        the Atlassian account that owns the token (issues show it as the reporter)
 *   JIRA_API_TOKEN    API token created by that account at id.atlassian.com
 *   JIRA_PROJECT_KEY  e.g. RCA
 *   JIRA_ISSUE_TYPE   optional, default "Task"
 *   JIRA_LABELS       optional, comma list added to every issue, default "rca-dashboard"
 *
 * Request portal (Jira Service Management) instead of a plain project: also set
 *   JIRA_SERVICE_DESK_ID   the service desk's id (the number in /servicedesk/customer/portal/<id> is usually it; /admin/jira-check confirms)
 *   JIRA_REQUEST_TYPE_ID   the request type the question is filed under (/admin/jira-check lists them)
 *   JIRA_RAISE_ON_BEHALF   "1" to file it as the asker (needs an agent account that may raise on behalf of customers)
 *   JIRA_DUE_IN_DAYS       if the request type requires a due date, how many days ahead to set it (e.g. 7)
 *   JIRA_EXTRA_FIELDS      other required fields as id=value pairs separated by ";", e.g. customfield_10869=Analytics Insight
 *                          (custom fields are sent as select options, anything else as plain text)
 * JIRA_PROJECT_KEY is not needed in that mode. The request then shows in the portal with the portal's own workflow and SLAs.
 *
 * Auth is HTTP Basic (email:token). The token is only ever read from the environment and never logged or returned.
 */
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(s: string): { toString(enc: string): string } };

export type JiraConfig = {
  baseUrl: string; email: string; token: string; project: string; issueType: string; labels: string[];
  serviceDeskId: string; requestTypeId: string; onBehalf: boolean; dueInDays: number; extra: Record<string, string>;
};

/** An .env value without a trailing " # comment" (docker env files keep them), or "" when the whole value is a comment. */
const val = (v: string | undefined) => (v ?? "").replace(/^\s*#.*$/, "").replace(/\s+#.*$/, "").trim();

export function jiraConfig(): JiraConfig | null {
  const e = process.env;
  const baseUrl = val(e.JIRA_BASE_URL).replace(/\/+$/, "");
  const email = val(e.JIRA_EMAIL);
  const token = val(e.JIRA_API_TOKEN);
  const project = val(e.JIRA_PROJECT_KEY);
  const serviceDeskId = val(e.JIRA_SERVICE_DESK_ID);
  const requestTypeId = val(e.JIRA_REQUEST_TYPE_ID);
  const extra: Record<string, string> = {};
  for (const pair of val(e.JIRA_EXTRA_FIELDS).split(";")) {
    const i = pair.indexOf("=");
    if (i > 0 && pair.slice(i + 1).trim()) extra[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  if (!baseUrl || !email || !token) return null;
  // Portal mode needs the service desk (the request type can be picked from the check's list first); plain mode needs the project.
  if (serviceDeskId ? false : !project) return null;
  const labels = (val(e.JIRA_LABELS) || "rca-dashboard").split(",").map(s => s.trim().replace(/\s+/g, "-")).filter(Boolean);
  return { baseUrl, email, token, project, issueType: val(e.JIRA_ISSUE_TYPE) || "Task", labels, serviceDeskId, requestTypeId, onBehalf: val(e.JIRA_RAISE_ON_BEHALF) === "1", dueInDays: Math.max(0, Math.round(Number(val(e.JIRA_DUE_IN_DAYS)) || 0)), extra };
}

const authHeader = (c: JiraConfig) => `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`;

async function call(c: JiraConfig, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: authHeader(c), Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "Jira did not answer in time. Try again in a minute." : "Could not reach Jira. Try again in a minute.");
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty or non-JSON body */
  }
  return { status: res.status, json };
}

/** Jira's error body as one short line, without anything that could echo a credential. */
function errorText(status: number, json: Record<string, unknown> | null): string {
  const msgs = [...(Array.isArray(json?.errorMessages) ? (json!.errorMessages as unknown[]).map(String) : []), ...(typeof json?.errorMessage === "string" ? [json.errorMessage] : []), ...(typeof json?.reason === "string" ? [json.reason] : [])];
  const fields = json?.errors && typeof json.errors === "object" ? Object.entries(json.errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`) : [];
  const detail = [...msgs, ...fields].join("; ").slice(0, 240);
  if (status === 401) return "Jira rejected the credentials (401). Check JIRA_EMAIL and JIRA_API_TOKEN.";
  if (status === 403) return "The Jira account is not allowed to create issues in that project (403).";
  if (status === 404) return "Jira project or site not found (404). Check JIRA_BASE_URL and JIRA_PROJECT_KEY.";
  return `Jira returned ${status}${detail ? `: ${detail}` : ""}`;
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

// Atlassian Document Format helpers (the v3 API takes the description as ADF, not plain text).
const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const strong = (label: string, text: string) => ({ type: "paragraph", content: [{ type: "text", text: `${label} `, marks: [{ type: "strong" }] }, { type: "text", text: text || "-" }] });

export type RaiseInput = {
  question: string;
  asker: string;
  /** who is asking: team login, or the rep / manager login and the book it is looking at */
  scope: string;
  /** where it was raised from, e.g. "Business Feed" */
  context: string;
  /** the card it is about, when there is one */
  card?: { id: string; question: string; fact: string };
};

export async function createJiraIssue(input: RaiseInput): Promise<{ key: string; url: string }> {
  const c = jiraConfig();
  if (!c) throw new Error("Jira is not configured on this deployment.");
  const question = clean(input.question, 4000);
  if (!question) throw new Error("Question is empty.");
  const summary = clean(question.replace(/\s+/g, " "), 120) || "Question from the RCA dashboard";
  const content: unknown[] = [p(question), strong("Asked by:", clean(input.asker, 200) || "unknown"), strong("Scope:", clean(input.scope, 200)), strong("Raised from:", clean(input.context, 200))];
  if (input.card) {
    content.push(p(""), strong("About this card:", clean(input.card.question, 300)));
    content.push(strong("Fact on the card:", clean(input.card.fact, 800)));
    content.push(strong("Card id:", clean(input.card.id, 120)));
  }
  if (c.serviceDeskId) {
    if (!c.requestTypeId) throw new Error("Pick a request type: set JIRA_REQUEST_TYPE_ID (run /admin/jira-check to list them).");
    // Portal requests take plain text, not ADF.
    const text = [question, "", `Asked by: ${clean(input.asker, 200) || "unknown"}`, `Scope: ${clean(input.scope, 200)}`, `Raised from: ${clean(input.context, 200)}`,
      ...(input.card ? ["", `About this card: ${clean(input.card.question, 300)}`, `Fact on the card: ${clean(input.card.fact, 800)}`, `Card id: ${clean(input.card.id, 120)}`] : [])].join("\n");
    const asker = clean(input.asker, 200);
    const r = await call(c, "/rest/servicedeskapi/request", {
      method: "POST",
      body: {
        serviceDeskId: c.serviceDeskId,
        requestTypeId: c.requestTypeId,
        requestFieldValues: {
          summary: `[RCA] ${summary}`.slice(0, 250),
          description: text,
          ...(c.dueInDays ? { duedate: new Date(Date.now() + c.dueInDays * 86_400_000).toISOString().slice(0, 10) } : {}),
          ...Object.fromEntries(Object.entries(c.extra).map(([k, v]) => [k, k.startsWith("customfield_") ? { value: v } : v])),
        },
        ...(c.onBehalf && /^[^@\s]+@[^@\s]+$/.test(asker) ? { raiseOnBehalfOf: asker } : {}),
      },
    });
    if (r.status !== 201 || typeof r.json?.issueKey !== "string") throw new Error(errorText(r.status, r.json));
    const web = (r.json._links as { web?: string } | undefined)?.web;
    return { key: r.json.issueKey, url: web ?? `${c.baseUrl}/browse/${r.json.issueKey}` };
  }
  const { status, json } = await call(c, "/rest/api/3/issue", {
    method: "POST",
    body: {
      fields: {
        project: { key: c.project },
        summary: `[RCA] ${summary}`.slice(0, 250),
        issuetype: { name: c.issueType },
        description: { type: "doc", version: 1, content },
        labels: c.labels,
      },
    },
  });
  if (status !== 201 || typeof json?.key !== "string") throw new Error(errorText(status, json));
  return { key: json.key, url: `${c.baseUrl}/browse/${json.key}` };
}

/** Credential check for the admin endpoint: who the token belongs to, whether the project is visible, and its issue types. Creates nothing. */
export async function checkJira(): Promise<{ ok: boolean; configured: boolean; detail: string; user?: string; project?: string; issueTypes?: string[] }> {
  const c = jiraConfig();
  if (!c) return { ok: false, configured: false, detail: "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY." };
  try {
    const me = await call(c, "/rest/api/3/myself");
    if (me.status !== 200) return { ok: false, configured: true, detail: errorText(me.status, me.json) };
    if (c.serviceDeskId) {
      const sd = await call(c, `/rest/servicedeskapi/servicedesk/${encodeURIComponent(c.serviceDeskId)}`);
      if (sd.status !== 200) return { ok: false, configured: true, user: String(me.json?.displayName ?? ""), detail: `Service desk ${c.serviceDeskId} not found or not visible to this account (${sd.status}). The id is not always the number in the portal URL; GET ${c.baseUrl}/rest/servicedeskapi/servicedesk lists them.` };
      const rt = await call(c, `/rest/servicedeskapi/servicedesk/${encodeURIComponent(c.serviceDeskId)}/requesttype?limit=100`);
      const values = Array.isArray(rt.json?.values) ? (rt.json!.values as Array<{ id?: string; name?: string }>) : [];
      const types = values.map(v => `${String(v.id)}: ${String(v.name)}`);
      let required: string[] = [];
      let typeOk = false;
      if (c.requestTypeId) {
        typeOk = values.some(v => String(v.id) === c.requestTypeId);
        const f = await call(c, `/rest/servicedeskapi/servicedesk/${encodeURIComponent(c.serviceDeskId)}/requesttype/${encodeURIComponent(c.requestTypeId)}/field`);
        const fields = Array.isArray(f.json?.requestTypeFields) ? (f.json!.requestTypeFields as Array<{ fieldId?: string; required?: boolean }>) : [];
        required = fields.filter(x => x.required).map(x => String(x.fieldId));
      }
      const given = new Set(["summary", "description", ...(c.dueInDays ? ["duedate"] : []), ...Object.keys(c.extra)]);
      const extra = required.filter(r => !given.has(r));
      return {
        ok: typeOk && extra.length === 0,
        configured: true,
        user: String(me.json?.displayName ?? ""),
        project: String(sd.json?.projectName ?? c.serviceDeskId),
        issueTypes: types,
        detail: !c.requestTypeId
          ? `Service desk found. Set JIRA_REQUEST_TYPE_ID to one of: ${types.join(" | ")}.`
          : !typeOk
            ? `Request type ${c.requestTypeId} is not in this service desk. Choose from: ${types.join(" | ")}.`
            : extra.length
              ? `Request type also requires: ${extra.join(", ")}. Set JIRA_DUE_IN_DAYS for duedate and JIRA_EXTRA_FIELDS (id=value;id=value) for the others, or pick a request type that only needs summary and description.`
              : "Credentials work, the service desk and request type exist, and every required field is covered.",
      };
    }
    const proj = await call(c, `/rest/api/3/project/${encodeURIComponent(c.project)}`);
    if (proj.status !== 200) return { ok: false, configured: true, user: String(me.json?.displayName ?? ""), detail: errorText(proj.status, proj.json) };
    const types = Array.isArray(proj.json?.issueTypes) ? (proj.json!.issueTypes as Array<{ name?: string }>).map(t => String(t.name ?? "")).filter(Boolean) : [];
    const typeOk = types.includes(c.issueType);
    return {
      ok: typeOk,
      configured: true,
      user: String(me.json?.displayName ?? ""),
      project: String(proj.json?.name ?? c.project),
      issueTypes: types,
      detail: typeOk ? "Credentials work and the issue type exists." : `The project has no issue type named "${c.issueType}". Set JIRA_ISSUE_TYPE to one of: ${types.join(", ")}.`,
    };
  } catch (e) {
    return { ok: false, configured: true, detail: `Could not reach Jira: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}
