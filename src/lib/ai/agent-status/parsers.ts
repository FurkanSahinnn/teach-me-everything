import type { LimitWindow } from "./types";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const clampPercent = (n: number): number => Math.min(100, Math.max(0, n));

function isoToMs(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : undefined;
}

/** First semver-looking token ("2.1.319 (Claude Code)" -> "2.1.319"). */
export function parseCliVersion(raw: string | null | undefined): string | undefined {
  const m = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(raw ?? "");
  return m?.[0];
}

/** Codex initialize `userAgent` ("codex_cli/0.154.0 (...)") -> "0.154.0". */
export function parseCodexUserAgent(userAgent: unknown): string | undefined {
  const m = /\/([^\s]+)/.exec(str(userAgent) ?? "");
  return m?.[1];
}

export type ClaudeInitInfo = {
  version?: string;
  email?: string;
  organization?: string;
  planLabel?: string;
};

/** Inner `response` of the Claude `initialize` control_response. */
export function parseClaudeInitialize(response: unknown): ClaudeInitInfo {
  const r = rec(response);
  const account = rec(r.account);
  const out: ClaudeInitInfo = {};
  const version = str(r.claude_code_version);
  const email = str(account.email);
  const organization = str(account.organization);
  const plan = str(account.subscriptionType);
  if (version) out.version = version;
  if (email) out.email = email;
  if (organization) out.organization = organization;
  if (plan) out.planLabel = plan;
  return out;
}

export type ClaudeUsageInfo = { limits: LimitWindow[] };

function claudeWindow(
  raw: unknown,
  base: Pick<LimitWindow, "id" | "kind" | "label"> & { modelName?: string },
  windowMinutes?: number,
): LimitWindow | null {
  const r = rec(raw);
  const used = num(r.utilization);
  if (used === undefined) return null;
  const resetsAt = isoToMs(r.resets_at);
  return {
    ...base,
    usedPercent: clampPercent(used),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
  };
}

/** Inner `response` of the (experimental) Claude `get_usage` control_response. */
export function parseClaudeUsage(response: unknown): ClaudeUsageInfo {
  const r = rec(response);
  const limits: LimitWindow[] = [];
  if (r.rate_limits_available === false) return { limits };
  const rl = rec(r.rate_limits);
  const session = claudeWindow(rl.five_hour, { id: "session", kind: "session", label: "Session" }, 300);
  if (session) limits.push(session);
  const weekly = claudeWindow(rl.seven_day, { id: "weekly", kind: "weekly", label: "Weekly" }, 10080);
  if (weekly) limits.push(weekly);
  if (Array.isArray(rl.model_scoped)) {
    for (const item of rl.model_scoped) {
      const name = str(rec(item).display_name);
      if (!name) continue;
      const w = claudeWindow(
        item,
        { id: `weekly_model:${name}`, kind: "weekly_model", label: `Weekly · ${name}`, modelName: name },
        10080,
      );
      if (w) limits.push(w);
    }
  }
  return { limits };
}

const CODEX_PLAN_LABELS: Record<string, string> = {
  free: "ChatGPT Free",
  go: "ChatGPT Go",
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  prolite: "ChatGPT Pro Lite",
  promax: "ChatGPT Pro Max",
  team: "ChatGPT Team",
  business: "ChatGPT Business",
  self_serve_business_prolite: "ChatGPT Business",
  self_serve_business_usage_based: "ChatGPT Business",
  enterprise: "ChatGPT Enterprise",
  enterprise_cbp_automation: "ChatGPT Enterprise",
  enterprise_cbp_usage_based: "ChatGPT Enterprise",
  ent26: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
  edu_plus: "ChatGPT Edu",
  edu_pro: "ChatGPT Edu",
};

/** Codex `planType` -> display label. Unknown values are capitalized; "unknown"/empty -> undefined. */
export function codexPlanLabel(planType: unknown): string | undefined {
  const raw = str(planType);
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  if (key === "unknown") return undefined;
  const known = CODEX_PLAN_LABELS[key];
  if (known) return known;
  const words = key.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type CodexAccountInfo = {
  /** "none" = logged out (account null). */
  kind: "chatgpt" | "apiKey" | "amazonBedrock" | "other" | "none";
  email?: string;
  planLabel?: string;
  /** True when account is null and the CLI says OpenAI auth is required. */
  requiresLogin: boolean;
};

/** Result of `account/read`. */
export function parseCodexAccount(result: unknown): CodexAccountInfo {
  const r = rec(result);
  const requiresLogin = r.requiresOpenaiAuth === true;
  const acc = r.account;
  if (acc === null || acc === undefined || typeof acc !== "object") {
    return { kind: "none", requiresLogin };
  }
  const a = rec(acc);
  const t = str(a.type);
  const kind = t === "chatgpt" || t === "apiKey" || t === "amazonBedrock" ? t : "other";
  const email = str(a.email);
  const planLabel = codexPlanLabel(a.planType);
  return {
    kind,
    requiresLogin: false,
    ...(email ? { email } : {}),
    ...(planLabel ? { planLabel } : {}),
  };
}

export type CodexLimitsInfo = { limits: LimitWindow[]; planLabel?: string };

function codexWindow(
  raw: unknown,
  base: Pick<LimitWindow, "id" | "kind" | "label">,
  fallbackMinutes?: number,
): LimitWindow | null {
  const r = rec(raw);
  const used = num(r.usedPercent);
  if (used === undefined) return null;
  const resets = num(r.resetsAt);
  const minutes = num(r.windowDurationMins) ?? fallbackMinutes;
  return {
    ...base,
    usedPercent: clampPercent(used),
    ...(resets !== undefined ? { resetsAt: resets * 1000 } : {}),
    ...(minutes !== undefined ? { windowMinutes: minutes } : {}),
  };
}

/** Result of `account/rateLimits/read`. Prefers the "codex" bucket, else `rateLimits`. */
export function parseCodexRateLimits(result: unknown): CodexLimitsInfo {
  const r = rec(result);
  const byId = rec(r.rateLimitsByLimitId);
  const snapshot = Object.keys(rec(byId.codex)).length > 0 ? rec(byId.codex) : rec(r.rateLimits);
  const limits: LimitWindow[] = [];
  const session = codexWindow(snapshot.primary, { id: "session", kind: "session", label: "Session" }, 300);
  if (session) limits.push(session);
  const weekly = codexWindow(snapshot.secondary, { id: "weekly", kind: "weekly", label: "Weekly" }, 10080);
  if (weekly) limits.push(weekly);
  const ind = rec(snapshot.individualLimit);
  const remaining = num(ind.remainingPercent);
  if (remaining !== undefined) {
    const resets = num(ind.resetsAt);
    limits.push({
      id: "monthly",
      kind: "monthly",
      label: "Monthly credit",
      usedPercent: clampPercent(100 - remaining),
      ...(resets !== undefined ? { resetsAt: resets * 1000 } : {}),
    });
  }
  const planLabel = codexPlanLabel(snapshot.planType);
  return { limits, ...(planLabel ? { planLabel } : {}) };
}
