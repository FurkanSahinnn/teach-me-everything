import { describe, expect, it } from "vitest";

import {
  contextFillPercent,
  deriveContextFill,
  resolveContextWindow,
} from "./context-window";

describe("resolveContextWindow", () => {
  it("knows the local CLI's bare aliases", () => {
    // The CLI takes `sonnet` / `opus` / `haiku` rather than pinned ids, so an
    // exact-match-only table would leave the meter permanently hidden for the
    // one provider that prompted it.
    expect(resolveContextWindow("sonnet")).toBe(200_000);
    expect(resolveContextWindow("opus")).toBe(200_000);
    expect(resolveContextWindow("haiku")).toBe(200_000);
  });

  it("matches dated and versioned model ids by prefix", () => {
    expect(resolveContextWindow("claude-sonnet-4-6")).toBe(200_000);
    expect(resolveContextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
    expect(resolveContextWindow("gpt-5-mini")).toBe(400_000);
    expect(resolveContextWindow("gemini-3.5-flash")).toBe(1_000_000);
  });

  it("does not let a 4-series id fall into the 5-series bucket", () => {
    expect(resolveContextWindow("gpt-4o-mini")).toBe(128_000);
    expect(resolveContextWindow("gpt-4-turbo")).toBe(128_000);
  });

  it("unwraps OpenRouter passthrough ids", () => {
    expect(resolveContextWindow("anthropic/claude-sonnet-4.5")).toBe(200_000);
    expect(resolveContextWindow("openai/gpt-5")).toBe(400_000);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveContextWindow("  Claude-Sonnet-4-6 ")).toBe(200_000);
  });

  it("returns null rather than guessing", () => {
    // A wrong percentage is worse than none: it would invite the user to keep
    // adding context right up to a limit that is not really there.
    expect(resolveContextWindow("some-unknown-model")).toBeNull();
    expect(resolveContextWindow("")).toBeNull();
  });
});

describe("contextFillPercent", () => {
  it("reports the share of the window the prompt occupies", () => {
    expect(contextFillPercent(20_000, "sonnet")).toBe(10);
    expect(contextFillPercent(100_000, "claude-opus-4-7")).toBe(50);
  });

  it("clamps a prompt that somehow exceeds the window", () => {
    expect(contextFillPercent(500_000, "sonnet")).toBe(100);
  });

  it("hides itself when the window is unknown or the input is nonsense", () => {
    expect(contextFillPercent(1_000, "some-unknown-model")).toBeNull();
    expect(contextFillPercent(-1, "sonnet")).toBeNull();
    expect(contextFillPercent(Number.NaN, "sonnet")).toBeNull();
  });

  it("counts a zero-token prompt as empty rather than hiding", () => {
    expect(contextFillPercent(0, "sonnet")).toBe(0);
  });
});

describe("deriveContextFill", () => {
  const assistant = (over: Record<string, unknown> = {}) => ({
    role: "assistant",
    model: "sonnet",
    tokensIn: 1_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...over,
  });

  it("reads the newest assistant turn that reported usage", () => {
    const fill = deriveContextFill([
      { role: "user" },
      assistant({ tokensIn: 1_000 }),
      { role: "user" },
      assistant({ tokensIn: 40_000 }),
    ]);
    expect(fill).toEqual({ pct: 20, prompt: 40_000, size: 200_000, model: "sonnet" });
  });

  it("counts cached tokens, which still occupy the window", () => {
    // Billing discounts them; the context limit does not, so a meter that
    // ignored them would read far too low on a long cached conversation.
    const fill = deriveContextFill([
      assistant({ tokensIn: 10, cacheReadTokens: 90_000, cacheCreationTokens: 9_990 }),
    ]);
    expect(fill?.prompt).toBe(100_000);
    expect(fill?.pct).toBe(50);
  });

  it("skips turns with no usage yet and falls back to an earlier one", () => {
    const fill = deriveContextFill([
      assistant({ tokensIn: 20_000 }),
      assistant({ tokensIn: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ]);
    expect(fill?.prompt).toBe(20_000);
  });

  it("ignores user turns and turns with no recorded model", () => {
    expect(deriveContextFill([{ role: "user", tokensIn: 50_000 }])).toBeNull();
    expect(deriveContextFill([assistant({ model: undefined })])).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(deriveContextFill([])).toBeNull();
  });
});
