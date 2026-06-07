import { describe, expect, it, vi } from "vitest";
import { computeCostUsd, PRICING } from "./pricing";

describe("computeCostUsd", () => {
  it("computes opus cost from input + output tokens", () => {
    const usd = computeCostUsd("claude-opus-4-7", {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // 1000 * 15 / 1M = 0.015 ; 500 * 75 / 1M = 0.0375 ; total = 0.0525
    expect(usd).toBeCloseTo(0.0525, 6);
  });

  it("prices cache reads at 10% of input for opus", () => {
    const opus = PRICING["claude-opus-4-7"]!;
    expect(opus.cacheRead / opus.input).toBeCloseTo(0.1, 6);
    const usd = computeCostUsd("claude-opus-4-7", {
      cache_read_input_tokens: 10_000,
    });
    // 10_000 * 1.5 / 1M = 0.015
    expect(usd).toBeCloseTo(0.015, 6);
  });

  it("prices cache creation at 1.25x input for opus", () => {
    const opus = PRICING["claude-opus-4-7"]!;
    expect(opus.cacheCreation / opus.input).toBeCloseTo(1.25, 6);
    const usd = computeCostUsd("claude-opus-4-7", {
      cache_creation_input_tokens: 1000,
    });
    // 1000 * 18.75 / 1M = 0.01875
    expect(usd).toBeCloseTo(0.01875, 6);
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
