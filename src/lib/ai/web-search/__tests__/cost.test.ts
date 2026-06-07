import { describe, expect, it } from "vitest";
import { computeWebSearchCostUsd } from "@/lib/ai/pricing";
import type {
  WebSearchCapability,
  WebSearchUsage,
} from "@/lib/ai/web-search/types";

describe("computeWebSearchCostUsd", () => {
  it("returns 0 when no capability is provided", () => {
    expect(computeWebSearchCostUsd(undefined, { calls: 5, results: 30 })).toBe(
      0,
    );
  });

  it("returns 0 when both pricePerCall and pricePerResult are absent", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses"],
    };
    expect(computeWebSearchCostUsd(cap, { calls: 10, results: 50 })).toBe(0);
  });

  it("bills per-call when pricePerCall is set", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses"],
      pricePerCall: 0.01,
    };
    const usage: WebSearchUsage = { calls: 5 };
    // 5 × $0.01 = $0.05
    expect(computeWebSearchCostUsd(cap, usage)).toBeCloseTo(0.05, 6);
  });

  it("bills per-result when pricePerResult is set", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses"],
      pricePerResult: 0.001,
    };
    const usage: WebSearchUsage = { results: 25 };
    // 25 × $0.001 = $0.025
    expect(computeWebSearchCostUsd(cap, usage)).toBeCloseTo(0.025, 6);
  });

  it("sums per-call and per-result when both are set", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses", "recencyDays"],
      pricePerCall: 0.005,
      pricePerResult: 0.002,
    };
    const usage: WebSearchUsage = { calls: 4, results: 10 };
    // 4 × 0.005 + 10 × 0.002 = 0.02 + 0.02 = 0.04
    expect(computeWebSearchCostUsd(cap, usage)).toBeCloseTo(0.04, 6);
  });

  it("treats missing usage fields as zero", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses"],
      pricePerCall: 0.01,
      pricePerResult: 0.005,
    };
    expect(computeWebSearchCostUsd(cap, {})).toBe(0);
    expect(computeWebSearchCostUsd(cap, { calls: 0, results: 0 })).toBe(0);
  });

  it("never returns NaN even with negative usage (defensive)", () => {
    const cap: WebSearchCapability = {
      paramsSupported: ["maxUses"],
      pricePerCall: 0.01,
    };
    // Negative inputs would be a bug upstream; we still want a finite number
    // back rather than crashing the cost chip.
    const value = computeWebSearchCostUsd(cap, { calls: -1 });
    expect(Number.isFinite(value)).toBe(true);
  });
});
