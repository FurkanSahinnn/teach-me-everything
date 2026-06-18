import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlashcardRecord } from "@/lib/db/types";
import type { QuizSessionRecord } from "@/lib/quiz/types";

const listFlashcardsByWorkspace =
  vi.fn<(ws: string) => Promise<FlashcardRecord[]>>();
const listQuizSessionsByWorkspace =
  vi.fn<(ws: string, limit?: number) => Promise<QuizSessionRecord[]>>();

vi.mock("@/lib/db/flashcards", () => ({
  listFlashcardsByWorkspace: (ws: string) => listFlashcardsByWorkspace(ws),
}));
vi.mock("@/lib/db/quiz-sessions", () => ({
  listQuizSessionsByWorkspace: (ws: string, limit?: number) =>
    listQuizSessionsByWorkspace(ws, limit),
}));

const { buildPerformanceContext } = await import("./performance");

function card(partial: Partial<FlashcardRecord>): FlashcardRecord {
  return {
    id: partial.id ?? "card_1",
    workspaceId: "ws_1",
    question: partial.question ?? "Q?",
    answer: "A",
    tags: [],
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    dueAt: 0,
    lastReviewedAt: null,
    lastRating: null,
    reviewCount: partial.reviewCount ?? 0,
    successCount: partial.successCount ?? 0,
    againCount: 0,
    leech: partial.leech ?? false,
    lapses: partial.lapses ?? 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  listFlashcardsByWorkspace.mockReset();
  listQuizSessionsByWorkspace.mockReset();
});

describe("buildPerformanceContext", () => {
  it("returns null when there is no study activity", async () => {
    listFlashcardsByWorkspace.mockResolvedValue([
      card({ reviewCount: 0 }), // unreviewed → unknown, not weak
    ]);
    listQuizSessionsByWorkspace.mockResolvedValue([]);
    await expect(buildPerformanceContext("ws_1")).resolves.toBeNull();
  });

  it("surfaces weak cards (leech / high fail ratio / lapses)", async () => {
    listFlashcardsByWorkspace.mockResolvedValue([
      card({ id: "c1", question: "What is entropy?", reviewCount: 4, successCount: 1 }),
      card({ id: "c2", question: "Strong card", reviewCount: 5, successCount: 5 }),
      card({ id: "c3", question: "Leech card", reviewCount: 10, successCount: 6, leech: true }),
    ]);
    listQuizSessionsByWorkspace.mockResolvedValue([]);
    const block = await buildPerformanceContext("ws_1");
    expect(block?.kind).toBe("performance");
    expect(block?.text).toContain("What is entropy?");
    expect(block?.text).toContain("Leech card");
    expect(block?.text).toContain("[leech]");
    // The fully-correct card is not "weak" and must not appear.
    expect(block?.text).not.toContain("Strong card");
    // Leech (score 100+) ranks above the plain high-fail card.
    expect(block?.text.indexOf("Leech card")).toBeLessThan(
      block?.text.indexOf("What is entropy?") ?? -1,
    );
  });

  it("includes recently missed quiz questions", async () => {
    listFlashcardsByWorkspace.mockResolvedValue([]);
    listQuizSessionsByWorkspace.mockResolvedValue([
      {
        id: "quiz_1",
        workspaceId: "ws_1",
        items: [
          { kind: "mcq", q: "Capital of France?", choices: ["A", "B", "C", "D"], correctIndex: 0 },
          { kind: "mcq", q: "2 + 2?", choices: ["3", "4", "5", "6"], correctIndex: 1 },
        ],
        answers: [
          { kind: "mcq", itemIndex: 0, selectedIndex: 1, correct: false, answeredAt: 1 },
          { kind: "mcq", itemIndex: 1, selectedIndex: 1, correct: true, answeredAt: 2 },
        ],
        startedAt: 1,
      },
    ]);
    const block = await buildPerformanceContext("ws_1");
    expect(block?.text).toContain("Recently missed quiz questions:");
    expect(block?.text).toContain("Capital of France?");
    // The correctly answered item is not listed as a miss.
    expect(block?.text).not.toContain("2 + 2?");
  });
});
