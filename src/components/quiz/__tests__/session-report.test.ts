import { describe, it, expect } from "vitest";
import { aggregateReport } from "../SessionReportModal";
import type { QuizAnswer, QuizItem } from "@/lib/quiz/types";

const MCQ = (
  q: string,
  correctIndex: number,
  sourceChunkId?: string,
  sourceSection?: string,
): QuizItem => ({
  kind: "mcq",
  q,
  choices: ["a", "b", "c", "d"],
  correctIndex,
  ...(sourceChunkId !== undefined ? { sourceChunkId } : {}),
  ...(sourceSection !== undefined ? { sourceSection } : {}),
});

const OPEN = (
  q: string,
  rubric: string,
  sourceChunkId?: string,
): QuizItem => ({
  kind: "open",
  q,
  rubric,
  ...(sourceChunkId !== undefined ? { sourceChunkId } : {}),
});

function mcqAnswer(
  itemIndex: number,
  selectedIndex: number,
  correct: boolean,
): QuizAnswer {
  return {
    kind: "mcq",
    itemIndex,
    selectedIndex,
    correct,
    answeredAt: 1000 + itemIndex,
  };
}

function openAnswer(
  itemIndex: number,
  correct: boolean | null,
  feedback?: string,
): QuizAnswer {
  return {
    kind: "open",
    itemIndex,
    text: "user text",
    correct,
    answeredAt: 1000 + itemIndex,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

describe("aggregateReport", () => {
  it("returns zero score and empty weak list for an unanswered session", () => {
    const items = [MCQ("Q1", 0), MCQ("Q2", 1)];
    const r = aggregateReport(items, []);
    expect(r.score).toBe(0);
    expect(r.correctCount).toBe(0);
    expect(r.weakChunks).toEqual([]);
    expect(r.perItem).toHaveLength(2);
    expect(r.perItem[0]?.correct).toBeNull();
    expect(r.perItem[1]?.correct).toBeNull();
  });

  it("scores correct/total and skips items without an answer", () => {
    const items = [MCQ("Q1", 0), MCQ("Q2", 1), MCQ("Q3", 2)];
    const answers = [
      mcqAnswer(0, 0, true), // correct
      mcqAnswer(2, 0, false), // wrong; index 1 untouched
    ];
    const r = aggregateReport(items, answers);
    expect(r.correctCount).toBe(1);
    expect(r.score).toBeCloseTo(1 / 3, 5);
    expect(r.perItem[0]?.correct).toBe(true);
    expect(r.perItem[1]?.correct).toBeNull();
    expect(r.perItem[2]?.correct).toBe(false);
  });

  it("groups weak chunks by sourceChunkId, sorts by count desc, attaches sectionLabel", () => {
    const items = [
      MCQ("Q1", 0, "#3", "Intro"),
      MCQ("Q2", 1, "#3"),
      MCQ("Q3", 2, "#7", "Methods"),
      MCQ("Q4", 0, "#7"),
      OPEN("Q5", "rubric", "#3"),
    ];
    const answers = [
      mcqAnswer(0, 1, false), // weak #3
      mcqAnswer(1, 0, false), // weak #3
      mcqAnswer(2, 2, true), // correct
      mcqAnswer(3, 1, false), // weak #7
      openAnswer(4, null), // pending → still weak (#3)
    ];
    const r = aggregateReport(items, answers);
    expect(r.weakChunks.map((w) => w.chunkId)).toEqual(["#3", "#7"]);
    const w3 = r.weakChunks[0];
    const w7 = r.weakChunks[1];
    expect(w3?.count).toBe(3);
    expect(w3?.itemIndices).toEqual([0, 1, 4]);
    expect(w3?.sectionLabel).toBe("Intro");
    expect(w7?.count).toBe(1);
    expect(w7?.sectionLabel).toBe("Methods");
  });

  it("ignores items without a sourceChunkId in the weak list (still counts toward score)", () => {
    const items = [MCQ("Q1", 0), MCQ("Q2", 1, "#5")];
    const answers = [
      mcqAnswer(0, 1, false), // wrong but no chunkId → not in weak list
      mcqAnswer(1, 0, false), // wrong with chunkId → in weak list
    ];
    const r = aggregateReport(items, answers);
    expect(r.weakChunks).toHaveLength(1);
    expect(r.weakChunks[0]?.chunkId).toBe("#5");
    expect(r.score).toBe(0);
    expect(r.correctCount).toBe(0);
  });
});
