import { describe, expect, it } from "vitest";
import { buildSession } from "./session";
import type { FlashcardRecord } from "@/lib/db/types";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function mkCard(
  partial: Partial<FlashcardRecord> & { id: string },
): FlashcardRecord {
  return {
    id: partial.id,
    workspaceId: partial.workspaceId ?? "ws1",
    deckId: partial.deckId,
    sourceId: partial.sourceId,
    chunkId: partial.chunkId,
    question: partial.question ?? "q",
    answer: partial.answer ?? "a",
    tags: partial.tags ?? [],
    citations: partial.citations,
    ease: partial.ease ?? 2.5,
    interval: partial.interval ?? 0,
    repetitions: partial.repetitions ?? 0,
    dueAt: partial.dueAt ?? NOW,
    lastReviewedAt: partial.lastReviewedAt ?? null,
    lastRating: partial.lastRating ?? null,
    reviewCount: partial.reviewCount ?? 0,
    successCount: partial.successCount ?? 0,
    againCount: partial.againCount ?? 0,
    leech: partial.leech ?? false,
    lapses: partial.lapses ?? 0,
    createdAt: partial.createdAt ?? NOW,
    updatedAt: partial.updatedAt ?? NOW,
  };
}

describe("buildSession", () => {
  it("returns empty plan for empty input", () => {
    const plan = buildSession({ cards: [], dueLimit: 50, newLimit: 20, now: NOW });
    expect(plan.order).toEqual([]);
    expect(plan.dueCount).toBe(0);
    expect(plan.newCount).toBe(0);
    expect(plan.skipped).toEqual({ dueOver: 0, newOver: 0 });
  });

  it("treats reviewCount === 0 as new (not interval/repetitions)", () => {
    // A lapsed card has reviewCount > 0, repetitions === 0, interval === 0,
    // dueAt soon. It must be classified as DUE, not NEW.
    const lapsed = mkCard({ id: "lapsed", reviewCount: 5, repetitions: 0, interval: 0, dueAt: NOW - DAY });
    const fresh = mkCard({ id: "fresh", reviewCount: 0, repetitions: 0, interval: 0, dueAt: NOW + DAY });
    const plan = buildSession({ cards: [lapsed, fresh], dueLimit: 50, newLimit: 20, now: NOW });
    expect(plan.dueCount).toBe(1);
    expect(plan.newCount).toBe(1);
    expect(plan.order).toEqual(["lapsed", "fresh"]);
  });

  it("excludes cards whose dueAt is in the future from the due bucket", () => {
    const future = mkCard({ id: "future", reviewCount: 1, dueAt: NOW + DAY });
    const dueNow = mkCard({ id: "now", reviewCount: 1, dueAt: NOW - 60_000 });
    const plan = buildSession({ cards: [future, dueNow], dueLimit: 50, newLimit: 20, now: NOW });
    expect(plan.dueCount).toBe(1);
    expect(plan.order).toEqual(["now"]);
  });

  it("sorts due cards by oldest dueAt first (most overdue priority)", () => {
    const cards = [
      mkCard({ id: "b", reviewCount: 1, dueAt: NOW - 1 * DAY }),
      mkCard({ id: "a", reviewCount: 1, dueAt: NOW - 5 * DAY }),
      mkCard({ id: "c", reviewCount: 1, dueAt: NOW - 3 * DAY }),
    ];
    const plan = buildSession({ cards, dueLimit: 50, newLimit: 0, now: NOW });
    expect(plan.order).toEqual(["a", "c", "b"]);
  });

  it("sorts new cards by oldest createdAt (FIFO backlog)", () => {
    const cards = [
      mkCard({ id: "n2", reviewCount: 0, createdAt: NOW - 1 * DAY }),
      mkCard({ id: "n1", reviewCount: 0, createdAt: NOW - 5 * DAY }),
      mkCard({ id: "n3", reviewCount: 0, createdAt: NOW - 0.5 * DAY }),
    ];
    const plan = buildSession({ cards, dueLimit: 0, newLimit: 50, now: NOW });
    expect(plan.order).toEqual(["n1", "n2", "n3"]);
  });

  it("respects dailyReview cap and reports the overflow in skipped.dueOver", () => {
    const cards: FlashcardRecord[] = [];
    for (let i = 0; i < 10; i++) {
      cards.push(mkCard({ id: `d${i}`, reviewCount: 1, dueAt: NOW - (10 - i) * 60_000 }));
    }
    const plan = buildSession({ cards, dueLimit: 3, newLimit: 0, now: NOW });
    expect(plan.dueCount).toBe(3);
    expect(plan.skipped.dueOver).toBe(7);
    expect(plan.order).toHaveLength(3);
  });

  it("respects dailyNew cap and reports the overflow in skipped.newOver", () => {
    const cards: FlashcardRecord[] = [];
    for (let i = 0; i < 8; i++) {
      cards.push(mkCard({ id: `n${i}`, reviewCount: 0, createdAt: NOW - (8 - i) * 60_000 }));
    }
    const plan = buildSession({ cards, dueLimit: 0, newLimit: 2, now: NOW });
    expect(plan.newCount).toBe(2);
    expect(plan.skipped.newOver).toBe(6);
    expect(plan.order).toHaveLength(2);
  });

  it("interleaves 2 due + 1 new per cycle and falls back when one bucket empties", () => {
    const due = [
      mkCard({ id: "d1", reviewCount: 1, dueAt: NOW - 6 * DAY }),
      mkCard({ id: "d2", reviewCount: 1, dueAt: NOW - 5 * DAY }),
      mkCard({ id: "d3", reviewCount: 1, dueAt: NOW - 4 * DAY }),
      mkCard({ id: "d4", reviewCount: 1, dueAt: NOW - 3 * DAY }),
      mkCard({ id: "d5", reviewCount: 1, dueAt: NOW - 2 * DAY }),
    ];
    const fresh = [
      mkCard({ id: "n1", reviewCount: 0, createdAt: NOW - 3 * DAY }),
      mkCard({ id: "n2", reviewCount: 0, createdAt: NOW - 2 * DAY }),
    ];
    const plan = buildSession({
      cards: [...due, ...fresh],
      dueLimit: 50,
      newLimit: 50,
      now: NOW,
    });
    // Cycle 1: d1, d2, n1 ; cycle 2: d3, d4, n2 ; cycle 3: d5 (new bucket exhausted)
    expect(plan.order).toEqual(["d1", "d2", "n1", "d3", "d4", "n2", "d5"]);
    expect(plan.dueCount).toBe(5);
    expect(plan.newCount).toBe(2);
  });
});
