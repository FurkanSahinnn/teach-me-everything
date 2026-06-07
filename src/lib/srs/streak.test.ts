import { describe, expect, it } from "vitest";
import { computeStreakDays, computeStreakHeatmap } from "./streak";

// Wednesday 2026-04-29 12:00 local. Using midday so we don't accidentally
// straddle a midnight boundary on the host running the tests.
const NOW = new Date(2026, 3, 29, 12, 0, 0).getTime();
const DAY = 86_400_000;

function midday(daysAgo: number): number {
  return NOW - daysAgo * DAY;
}

describe("computeStreakDays", () => {
  it("returns 0 when there are no reviews at all", () => {
    expect(computeStreakDays([], NOW)).toBe(0);
  });

  it("returns 0 when today has no reviews even if yesterday did", () => {
    expect(computeStreakDays([midday(1), midday(2)], NOW)).toBe(0);
  });

  it("counts a 4-day streak when today and the prior 3 days each have a review", () => {
    expect(
      computeStreakDays([midday(0), midday(1), midday(2), midday(3)], NOW),
    ).toBe(4);
  });

  it("breaks the streak at the first missing day", () => {
    // Reviews on today, yesterday, and 4 days ago — gap at day-2/day-3 stops streak at 2
    expect(computeStreakDays([midday(0), midday(1), midday(4)], NOW)).toBe(2);
  });
});

describe("computeStreakHeatmap", () => {
  it("returns an array of the requested length filled with zeros when empty", () => {
    const out = computeStreakHeatmap([], NOW, 30);
    expect(out).toHaveLength(30);
    expect(out.every((n) => n === 0)).toBe(true);
  });

  it("places today's reviews in the last index and ignores out-of-window timestamps", () => {
    const out = computeStreakHeatmap(
      [midday(0), midday(0), midday(45)], // 45-day-old review must be dropped
      NOW,
      30,
    );
    expect(out[29]).toBe(2);
    expect(out.slice(0, 29).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("buckets reviews into the correct day index across the window", () => {
    const out = computeStreakHeatmap(
      [midday(0), midday(1), midday(1), midday(7)],
      NOW,
      30,
    );
    // today → idx 29; yesterday → idx 28 (count 2); 7 days ago → idx 22
    expect(out[29]).toBe(1);
    expect(out[28]).toBe(2);
    expect(out[22]).toBe(1);
  });
});
