// Mirrors the camelCase result of the Rust `usage_scan` command.

export type UsageProvider = "claude" | "codex";

export type UsageScanArgs = {
  sinceMs: number;
  /** Local offset east of UTC, minutes (`-new Date().getTimezoneOffset()`). */
  tzOffsetMinutes: number;
  claudeHome?: string | undefined;
  codexHome?: string | undefined;
};

export type UsageBucket = {
  provider: UsageProvider;
  model: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  events: number;
};

export type UsageRoot = { path: string; found: boolean };

export type UsageScanResult = {
  buckets: UsageBucket[];
  sessions: Record<UsageProvider, number>;
  malformed: number;
  filesScanned: number;
  roots: Record<UsageProvider, UsageRoot>;
};

export type UsageRange = "24h" | "7d" | "30d" | "90d";
