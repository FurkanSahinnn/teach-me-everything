import { describe, expect, it, vi } from "vitest";
import { aggregateUsage, daysInRange } from "./aggregate";
import { lookupPricing } from "./pricing";
import { rangeToSinceMs } from "./range";
import type { UsageBucket, UsageScanResult } from "./types";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const OPTS = { now: NOW, tzOffsetMinutes: 0 } as const;

function bucket(p: Partial<UsageBucket>): UsageBucket {
  return {
    provider: "claude",
    model: "claude-sonnet-4-6",
    day: "2026-03-10",
    uncachedInput: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    events: 1,
    ...p,
  };
}

function scan(buckets: UsageBucket[]): UsageScanResult {
  return {
    buckets,
    sessions: { claude: 2, codex: 1 },
    malformed: 3,
    filesScanned: 4,
    roots: {
      claude: { path: "/c", found: true },
      codex: { path: "/x", found: false },
    },
  };
}

describe("rangeToSinceMs", () => {
  it("subtracts the range length", () => {
    expect(rangeToSinceMs("24h", NOW)).toBe(NOW - 86_400_000);
    expect(rangeToSinceMs("7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(rangeToSinceMs("30d", NOW)).toBe(NOW - 30 * 86_400_000);
    expect(rangeToSinceMs("90d", NOW)).toBe(NOW - 90 * 86_400_000);
  });
});

describe("daysInRange", () => {
  it("covers start day through today and honours the tz offset", () => {
    expect(daysInRange("24h", NOW, 0)).toEqual(["2026-03-09", "2026-03-10"]);
    expect(daysInRange("7d", NOW, 0)).toHaveLength(8);
    // 12:00Z + 13h = 01:00 next day locally
    expect(daysInRange("24h", NOW, 13 * 60).at(-1)).toBe("2026-03-11");
  });
});

describe("aggregateUsage", () => {
  it("totals tokens, cost and cache savings for priced models", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = aggregateUsage(
      scan([
        bucket({
          uncachedInput: 1_000_000,
          cachedInput: 2_000_000,
          cacheWrite: 1_000_000,
          output: 1_000_000,
          events: 5,
        }),
      ]),
      { range: "7d", ...OPTS },
    );
    // sonnet-4-6: in 3, out 15, cacheRead 0.3, cacheWrite 3.75
    expect(s.totals.processedTokens).toBe(5_000_000);
    expect(s.totals.events).toBe(5);
    expect(s.costByType.input).toBeCloseTo(3);
    expect(s.costByType.cacheRead).toBeCloseTo(0.6);
    expect(s.costByType.cacheWrite).toBeCloseTo(3.75);
    expect(s.costByType.output).toBeCloseTo(15);
    expect(s.totals.costUsd).toBeCloseTo(22.35);
    expect(s.totals.cacheSavingsUsd).toBeCloseTo(2 * (3 - 0.3));
    expect(s.unpricedModels).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports unpriced models with zero cost and no console warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = aggregateUsage(
      scan([
        bucket({ model: "claude-unreleased-9", output: 100 }),
        bucket({ provider: "codex", model: "gpt-unreleased-9", output: 50 }),
        bucket({ model: "claude-unreleased-9", day: "2026-03-09", output: 10 }),
      ]),
      { range: "7d", ...OPTS },
    );
    expect(s.unpricedModels).toEqual(["claude-unreleased-9", "gpt-unreleased-9"]);
    expect(s.totals.costUsd).toBe(0);
    expect(s.models.find((m) => m.model === "claude-unreleased-9")?.priced).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("splits per provider and model with shares", () => {
    const s = aggregateUsage(
      scan([
        bucket({ output: 300 }),
        bucket({ provider: "codex", model: "gpt-5", output: 100 }),
      ]),
      { range: "7d", ...OPTS },
    );
    expect(s.providers.map((p) => [p.provider, p.tokens, p.share, p.sessions])).toEqual([
      ["claude", 300, 75, 2],
      ["codex", 100, 25, 1],
    ]);
    expect(s.models[0]?.model).toBe("claude-sonnet-4-6");
    expect(s.models[0]?.share).toBe(75);
    expect(s.malformed).toBe(3);
  });

  it("builds a zero-filled per-day series per provider", () => {
    const s = aggregateUsage(
      scan([
        bucket({ day: "2026-03-08", output: 10 }),
        bucket({ provider: "codex", model: "gpt-5", day: "2026-03-10", output: 5 }),
        bucket({ day: "2026-03-10", output: 7 }),
        bucket({ day: "2020-01-01", output: 999 }), // outside the series
      ]),
      { range: "24h", ...OPTS },
    );
    expect(s.daily.map(({ day, claude, codex, total }) => ({ day, claude, codex, total }))).toEqual([
      { day: "2026-03-09", claude: 0, codex: 0, total: 0 },
      { day: "2026-03-10", claude: 7, codex: 5, total: 12 },
    ]);
    const week = aggregateUsage(scan([bucket({ day: "2026-03-08", output: 10 })]), {
      range: "7d",
      ...OPTS,
    });
    expect(week.daily.find((d) => d.day === "2026-03-08")?.total).toBe(10);
    expect(week.daily.find((d) => d.day === "2026-03-05")?.total).toBe(0);
  });

  it("adds per-day cost per provider, with zero for unpriced models", () => {
    const s = aggregateUsage(
      scan([
        bucket({ day: "2026-03-10", output: 1_000_000 }),
        bucket({ provider: "codex", model: "not-a-priced-model", day: "2026-03-10", output: 1_000 }),
      ]),
      { range: "24h", ...OPTS },
    );
    const today = s.daily.find((d) => d.day === "2026-03-10");
    expect(today?.claudeCost).toBeCloseTo(15, 6);
    expect(today?.codexCost).toBe(0);
    expect(today?.totalCost).toBeCloseTo(15, 6);
  });

  it("handles an empty scan", () => {
    const s = aggregateUsage(scan([]), { range: "30d", ...OPTS });
    expect(s.totals.processedTokens).toBe(0);
    expect(s.providers.every((p) => p.share === 0)).toBe(true);
  });
});

describe("lookupPricing", () => {
  it("falls back to the undated model id", () => {
    expect(lookupPricing("claude-sonnet-4-6-20260101")).toBe(lookupPricing("claude-sonnet-4-6"));
    expect(lookupPricing("nope")).toBeNull();
  });
});
