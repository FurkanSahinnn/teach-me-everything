import type { UsageRange } from "./types";

const HOUR = 3_600_000;

export const USAGE_RANGES: readonly UsageRange[] = ["24h", "7d", "30d", "90d"];

const RANGE_MS: Record<UsageRange, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
  "90d": 90 * 24 * HOUR,
};

export function rangeToSinceMs(range: UsageRange, now: number): number {
  return now - RANGE_MS[range];
}
