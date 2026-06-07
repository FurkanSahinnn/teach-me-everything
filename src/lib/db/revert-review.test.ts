import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyReview,
  createDeck,
  createFlashcard,
  getFlashcard,
  listReviewLogs,
  revertReview,
} from "./flashcards";
import { createWorkspace } from "./workspaces";
import { db } from "./schema";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function seedCard() {
  const ws = await createWorkspace({ name: "WS", color: "#000", initials: "W" });
  const deck = await createDeck({ workspaceId: ws.id, name: "Deck", color: "#000" });
  const card = await createFlashcard({
    workspaceId: ws.id,
    deckId: deck.id,
    question: "Q",
    answer: "A",
  });
  return { ws, deck, card };
}

describe("revertReview", () => {
  it("restores SM-2 state and removes the matching review log", async () => {
    const { card } = await seedCard();
    const result = await applyReview(card.id, "good", {
      ease: 2.6,
      interval: 1,
      repetitions: 1,
      dueAt: Date.now() + 86_400_000,
    });
    const after = await getFlashcard(card.id);
    expect(after?.repetitions).toBe(1);
    expect(after?.reviewCount).toBe(1);

    await revertReview(card.id, result.logId, result.snapshot);

    const restored = await getFlashcard(card.id);
    expect(restored?.repetitions).toBe(0);
    expect(restored?.reviewCount).toBe(0);
    expect(restored?.ease).toBe(card.ease);
    expect(restored?.interval).toBe(card.interval);
    expect(restored?.dueAt).toBe(card.dueAt);
    const logs = await listReviewLogs(card.id);
    expect(logs).toHaveLength(0);
  });

  it("decrements lapses when undoing an 'again' rating", async () => {
    const { card } = await seedCard();
    const result = await applyReview(card.id, "again", {
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      dueAt: Date.now() + 600_000,
    });
    const lapsed = await getFlashcard(card.id);
    expect(lapsed?.lapses).toBe(1);
    expect(lapsed?.againCount).toBe(1);

    await revertReview(card.id, result.logId, result.snapshot);

    const restored = await getFlashcard(card.id);
    expect(restored?.lapses).toBe(0);
    expect(restored?.againCount).toBe(0);
  });

  it("can revert sequential reviews back to original state when caller stacks snapshots", async () => {
    const { card } = await seedCard();
    const r1 = await applyReview(card.id, "good", {
      ease: 2.6,
      interval: 1,
      repetitions: 1,
      dueAt: Date.now() + 86_400_000,
    });
    const r2 = await applyReview(card.id, "good", {
      ease: 2.7,
      interval: 6,
      repetitions: 2,
      dueAt: Date.now() + 6 * 86_400_000,
    });
    expect((await getFlashcard(card.id))?.reviewCount).toBe(2);

    // LIFO unwind, mirroring the cards-page undo stack semantics
    await revertReview(card.id, r2.logId, r2.snapshot);
    expect((await getFlashcard(card.id))?.reviewCount).toBe(1);
    await revertReview(card.id, r1.logId, r1.snapshot);
    const restored = await getFlashcard(card.id);
    expect(restored?.reviewCount).toBe(0);
    expect(restored?.repetitions).toBe(0);
    expect(await listReviewLogs(card.id)).toHaveLength(0);
  });
});
