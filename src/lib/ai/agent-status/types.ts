/** Status model for the user's locally installed agent CLIs (UI-agnostic). */

export type AgentCliId = "claude" | "codex" | "opencode";

export type LimitKind = "session" | "weekly" | "weekly_model" | "monthly";

export type LimitWindow = {
  /** Stable id, e.g. "session", "weekly", "weekly_model:Fable", "monthly". */
  id: string;
  kind: LimitKind;
  /** Data-only English label ("Weekly · Fable"). The UI localizes via kind + modelName. */
  label: string;
  /** Set for `weekly_model` windows. */
  modelName?: string;
  /** 0..100, clamped. */
  usedPercent: number;
  /** Epoch milliseconds when the window resets. */
  resetsAt?: number;
  /** Window length in minutes when the CLI reports it. */
  windowMinutes?: number;
};

export type AgentAccountState = "not_installed" | "unauthenticated" | "authenticated" | "error";

export type OpencodeModelUsage = {
  modelId: string;
  providerId: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type OpencodeUsageStats = {
  days: number;
  sessions: number;
  prompts: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  models: OpencodeModelUsage[];
};

export type AgentAccountStatus = {
  cli: AgentCliId;
  state: AgentAccountState;
  version?: string;
  email?: string;
  organization?: string;
  /** e.g. "Claude Max", "ChatGPT Plus". */
  planLabel?: string;
  /** Empty when unavailable; see `limitsError`. */
  limits: LimitWindow[];
  /** Set when the account is known but the usage windows could not be read. */
  limitsError?: string;
  /** Short, secret-free reason for `not_installed` / `error`. */
  error?: string;
  /** Models the CLI can reach (OpenCode, whose providers are configured inside it). */
  modelCount?: number;
  /** Providers contributing those models, e.g. "opencode", "anthropic". */
  providers?: string[];
  /** Local token/session/model usage reported by `opencode stats --json`. */
  opencodeStats?: OpencodeUsageStats;
  /** Epoch milliseconds. */
  checkedAt: number;
};

export type AgentProbeOptions = {
  path?: string | undefined;
  env?: Record<string, string> | undefined;
};
