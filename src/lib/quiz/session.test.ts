import { describe, it, expect } from "vitest";
import {
  answerForIndex,
  applyOpenEval,
  computeScore,
  finishSession,
  isSessionFinished,
  nextItem,
  submitAnswer,
  type SessionState,
} from "./session";
import type { QuizItem } from "./types";

const MCQ: QuizItem = {
  kind: "mcq",
  q: "Q1",
  choices: ["a", "b", "c", "d"],
  correctIndex: 1,
};
const MCQ2: QuizItem = {
  kind: "mcq",
  q: "Q2",
  choices: ["a", "b", "c", "d"],
  correctIndex: 0,
};
const OPEN: QuizItem = {
  kind: "open",
  q: "Explain X",
  rubric: "Mentions A and B",
};

function makeState(items: QuizItem[]): SessionState {
  return {
    items,
    answers: [],
    startedAt: 1000,
  };
}

describe("submitAnswer", () => {
  it("resolves MCQ correctness immediately and orders answers by itemIndex", () => {
    const s0 = makeState([MCQ, MCQ2]);
    const s1 = submitAnswer(s0, 1, { kind: "mcq", selectedIndex: 0 }, 2000);
    const s2 = submitAnswer(s1, 0, { kind: "mcq", selectedIndex: 1 }, 3000);
    expect(s2.answers).toHaveLength(2);
    expect(s2.answers.map((a) => a.itemIndex)).toEqual([0, 1]);
    expect(s2.answers[0]).toMatchObject({
      kind: "mcq",
      itemIndex: 0,
      selectedIndex: 1,
      correct: true,
      answeredAt: 3000,
    });
    expect(s2.answers[1]).toMatchObject({
      kind: "mcq",
      itemIndex: 1,
      selectedIndex: 0,
      correct: true,
      answeredAt: 2000,
    });
  });

  it("is idempotent — re-submitting overwrites the previous answer", () => {
    const s0 = makeState([MCQ]);
    const s1 = submitAnswer(s0, 0, { kind: "mcq", selectedIndex: 0 }, 1000);
    const s2 = submitAnswer(s1, 0, { kind: "mcq", selectedIndex: 1 }, 2000);
    expect(s2.answers).toHaveLength(1);
    expect(s2.answers[0]).toMatchObject({
      selectedIndex: 1,
      correct: true,
      answeredAt: 2000,
    });
    expect(answerForIndex(s2, 0)?.kind).toBe("mcq");
  });

  it("rejects type mismatch (open response on MCQ item)", () => {
    const s0 = makeState([MCQ]);
    const s1 = submitAnswer(s0, 0, { kind: "open", text: "blah" }, 1000);
    expect(s1).toBe(s0); // no-op, returns input state
  });

  it("captures open-item answers with correct=null pending eval", () => {
    const s0 = makeState([OPEN]);
    const s1 = submitAnswer(s0, 0, { kind: "open", text: "my answer" }, 5000);
    const a = answerForIndex(s1, 0);
    expect(a?.kind).toBe("open");
    if (a?.kind === "open") {
      expect(a.text).toBe("my answer");
      expect(a.correct).toBeNull();
      expect(a.answeredAt).toBe(5000);
    }
  });
});

describe("applyOpenEval", () => {
  it("patches an open answer with the rubric verdict", () => {
    const s0 = makeState([OPEN]);
    const s1 = submitAnswer(s0, 0, { kind: "open", text: "x" }, 100);
    const s2 = applyOpenEval(s1, 0, { correct: true, feedback: "Nice" });
    const a = answerForIndex(s2, 0);
    if (a?.kind === "open") {
      expect(a.correct).toBe(true);
      expect(a.feedback).toBe("Nice");
    } else {
      throw new Error("expected open answer");
    }
  });

  it("is a no-op when the item isn't open or no answer exists yet", () => {
    const s0 = makeState([MCQ, OPEN]);
    const s1 = submitAnswer(s0, 0, { kind: "mcq", selectedIndex: 1 }, 100);
    expect(applyOpenEval(s1, 0, { correct: true })).toBe(s1); // mcq → no-op
    expect(applyOpenEval(s1, 1, { correct: true })).toBe(s1); // no answer → no-op
  });
});

describe("nextItem", () => {
  it("walks forward then wraps; returns null when all answered", () => {
    const s0 = makeState([MCQ, MCQ2, MCQ]);
    expect(nextItem(s0, 0)).toBe(0);
    const s1 = submitAnswer(s0, 1, { kind: "mcq", selectedIndex: 0 }, 1);
    // from index 2: forward sees nothing unanswered; wraps and finds 0
    expect(nextItem(s1, 2)).toBe(2);
    const s2 = submitAnswer(s1, 2, { kind: "mcq", selectedIndex: 0 }, 2);
    expect(nextItem(s2, 1)).toBe(0); // wrap-around
    const s3 = submitAnswer(s2, 0, { kind: "mcq", selectedIndex: 1 }, 3);
    expect(nextItem(s3, 0)).toBeNull();
  });
});

describe("computeScore + finishSession", () => {
  it("scores correct/total, treating pending open as incorrect", () => {
    const s0 = makeState([MCQ, MCQ2, OPEN]);
    expect(computeScore(s0)).toBe(0);
    const s1 = submitAnswer(s0, 0, { kind: "mcq", selectedIndex: 1 }, 1); // correct
    const s2 = submitAnswer(s1, 1, { kind: "mcq", selectedIndex: 3 }, 2); // wrong
    const s3 = submitAnswer(s2, 2, { kind: "open", text: "x" }, 3); // pending → 0
    expect(computeScore(s3)).toBeCloseTo(1 / 3, 5);
    const s4 = applyOpenEval(s3, 2, { correct: true });
    expect(computeScore(s4)).toBeCloseTo(2 / 3, 5);
  });

  it("finishSession freezes finishedAt + score and isSessionFinished flips", () => {
    const s0 = makeState([MCQ, MCQ2]);
    const s1 = submitAnswer(s0, 0, { kind: "mcq", selectedIndex: 1 }, 1);
    expect(isSessionFinished(s1)).toBe(false);
    const s2 = finishSession(s1, 9999);
    expect(s2.finishedAt).toBe(9999);
    expect(s2.score).toBeCloseTo(0.5, 5);
    expect(isSessionFinished(s2)).toBe(true);
  });
});
