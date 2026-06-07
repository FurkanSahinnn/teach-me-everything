import type { FlashcardRecord } from "@/lib/db/types";

export type BuildSessionInput = {
  cards: FlashcardRecord[];
  now?: number;
  dueLimit: number;
  newLimit: number;
};

export type SessionPlan = {
  /** Ordered card IDs to review (interleaved due + new). */
  order: string[];
  /** How many of `order` originated from the due bucket. */
  dueCount: number;
  /** How many of `order` originated from the new bucket. */
  newCount: number;
  /** How many cards were skipped after the bucket caps were hit. */
  skipped: { dueOver: number; newOver: number };
};

const DEFAULT_DUE_LIMIT = 200;
const DEFAULT_NEW_LIMIT = 20;

// A card counts as "new" only when it has never been reviewed (`reviewCount`
// === 0). We deliberately do NOT use `repetitions` because SM-2 resets
// repetitions to 0 on every "again" — those are lapsed reviews, not new
// material. `dueAt` <= now is the standard due check.
function isNewCard(card: FlashcardRecord): boolean {
  return card.reviewCount === 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Pure session builder. Splits `cards` into "due" and "new" buckets, applies
 * daily caps, and interleaves them so the user gets a steady mix instead of
 * 50 review cards in a row followed by 20 new ones.
 *
 * Interleave pattern: 2 due + 1 new, repeat. Falls back to whichever bucket
 * still has cards when the other is empty.
 */
export function buildSession(input: BuildSessionInput): SessionPlan {
  const now = input.now ?? Date.now();
  const dueLimit = clamp(Math.round(input.dueLimit ?? DEFAULT_DUE_LIMIT), 0, 10_000);
  const newLimit = clamp(Math.round(input.newLimit ?? DEFAULT_NEW_LIMIT), 0, 10_000);

  // Sort each bucket independently so the caller doesn't have to. Due cards
  // sort by oldest dueAt first (most overdue → highest priority); new cards
  // sort by oldest createdAt so the user works through the backlog FIFO.
  const dueAll = input.cards
    .filter((c) => !isNewCard(c) && c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
  const newAll = input.cards
    .filter((c) => isNewCard(c))
    .sort((a, b) => a.createdAt - b.createdAt);

  const due = dueAll.slice(0, dueLimit);
  const fresh = newAll.slice(0, newLimit);

  const order: string[] = [];
  let di = 0;
  let ni = 0;
  while (di < due.length || ni < fresh.length) {
    // Emit up to 2 due cards per cycle.
    for (let k = 0; k < 2 && di < due.length; k++) {
      const card = due[di]!;
      order.push(card.id);
      di += 1;
    }
    if (ni < fresh.length) {
      const card = fresh[ni]!;
      order.push(card.id);
      ni += 1;
    }
  }

  return {
    order,
    dueCount: due.length,
    newCount: fresh.length,
    skipped: {
      dueOver: Math.max(0, dueAll.length - due.length),
      newOver: Math.max(0, newAll.length - fresh.length),
    },
  };
}
