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
 * Auth is HTTP Basic (email:token). The token is only ever read from the environment and never logged or returned.
 */
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(s: string): { toString(enc: string): string } };

export type JiraConfig = { baseUrl: string; email: string; token: string; project: string; issueType: string; labels: string[] };

export function jiraConfig(): JiraConfig | null {
  const e = process.env;
  const baseUrl = (e.JIRA_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const email = (e.JIRA_EMAIL ?? "").trim();
  const token = (e.JIRA_API_TOKEN ?? "").trim();
  const project = (e.JIRA_PROJECT_KEY ?? "").trim();
  if (!baseUrl || !email || !token || !project) return null;
  const labels = (e.JIRA_LABELS ?? "rca-dashboard").split(",").map(s => s.trim().replace(/\s+/g, "-")).filter(Boolean);
  return { baseUrl, email, token, project, issueType: (e.JIRA_ISSUE_TYPE ?? "Task").trim() || "Task", labels };
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
  const msgs = Array.isArray(json?.errorMessages) ? (json!.errorMessages as unknown[]).map(String) : [];
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
