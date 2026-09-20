// Model context-window sizes, used to show how full the prompt is.
//
// Nothing in the app knew a model's window before this: the chat panels could
// report cost and message count but not the one number that tells a user their
// next question might get truncated.
//
// Unknown models return `null` rather than a guess, and callers hide the meter
// on null. A wrong percentage is worse than none — it would invite the user to
// keep piling on context right up to a limit that is not really there.

/**
 * Exact ids first, then prefixes. Prefix entries exist because providers ship
 * dated variants (`claude-sonnet-4-6-20260115`) and because the local CLI takes
 * bare aliases (`opus`, `sonnet`, `haiku`) that resolve to whatever is current.
 */
const EXACT: Record<string, number> = {
  // Claude Code CLI aliases — the CLI resolves these to the newest model in
  // each tier, all of which are 200k today.
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  fable: 200_000,
};

const PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["claude-", 200_000],
  // OpenAI's 5-series moved to 400k; the 4-series and o-series stayed at 128k
  // and 200k respectively, so they need their own entries.
  ["gpt-5", 400_000],
  ["o3", 200_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gemini-3", 1_000_000],
  ["llama-3.3", 128_000],
  ["llama-3.1", 128_000],
  ["deepseek", 128_000],
  ["qwen", 128_000],
  ["mixtral", 32_768],
  ["z-ai/glm", 128_000],
  ["x-ai/grok", 128_000],
];

/** Window size in tokens, or null when we do not know it for certain. */
export function resolveContextWindow(modelId: string): number | null {
  const id = modelId.trim().toLowerCase();
  if (id.length === 0) return null;
  const exact = EXACT[id];
  if (exact !== undefined) return exact;
  for (const [prefix, size] of PREFIXES) {
    if (id.startsWith(prefix)) return size;
  }
  // OpenRouter passthrough ids carry the upstream name after a slash
  // (`anthropic/claude-sonnet-4.5`), so retry on the tail.
  const slash = id.indexOf("/");
  if (slash > 0) {
    const tail = id.slice(slash + 1);
    for (const [prefix, size] of PREFIXES) {
      if (tail.startsWith(prefix)) return size;
    }
  }
  return null;
}

/**
 * How full the prompt is, 0-100, or null when the window is unknown.
 *
 * `promptTokens` should be everything the model reads — fresh input plus both
 * cache buckets. Cached tokens still occupy the window; billing treats them
 * differently, the context limit does not.
 */
export function contextFillPercent(
  promptTokens: number,
  modelId: string,
): number | null {
  const window = resolveContextWindow(modelId);
  if (window === null || window <= 0) return null;
  if (!Number.isFinite(promptTokens) || promptTokens < 0) return null;
  return Math.min(100, Math.round((promptTokens / window) * 100));
}

/**
 * Structural shape of the message fields this needs, so the derivation can live
 * beside the window table without the AI layer importing the DB types.
 */
export type TokenUsageSnapshot = {
  role: string;
  model?: string | undefined;
  tokensIn?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
};

export type ContextFill = {
  pct: number;
  prompt: number;
  size: number;
  model: string;
};

/**
 * Context fill for the newest assistant turn that reported usage, or null when
 * there is none yet or the model's window is unknown.
 *
 * Derived from the transcript rather than tracked in component state: the
 * message record already carries the model and all three token buckets, so a
 * parallel counter could only ever drift from it.
 */
export function deriveContextFill(
  messages: readonly TokenUsageSnapshot[],
): ContextFill | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const model = m.model;
    if (!model) continue;
    const prompt =
      (m.tokensIn ?? 0) + (m.cacheReadTokens ?? 0) + (m.cacheCreationTokens ?? 0);
    if (prompt <= 0) continue;
    const pct = contextFillPercent(prompt, model);
    const size = resolveContextWindow(model);
    if (pct === null || size === null) return null;
    return { pct, prompt, size, model };
  }
  return null;
}
