import { describe, it, expect } from "vitest";
import { buildQuizEvalSystem, parseQuizEvalOutput } from "./quiz-eval";

describe("buildQuizEvalSystem", () => {
  it("emits two blocks with question + rubric + user-answer payload", () => {
    const blocks = buildQuizEvalSystem({
      question: "What is X?",
      rubric: "Mentions A and B",
      userAnswer: "X is A",
      locale: "en",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("rubric");
    expect(blocks[1]?.text).toContain("<question>");
    expect(blocks[1]?.text).toContain("What is X?");
    expect(blocks[1]?.text).toContain("Mentions A and B");
    expect(blocks[1]?.text).toContain("X is A");
  });
});

describe("parseQuizEvalOutput", () => {
  it("parses a clean JSON envelope with correct + feedback", () => {
    const r = parseQuizEvalOutput(
      JSON.stringify({ correct: true, feedback: "Solid answer." }),
    );
    expect(r.correct).toBe(true);
    expect(r.feedback).toBe("Solid answer.");
    expect(r.partial).toBeUndefined();
  });

  it("strips markdown fences + leading prose and reads `partial`", () => {
    const noisy =
      "Here is my evaluation:\n```json\n" +
      JSON.stringify({
        correct: false,
        partial: 0.4,
        feedback: "Touched on A but missed B.",
      }) +
      "\n```";
    const r = parseQuizEvalOutput(noisy);
    expect(r.correct).toBe(false);
    expect(r.partial).toBe(0.4);
    expect(r.feedback).toContain("missed B");
  });

  it("ignores out-of-range partial scores", () => {
    const r = parseQuizEvalOutput(
      JSON.stringify({
        correct: true,
        partial: 1.7,
        feedback: "ok",
      }),
    );
    expect(r.partial).toBeUndefined();
    const r2 = parseQuizEvalOutput(
      JSON.stringify({
        correct: true,
        partial: -0.1,
        feedback: "ok",
      }),
    );
    expect(r2.partial).toBeUndefined();
  });

  it("recovers when trailing chatter follows the JSON object", () => {
    const noisy =
      JSON.stringify({ correct: true, feedback: "fine" }) +
      "\n\nLet me know if you want more.";
    const r = parseQuizEvalOutput(noisy);
    expect(r.correct).toBe(true);
    expect(r.feedback).toBe("fine");
  });

  it("throws on missing required fields or invalid JSON", () => {
    expect(() => parseQuizEvalOutput("not json")).toThrow();
    expect(() =>
      parseQuizEvalOutput(JSON.stringify({ correct: true })),
    ).toThrow(/feedback/);
    expect(() =>
      parseQuizEvalOutput(JSON.stringify({ feedback: "x" })),
    ).toThrow(/correct/);
    expect(() =>
      parseQuizEvalOutput(JSON.stringify({ correct: "yes", feedback: "x" })),
    ).toThrow(/correct/);
  });
});
