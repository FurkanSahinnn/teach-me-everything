// Pure streak/heatmap helpers — keep React-free so they can be unit-tested
// against a fixed clock without a fake DOM. Both fns take a list of review
// timestamps (millis since epoch) and bucket them into local-midnight days.

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayDiff(laterMs: number, earlierMs: number): number {
  return Math.round((laterMs - earlierMs) / DAY_MS);
}

/**
 * Number of consecutive local-midnight days, walking back from `now`, that
 * contain at least one review. If today has zero reviews the streak is 0 —
 * matching Anki's behaviour, where the streak resets the moment you skip.
 */
export function computeStreakDays(
  reviewedAt: readonly number[],
  now: number = Date.now(),
): number {
  if (reviewedAt.length === 0) return 0;
  const dayKeys = new Set<number>();
  for (const ts of reviewedAt) {
    if (!Number.isFinite(ts)) continue;
    dayKeys.add(startOfDay(ts));
  }
  let streak = 0;
  let cursor = startOfDay(now);
  while (dayKeys.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/**
 * Per-day review counts for the trailing `days` window ending at `now`.
 * Index 0 = oldest day in the window, last index = today. Used by the
 * dashboard streak heatmap; pure number array so the UI can map to its
 * own colour scale (none / partial / full) without coupling to count.
 */
export function computeStreakHeatmap(
  reviewedAt: readonly number[],
  now: number = Date.now(),
  days: number = 30,
): number[] {
  const buckets = new Array<number>(Math.max(0, Math.floor(days))).fill(0);
  if (buckets.length === 0) return buckets;
  const todayMidnight = startOfDay(now);
  for (const ts of reviewedAt) {
    if (!Number.isFinite(ts)) continue;
    const diff = dayDiff(todayMidnight, startOfDay(ts));
    if (diff < 0 || diff >= buckets.length) continue;
    const idx = buckets.length - 1 - diff;
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return buckets;
}
