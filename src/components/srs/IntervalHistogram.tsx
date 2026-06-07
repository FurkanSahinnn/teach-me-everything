"use client";

import type { FlashcardRecord } from "@/lib/db/types";
import { useLocalePick } from "@/i18n/IntlProvider";

// Bucket label = upper inclusive bound in days. "0" = unseen/lapsed
// (interval === 0), "90+" = anything beyond a quarter. Mirrors Anki's
// distribution chart so users coming from there get a familiar read.
export const INTERVAL_BUCKETS = ["0", "1", "3", "7", "14", "30", "90+"] as const;
export type IntervalBucket = (typeof INTERVAL_BUCKETS)[number];

export type IntervalCounts = Record<IntervalBucket, number>;

const EMPTY_COUNTS: IntervalCounts = {
  "0": 0,
  "1": 0,
  "3": 0,
  "7": 0,
  "14": 0,
  "30": 0,
  "90+": 0,
};

/** Map a flashcard interval (days) to a histogram bucket. Pure for tests. */
export function intervalToBucket(intervalDays: number): IntervalBucket {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return "0";
  if (intervalDays === 1) return "1";
  if (intervalDays <= 3) return "3";
  if (intervalDays <= 7) return "7";
  if (intervalDays <= 14) return "14";
  if (intervalDays <= 30) return "30";
  return "90+";
}

/** Reduce a card list to per-bucket counts. Pure for tests. */
export function bucketIntervals(cards: FlashcardRecord[]): IntervalCounts {
  const out: IntervalCounts = { ...EMPTY_COUNTS };
  for (const card of cards) {
    const bucket = intervalToBucket(card.interval);
    out[bucket] += 1;
  }
  return out;
}

const BUCKET_TOOLTIPS_TR: Record<IntervalBucket, string> = {
  "0": "Yeni veya tekrar başlayanlar",
  "1": "1 gün",
  "3": "2–3 gün",
  "7": "4–7 gün",
  "14": "8–14 gün",
  "30": "15–30 gün",
  "90+": "31+ gün",
};

const BUCKET_TOOLTIPS_EN: Record<IntervalBucket, string> = {
  "0": "New or relearning",
  "1": "1 day",
  "3": "2–3 days",
  "7": "4–7 days",
  "14": "8–14 days",
  "30": "15–30 days",
  "90+": "31+ days",
};

export function IntervalHistogram({
  cards,
  className,
}: {
  cards: FlashcardRecord[];
  className?: string;
}) {
  const pick = useLocalePick();
  const counts = bucketIntervals(cards);
  const max = Math.max(1, ...INTERVAL_BUCKETS.map((b) => counts[b]));
  const total = cards.length;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-[15px] font-medium text-ink">
          {pick("Aralık dağılımı", "Interval distribution")}
        </h3>
        <span className="font-mono text-[11px] text-ink-3">
          {total} {pick("kart", total === 1 ? "card" : "cards")}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-2">
        {INTERVAL_BUCKETS.map((bucket) => {
          const value = counts[bucket];
          const heightPct = (value / max) * 100;
          return (
            <div
              key={bucket}
              className="flex flex-col items-center gap-1.5"
              title={pick(BUCKET_TOOLTIPS_TR[bucket], BUCKET_TOOLTIPS_EN[bucket])}
            >
              <div
                className="flex h-[64px] w-full items-end overflow-hidden rounded bg-paper-2"
                aria-hidden
              >
                <div
                  className="w-full bg-accent transition-[height]"
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <div className="font-mono text-[10.5px] tabular-nums text-ink">
                {value}
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">
                {bucket}
                {bucket === "90+" ? "" : "d"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
