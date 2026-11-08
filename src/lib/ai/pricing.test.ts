import { describe, expect, it, vi } from "vitest";
import { computeCostUsd, PRICING } from "./pricing";

describe("computeCostUsd", () => {
  it("computes opus cost from input + output tokens", () => {
    const usd = computeCostUsd("claude-opus-4-7", {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // 1000 * 5 / 1M = 0.005 ; 500 * 25 / 1M = 0.0125 ; total = 0.0175
    expect(usd).toBeCloseTo(0.0175, 6);
  });

  it("prices cache reads at 10% of input for opus", () => {
    const opus = PRICING["claude-opus-4-7"]!;
    expect(opus.cacheRead / opus.input).toBeCloseTo(0.1, 6);
    const usd = computeCostUsd("claude-opus-4-7", {
      cache_read_input_tokens: 10_000,
    });
    // 10_000 * 0.5 / 1M = 0.005
    expect(usd).toBeCloseTo(0.005, 6);
  });

  it("prices cache creation at 1.25x input for opus", () => {
    const opus = PRICING["claude-opus-4-7"]!;
    expect(opus.cacheCreation / opus.input).toBeCloseTo(1.25, 6);
    const usd = computeCostUsd("claude-opus-4-7", {
      cache_creation_input_tokens: 1000,
    });
    // 1000 * 6.25 / 1M = 0.00625
    expect(usd).toBeCloseTo(0.00625, 6);
  });

  it("sums all four token buckets", () => {
    const usd = computeCostUsd("claude-sonnet-4-6", {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 1000,
    });
    // (1000*3 + 1000*15 + 1000*0.3 + 1000*3.75) / 1M = 22050 / 1M = 0.02205
    expect(usd).toBeCloseTo(0.02205, 9);
  });

  it("returns 0 for unknown model and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const usd = computeCostUsd("not-a-real-model", {
      input_tokens: 1_000_000,
    });
    expect(usd).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("treats missing token fields as 0", () => {
    const usd = computeCostUsd("claude-haiku-4-5-20251001", {});
    expect(usd).toBe(0);
  });
});

// Official list prices (USD / MTok, 5-minute cache writes), checked 2026-11-08:
// https://platform.claude.com/docs/en/about-claude/pricing
// https://developers.openai.com/api/docs/pricing (standard tier, <=272K context)
describe("PRICING list prices", () => {
  it.each([
    ["claude-fable-5-1", { input: 10, output: 50, cacheRead: 0.25, cacheCreation: 12.5 }],
    ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2, cacheCreation: 5 }],
    ["claude-opus-5", { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 }],
    ["claude-opus-4-7", { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 }],
    ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.1, cacheCreation: 2.5 }],
    ["claude-sonnet-4-6", { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }],
    ["claude-haiku-5-5", { input: 0.1, output: 0.5, cacheRead: 0.01, cacheCreation: 0.125 }],
    ["claude-haiku-4-5", { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 }],
    ["gpt-6-astra", { input: 10, output: 50, cacheRead: 1, cacheCreation: 12.5 }],
    ["gpt-5.6-sol", { input: 4, output: 20, cacheRead: 0.4, cacheCreation: 5 }],
    ["gpt-5.5", { input: 5, output: 30, cacheRead: 0.5, cacheCreation: 0 }],
    ["gpt-5", { input: 1.25, output: 10, cacheRead: 0.125, cacheCreation: 0 }],
  ])("%s matches the published rate card", (model, expected) => {
    expect(PRICING[model]).toEqual(expected);
  });
});
