import { describe, expect, it } from "vitest";
import { buildDashboardActivity } from "./activity";
import type {
  ChatMessageRecord,
  FlashcardRecord,
  HighlightRecord,
  ReviewLogRecord,
  SourceRecord,
} from "@/lib/db/types";
import type { QuizSessionRecord } from "@/lib/quiz/types";

const NOW = new Date("2026-05-04T12:00:00+03:00").getTime();
const TODAY_09 = new Date("2026-05-04T09:00:00+03:00").getTime();
const YESTERDAY = new Date("2026-05-03T23:00:00+03:00").getTime();

function flashcard(partial: Partial<FlashcardRecord>): FlashcardRecord {
  return {
    id: "card",
    workspaceId: "ws",
    question: "Q",
    answer: "A",
    tags: [],
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    dueAt: NOW,
    lastReviewedAt: null,
    lastRating: null,
    reviewCount: 0,
    successCount: 0,
    againCount: 0,
    leech: false,
    lapses: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function source(partial: Partial<SourceRecord>): SourceRecord {
  return {
    id: "src",
    workspaceId: "ws",
    type: "pdf",
    title: "Paper",
    ingestStatus: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function review(partial: Partial<ReviewLogRecord>): ReviewLogRecord {
  return {
    id: "rev",
    flashcardId: "card",
    workspaceId: "ws",
    rating: "good",
    intervalBefore: 0,
    intervalAfter: 1,
    easeBefore: 2.5,
    easeAfter: 2.5,
    reviewedAt: NOW,
    ...partial,
  };
}

function highlight(partial: Partial<HighlightRecord>): HighlightRecord {
  return {
    id: "hl",
    sourceId: "src",
    workspaceId: "ws",
    text: "Important passage",
    color: "yellow",
    spanStart: 0,
    spanEnd: 10,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function chat(partial: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: "msg",
    threadId: "thr",
    workspaceId: "ws",
    role: "assistant",
    content: "Answer body",
    createdAt: NOW,
    ...partial,
  };
}

function quiz(partial: Partial<QuizSessionRecord>): QuizSessionRecord {
  return {
    id: "quiz",
    workspaceId: "ws",
    items: [],
    answers: [],
    startedAt: NOW,
    ...partial,
  };
}

describe("buildDashboardActivity", () => {
  it("builds Today from live due/review/source/highlight/quiz data", () => {
    const activity = buildDashboardActivity(
      {
        flashcards: [
          flashcard({ id: "due", dueAt: NOW - 1 }),
          flashcard({ id: "future", dueAt: NOW + 60_000 }),
        ],
        reviewLogs: [
          review({ id: "today-review", reviewedAt: TODAY_09 }),
          review({ id: "old-review", reviewedAt: YESTERDAY }),
        ],
        sources: [
          source({ id: "today-source", createdAt: TODAY_09 }),
          source({ id: "old-source", createdAt: YESTERDAY }),
        ],
        highlights: [highlight({ id: "today-highlight", createdAt: TODAY_09 })],
        chatMessages: [],
        quizSessions: [quiz({ id: "today-quiz", finishedAt: TODAY_09 })],
      },
      NOW,
    );

    expect(activity.today.map((item) => [item.kind, item.count])).toEqual([
      ["due", 1],
      ["review", 1],
      ["source", 1],
      ["highlight", 1],
      ["quiz", 1],
    ]);
  });

  it("sorts Recent activity by real timestamps and ignores empty user chat", () => {
    const activity = buildDashboardActivity(
      {
        flashcards: [],
        reviewLogs: [review({ id: "old-review", reviewedAt: NOW - 3_000 })],
        sources: [source({ id: "new-source", title: "New", createdAt: NOW - 1_000 })],
        highlights: [highlight({ id: "highlight", createdAt: NOW - 2_000 })],
        chatMessages: [
          chat({ id: "assistant", content: "Assistant answer", createdAt: NOW }),
          chat({ id: "user", role: "user", content: "Question", createdAt: NOW + 1 }),
        ],
        quizSessions: [quiz({ id: "quiz", startedAt: NOW - 4_000 })],
      },
      NOW,
    );

    expect(activity.recent.map((item) => item.id)).toEqual([
      "chat:assistant",
      "source:new-source",
      "highlight:highlight",
      "review:old-review",
      "quiz:quiz",
    ]);
  });
});
