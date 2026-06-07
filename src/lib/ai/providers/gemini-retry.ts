// Gemini 429 / RESOURCE_EXHAUSTED handling.
//
// Gemini does NOT use the HTTP `Retry-After` header — instead it returns a
// `google.rpc.RetryInfo` object inside `error.details` with a `retryDelay`
// duration string ("53s"). A `google.rpc.QuotaFailure` whose quota is a
// PER-DAY limit (or reports limit 0) is TERMINAL — retrying won't help; we
// must surface it / fall back rather than sleep for hours. Per-minute quota
// failures are transient. We honor the server's retryDelay ABOVE our own
// exponential backoff (ignoring it is a known footgun — python-genai #1875).
//
// Refs: ai.google.dev/gemini-api/docs/rate-limits, gemini-cli retry.ts,
// googleapis/python-genai#1875.

export type GeminiRetryVerdict = {
  /** Server-suggested wait from RetryInfo, in ms, or null when absent. */
  retryDelayMs: number | null;
  /** Daily/limit-0 quota failure — do not retry, fall back / surface. */
  terminal: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Parse a protobuf duration string like "53s" / "1.7s" into milliseconds. */
export function parseDurationToMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value.trim());
  if (!m) return null;
  const secs = Number(m[1]);
  if (!Number.isFinite(secs)) return null;
  return Math.round(secs * 1000);
}

export function classifyGeminiError(body: unknown): GeminiRetryVerdict {
  let retryDelayMs: number | null = null;
  let terminal = false;
  const details = asRecord(asRecord(body)?.error)?.details;
  if (Array.isArray(details)) {
    for (const raw of details) {
      const d = asRecord(raw);
      if (!d) continue;
      const type = typeof d["@type"] === "string" ? (d["@type"] as string) : "";
      if (type.endsWith("RetryInfo")) {
        retryDelayMs = parseDurationToMs(d["retryDelay"]);
      } else if (type.endsWith("QuotaFailure")) {
        const violations = d["violations"];
        if (Array.isArray(violations)) {
          for (const vRaw of violations) {
            const v = asRecord(vRaw);
            if (!v) continue;
            const quotaId = String(v["quotaId"] ?? "");
            const limit = v["quotaValue"] ?? v["limit"];
            if (/per\s*day|daily/i.test(quotaId)) terminal = true;
            if (limit === "0" || limit === 0) terminal = true;
          }
        }
      }
    }
  }
  return { retryDelayMs, terminal };
}

/** Only 408 / 429 / 5xx are retryable. 4xx (bad key/prompt) never is. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Backoff for a retry: `max(exponential, serverRetryDelay) + jitter`, with the
 * exponential part capped but the server delay honored up to a hard ceiling so
 * a "wait 53s" hint isn't undercut. `attempt` is 0-based.
 */
export function computeBackoffMs(
  attempt: number,
  serverDelayMs: number | null,
  opts: { baseMs?: number; capMs?: number; hardCapMs?: number; rand?: () => number } = {},
): number {
  const base = opts.baseMs ?? 1000;
  const cap = opts.capMs ?? 32000;
  const hardCap = opts.hardCapMs ?? 90000;
  const rand = opts.rand ?? Math.random;
  const expo = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  const core = Math.min(hardCap, Math.max(expo, serverDelayMs ?? 0));
  return Math.round(core + rand() * 1000);
}

/** Resolve after `ms`, or early (false) if the signal aborts. */
export function abortableDelay(
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
