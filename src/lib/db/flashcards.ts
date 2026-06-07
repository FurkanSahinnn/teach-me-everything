import type { ContentLangMode } from "@/lib/ai/content-language";
import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  DeckRecord,
  FlashcardRecord,
  Rating,
  ReviewLogRecord,
} from "./types";

export type DeckInput = {
  id?: string;
  workspaceId: string;
  name: string;
  nameEn?: string;
  color: string;
  langMode?: ContentLangMode;
};

export type DeckPatch = Partial<Pick<DeckInput, "name" | "nameEn" | "color">>;

export type FlashcardInput = {
  id?: string;
  workspaceId: string;
  deckId?: string;
  sourceId?: string;
  chunkId?: string;
  question: string;
  questionEn?: string;
  answer: string;
  answerEn?: string;
  tags?: string[];
  citations?: { sourceId?: string; section?: string; quote?: string }[];
  generatedFrom?: {
    kind: "chat" | "batch";
    chunkIds?: string[];
    threadId?: string;
    model?: string;
    generatedAt: number;
  };
  langMode?: ContentLangMode;
};

export type FlashcardPatch = Partial<
  Pick<
    FlashcardRecord,
    | "question"
    | "questionEn"
    | "answer"
    | "answerEn"
    | "tags"
    | "deckId"
    | "citations"
  >
>;

export const SM2_DEFAULTS = {
  ease: 2.5,
  interval: 0,
  repetitions: 0,
} as const;

export async function createDeck(input: DeckInput): Promise<DeckRecord> {
  const now = Date.now();
  const record: DeckRecord = {
    id: input.id ?? newId("deck"),
    workspaceId: input.workspaceId,
    name: input.name,
    nameEn: input.nameEn,
    color: input.color,
    langMode: input.langMode,
    createdAt: now,
    updatedAt: now,
  };
  await db.decks.add(record);
  return record;
}

export async function getDeck(id: string): Promise<DeckRecord | undefined> {
  return db.decks.get(id);
}

export async function updateDeck(id: string, patch: DeckPatch): Promise<void> {
  await db.decks.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.transaction("rw", [db.decks, db.flashcards], async () => {
    await db.flashcards.where("deckId").equals(id).modify({ deckId: undefined });
    await db.decks.delete(id);
  });
}

export async function listDecksByWorkspace(
  workspaceId: string,
): Promise<DeckRecord[]> {
  const items = await db.decks
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createFlashcard(
  input: FlashcardInput,
): Promise<FlashcardRecord> {
  const now = Date.now();
  const record: FlashcardRecord = {
    id: input.id ?? newId("card"),
    workspaceId: input.workspaceId,
    deckId: input.deckId,
    sourceId: input.sourceId,
    chunkId: input.chunkId,
    question: input.question,
    questionEn: input.questionEn,
    answer: input.answer,
    answerEn: input.answerEn,
    tags: input.tags ?? [],
    citations: input.citations,
    generatedFrom: input.generatedFrom,
    langMode: input.langMode,
    ease: SM2_DEFAULTS.ease,
    interval: SM2_DEFAULTS.interval,
    repetitions: SM2_DEFAULTS.repetitions,
    dueAt: now,
    lastReviewedAt: null,
    lastRating: null,
    reviewCount: 0,
    successCount: 0,
    againCount: 0,
    leech: false,
    lapses: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.flashcards.add(record);
  return record;
}

export async function getFlashcard(
  id: string,
): Promise<FlashcardRecord | undefined> {
  return db.flashcards.get(id);
}

export async function updateFlashcard(
  id: string,
  patch: FlashcardPatch,
): Promise<void> {
  await db.flashcards.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteFlashcard(id: string): Promise<void> {
  await db.transaction("rw", [db.flashcards, db.reviewLogs], async () => {
    await db.reviewLogs.where("flashcardId").equals(id).delete();
    await db.flashcards.delete(id);
  });
}

export async function listFlashcardsByWorkspace(
  workspaceId: string,
): Promise<FlashcardRecord[]> {
  const items = await db.flashcards
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listFlashcardsByDeck(
  deckId: string,
): Promise<FlashcardRecord[]> {
  const items = await db.flashcards.where("deckId").equals(deckId).toArray();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listDueFlashcards(
  workspaceId: string,
  until: number = Date.now(),
  limit: number = 50,
): Promise<FlashcardRecord[]> {
  const items = await db.flashcards
    .where("[workspaceId+dueAt]")
    .between([workspaceId, 0], [workspaceId, until], true, true)
    .toArray();
  return items.sort((a, b) => a.dueAt - b.dueAt).slice(0, limit);
}

export async function countFlashcards(workspaceId: string): Promise<number> {
  return db.flashcards.where("workspaceId").equals(workspaceId).count();
}

export async function countDueFlashcards(
  workspaceId: string,
  until: number = Date.now(),
): Promise<number> {
  return db.flashcards
    .where("[workspaceId+dueAt]")
    .between([workspaceId, 0], [workspaceId, until], true, true)
    .count();
}

export type Sm2Update = {
  ease: number;
  interval: number;
  repetitions: number;
  dueAt: number;
};

export type ApplyReviewOptions = {
  /** Wall-clock ms the user spent on this card (reveal → rate). Persisted to
   *  ReviewLogRecord.durationMs so streak/study-minute aggregates can be real
   *  instead of an estimate. */
  durationMs?: number;
};

// Mutable card state restored verbatim by `revertReview` to undo the last
// applyReview without losing the SM-2 history (lapses stay decremented, ease
// restored, etc.). Captured atomically inside the same transaction so two
// quick rates can't race the snapshot.
export type ReviewSnapshot = {
  ease: number;
  interval: number;
  repetitions: number;
  dueAt: number;
  lastReviewedAt: number | null;
  lastRating: Rating | null;
  reviewCount: number;
  successCount: number;
  againCount: number;
  lapses: number;
  leech: boolean;
  updatedAt: number;
};

export type ApplyReviewResult = {
  logId: string;
  snapshot: ReviewSnapshot;
};

export async function applyReview(
  cardId: string,
  rating: Rating,
  next: Sm2Update,
  opts?: ApplyReviewOptions,
): Promise<ApplyReviewResult> {
  return db.transaction("rw", [db.flashcards, db.reviewLogs], async () => {
    const card = await db.flashcards.get(cardId);
    if (!card) throw new Error(`Flashcard not found: ${cardId}`);
    const now = Date.now();
    const success = rating !== "again";
    const newAgainCount =
      rating === "again" ? card.againCount + 1 : card.againCount;
    // `lapses` is the canonical leech-detection counter (>= 8 → leech).
    // Increment on every "again"; preserve on hard/good/easy. Coalesce because
    // pre-v4 rows that survived migration without backfill would be undefined.
    const newLapses =
      rating === "again" ? (card.lapses ?? 0) + 1 : (card.lapses ?? 0);
    const snapshot: ReviewSnapshot = {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
      dueAt: card.dueAt,
      lastReviewedAt: card.lastReviewedAt,
      lastRating: card.lastRating,
      reviewCount: card.reviewCount,
      successCount: card.successCount,
      againCount: card.againCount,
      lapses: card.lapses ?? 0,
      leech: card.leech,
      updatedAt: card.updatedAt,
    };
    const log: ReviewLogRecord = {
      id: newId("rev"),
      flashcardId: cardId,
      workspaceId: card.workspaceId,
      rating,
      intervalBefore: card.interval,
      intervalAfter: next.interval,
      easeBefore: card.ease,
      easeAfter: next.ease,
      reviewedAt: now,
      // Only persist when caller supplied a sane positive duration; an
      // undefined column keeps reviewLogs forward-compatible with v8 readers.
      ...(typeof opts?.durationMs === "number" && opts.durationMs >= 0
        ? { durationMs: Math.round(opts.durationMs) }
        : {}),
    };
    await db.reviewLogs.add(log);
    await db.flashcards.update(cardId, {
      ease: next.ease,
      interval: next.interval,
      repetitions: next.repetitions,
      dueAt: next.dueAt,
      lastReviewedAt: now,
      lastRating: rating,
      reviewCount: card.reviewCount + 1,
      successCount: success ? card.successCount + 1 : card.successCount,
      againCount: newAgainCount,
      lapses: newLapses,
      leech: newLapses >= 8,
      updatedAt: now,
    });
    return { logId: log.id, snapshot };
  });
}

/**
 * Reverse the most recent `applyReview` for a card: delete the review log and
 * restore the captured pre-state snapshot. Idempotent — calling twice with the
 * same logId after the row is gone is a no-op (the snapshot is still re-
 * applied so the card converges to the pre-review state). Used by the cards
 * page Cmd/Ctrl+Z undo.
 */
export async function revertReview(
  cardId: string,
  logId: string,
  snapshot: ReviewSnapshot,
): Promise<void> {
  await db.transaction("rw", [db.flashcards, db.reviewLogs], async () => {
    const card = await db.flashcards.get(cardId);
    if (!card) throw new Error(`Flashcard not found: ${cardId}`);
    await db.reviewLogs.delete(logId);
    await db.flashcards.update(cardId, {
      ease: snapshot.ease,
      interval: snapshot.interval,
      repetitions: snapshot.repetitions,
      dueAt: snapshot.dueAt,
      lastReviewedAt: snapshot.lastReviewedAt,
      lastRating: snapshot.lastRating,
      reviewCount: snapshot.reviewCount,
      successCount: snapshot.successCount,
      againCount: snapshot.againCount,
      lapses: snapshot.lapses,
      leech: snapshot.leech,
      updatedAt: snapshot.updatedAt,
    });
  });
}

export async function listReviewLogs(
  flashcardId: string,
): Promise<ReviewLogRecord[]> {
  const items = await db.reviewLogs
    .where("flashcardId")
    .equals(flashcardId)
    .toArray();
  return items.sort((a, b) => b.reviewedAt - a.reviewedAt);
}
