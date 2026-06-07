import { describe, it, expect } from "vitest";
import {
  buildQuizGenSystem,
  clampQuizCount,
  parseQuizGenOutput,
} from "./quiz-gen";

const SAMPLE_VALID = JSON.stringify({
  items: [
    {
      kind: "mcq",
      q: "What is 2+2?",
      choices: ["3", "4", "5", "6"],
      correctIndex: 1,
      explanation: "Basic arithmetic.",
    },
    {
      kind: "mcq",
      q: "What is the sky color on a clear day?",
      choices: ["green", "red", "blue", "yellow"],
      correctIndex: 2,
    },
  ],
});

describe("clampQuizCount", () => {
  it("clamps to [1, 20] and rounds", () => {
    expect(clampQuizCount(0)).toBe(1);
    expect(clampQuizCount(50)).toBe(20);
    expect(clampQuizCount(7.6)).toBe(8);
    expect(clampQuizCount(NaN)).toBe(1);
  });
});

describe("buildQuizGenSystem", () => {
  it("emits two blocks with cache_control on the source payload", () => {
    const blocks = buildQuizGenSystem({
      source: { title: "S", type: "pdf" },
      chunks: [{ index: 0, text: "alpha beta", headings: ["Intro"] }],
      locale: "en",
      count: 3,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("exactly 3 MCQ");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("alpha beta");
    expect(blocks[1]?.text).toContain("section: Intro");
  });
});

describe("parseQuizGenOutput", () => {
  it("parses a clean items wrapper", () => {
    const { items } = parseQuizGenOutput(SAMPLE_VALID);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "mcq",
      q: "What is 2+2?",
      correctIndex: 1,
    });
  });

  it("strips markdown code fences and prose preamble", () => {
    const wrapped = "Sure! Here you go:\n```json\n" + SAMPLE_VALID + "\n```";
    const { items } = parseQuizGenOutput(wrapped);
    expect(items).toHaveLength(2);
  });

  it("accepts a bare array without `items` wrapper", () => {
    const arr = JSON.stringify([
      {
        kind: "mcq",
        q: "Q1",
        choices: ["a", "b", "c", "d"],
        correctIndex: 0,
      },
    ]);
    const { items } = parseQuizGenOutput(arr);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("mcq");
  });

  it("recovers when trailing garbage follows the JSON object", () => {
    const noisy = SAMPLE_VALID + "\n\nThanks for the input!";
    const { items } = parseQuizGenOutput(noisy);
    expect(items).toHaveLength(2);
    expect(items[0]?.q).toBe("What is 2+2?");
  });

  it("silently drops MCQ items violating invariants and throws when none remain", () => {
    const partial = JSON.stringify({
      items: [
        // wrong choice count → drop
        {
          kind: "mcq",
          q: "bad",
          choices: ["a", "b", "c"],
          correctIndex: 0,
        },
        // out-of-range correctIndex → drop
        {
          kind: "mcq",
          q: "bad2",
          choices: ["a", "b", "c", "d"],
          correctIndex: 4,
        },
        // empty q → drop
        {
          kind: "mcq",
          q: "",
          choices: ["a", "b", "c", "d"],
          correctIndex: 0,
        },
        // open kind not yet supported → drop
        { kind: "open", q: "explain", rubric: "x" },
        // valid → kept
        {
          kind: "mcq",
          q: "good",
          choices: ["a", "b", "c", "d"],
          correctIndex: 1,
          sourceSection: "S1",
          sourceChunkId: "#0",
        },
      ],
    });
    const { items } = parseQuizGenOutput(partial);
    expect(items).toHaveLength(1);
    expect(items[0]?.q).toBe("good");
    expect(items[0]?.sourceSection).toBe("S1");

    expect(() =>
      parseQuizGenOutput(JSON.stringify({ items: [] })),
    ).toThrow(/no valid items/);
    expect(() => parseQuizGenOutput("not json at all")).toThrow();
  });
});
