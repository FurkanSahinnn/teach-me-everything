import type { FlashcardRecord, Rating } from "@/lib/db/types";
import type { Sm2Update } from "@/lib/db/flashcards";

const DAY_MS = 86_400_000;
const RELEARNING_DELAY_MS = 10 * 60 * 1000;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 36_500;
// Anki convention: 8 lapses on the same card → it's a "leech". Surface to the
// user so they can rewrite the prompt instead of grinding the same broken card.
export const LEECH_THRESHOLD = 8;

export type Sm2State = {
  ease: number;
  interval: number;
  repetitions: number;
};

const QUALITY: Record<Rating, number> = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
};

export function computeSm2(
  state: Sm2State,
  rating: Rating,
  now: number = Date.now(),
): Sm2Update {
  const q = QUALITY[rating];
  let { ease, interval, repetitions } = state;

  if (q < 3) {
    repetitions = 0;
    interval = 0;
  } else {
    repetitions += 1;
    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(interval * ease);
    }
    if (rating === "hard") {
      interval = Math.max(1, Math.round(interval * 0.8));
    } else if (rating === "easy") {
      interval = Math.round(interval * 1.3);
    }
  }

  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < MIN_EASE) ease = MIN_EASE;

  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(0, interval));

  const dueAt =
    rating === "again" ? now + RELEARNING_DELAY_MS : now + interval * DAY_MS;

  return {
    ease: Number(ease.toFixed(3)),
    interval,
    repetitions,
    dueAt,
  };
}

// True when the card has accumulated >= 8 lapses ("again" ratings). Pure
// predicate so callers can run it inside renders or selectors without touching
// Dexie. Uses the v4 `lapses` field; older rows that escaped backfill fall
// through `?? 0` and are correctly treated as non-leech.
export function isLeech(card: Pick<FlashcardRecord, "lapses">): boolean {
  return (card.lapses ?? 0) >= LEECH_THRESHOLD;
}

export function formatNextDue(
  rating: Rating,
  next: Sm2Update,
  pick: (tr: string, en: string) => string,
): string {
  if (rating === "again") return pick("~10 dk", "~10 min");
  if (next.interval === 0) return pick("bugün", "today");
  if (next.interval === 1) return pick("1 gün", "1 day");
  return pick(`${next.interval} gün`, `${next.interval} days`);
}
